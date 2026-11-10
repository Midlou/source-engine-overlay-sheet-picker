/**
 * Valve Texture Format (.vtf) reader.
 *
 * Only reads what the picker needs: the largest mipmap of the first frame,
 * converted to RGBA. Supports VTF 7.0 to 7.5.
 *
 * Header layout (all values little-endian):
 *
 *   offset  size  field
 *   0       4     signature "VTF\0"
 *   4       4     major version (7)
 *   8       4     minor version (0–5)
 *   12      4     header size
 *   16      2     width
 *   18      2     height
 *   20      4     flags
 *   24      2     frame count
 *   26      2     first frame
 *   28      4     padding
 *   32      12    reflectivity (3 floats)
 *   44      4     padding
 *   48      4     bump map scale
 *   52      4     high-res image format
 *   56      1     mipmap count
 *   57      4     low-res (thumbnail) image format
 *   61      1     low-res width
 *   62      1     low-res height
 *   63      2     depth                      (7.2 and later)
 *   65      3     padding                    (7.3 and later)
 *   68      4     resource count             (7.3 and later)
 *   72      8     padding
 *   80      8×n   resource entries: 3-byte tag, 1 flag byte, 4-byte offset
 *
 * The high-res image data stores mipmaps from smallest to largest. Inside each
 * mipmap come all frames, inside each frame all faces, inside each face all
 * depth slices. The largest mipmap is therefore at the end.
 */

import { decodeDxt } from './dxt.js';

const SIGNATURE = 0x00465456; // "VTF\0" read as a little-endian uint32
const FLAG_ONE_BIT_ALPHA = 0x1000;
const FLAG_ENVMAP = 0x4000; // cubemap: 6 faces per frame
const RESOURCE_TAG_HIGH_RES_IMAGE = 0x30;

/** IMAGE_FORMAT values from the Source SDK (public/bitmap/imageformat.h). */
const FORMAT = {
  RGBA8888: 0,
  ABGR8888: 1,
  RGB888: 2,
  BGR888: 3,
  RGB565: 4,
  I8: 5,
  IA88: 6,
  P8: 7,
  A8: 8,
  RGB888_BLUESCREEN: 9,
  BGR888_BLUESCREEN: 10,
  ARGB8888: 11,
  BGRA8888: 12,
  DXT1: 13,
  DXT3: 14,
  DXT5: 15,
  BGRX8888: 16,
  BGR565: 17,
  BGRX5551: 18,
  BGRA4444: 19,
  DXT1_ONEBITALPHA: 20,
  BGRA5551: 21,
  UV88: 22,
  UVWQ8888: 23,
  RGBA16161616F: 24,
  RGBA16161616: 25,
  UVLX8888: 26,
};

const FORMAT_NAMES = Object.fromEntries(Object.entries(FORMAT).map(([name, id]) => [id, name]));

const BYTES_PER_PIXEL = {
  [FORMAT.RGBA8888]: 4, [FORMAT.ABGR8888]: 4, [FORMAT.RGB888]: 3, [FORMAT.BGR888]: 3,
  [FORMAT.RGB565]: 2, [FORMAT.I8]: 1, [FORMAT.IA88]: 2, [FORMAT.P8]: 1, [FORMAT.A8]: 1,
  [FORMAT.RGB888_BLUESCREEN]: 3, [FORMAT.BGR888_BLUESCREEN]: 3, [FORMAT.ARGB8888]: 4,
  [FORMAT.BGRA8888]: 4, [FORMAT.BGRX8888]: 4, [FORMAT.BGR565]: 2, [FORMAT.BGRX5551]: 2,
  [FORMAT.BGRA4444]: 2, [FORMAT.BGRA5551]: 2, [FORMAT.UV88]: 2, [FORMAT.UVWQ8888]: 4,
  [FORMAT.RGBA16161616F]: 8, [FORMAT.RGBA16161616]: 8, [FORMAT.UVLX8888]: 4,
};

/**
 * For 8-bit-per-channel formats: the byte position of R, G, B and A inside
 * each pixel. -1 means the format has no alpha, so the pixel is opaque.
 */
const CHANNEL_ORDER = {
  [FORMAT.RGBA8888]: [0, 1, 2, 3],
  [FORMAT.ABGR8888]: [3, 2, 1, 0],
  [FORMAT.RGB888]: [0, 1, 2, -1],
  [FORMAT.RGB888_BLUESCREEN]: [0, 1, 2, -1],
  [FORMAT.BGR888]: [2, 1, 0, -1],
  [FORMAT.BGR888_BLUESCREEN]: [2, 1, 0, -1],
  [FORMAT.ARGB8888]: [1, 2, 3, 0],
  [FORMAT.BGRA8888]: [2, 1, 0, 3],
  [FORMAT.BGRX8888]: [2, 1, 0, -1],
};

/**
 * @param {ArrayBuffer} buffer
 * @returns {{ width: number, height: number, rgba: Uint8ClampedArray, description: string }}
 */
export function decodeVtf(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  if (buffer.byteLength < 64 || view.getUint32(0, true) !== SIGNATURE) {
    throw new Error('This file is not a VTF texture.');
  }

  const minorVersion = view.getUint32(8, true);
  const headerSize = view.getUint32(12, true);
  const width = view.getUint16(16, true);
  const height = view.getUint16(18, true);
  const flags = view.getUint32(20, true);
  const frames = view.getUint16(24, true) || 1;
  const format = view.getInt32(52, true);
  const mipmapCount = bytes[56] || 1;
  const thumbnailFormat = view.getInt32(57, true);
  const thumbnailWidth = bytes[61];
  const thumbnailHeight = bytes[62];
  const depth = minorVersion >= 2 ? view.getUint16(63, true) || 1 : 1;
  const faces = flags & FLAG_ENVMAP ? 6 : 1;

  // Find where the high-res image data starts.
  let imageStart;
  if (minorVersion >= 3) {
    // 7.3+ lists its data blocks in a resource directory.
    const resourceCount = view.getUint32(68, true);
    for (let i = 0; i < resourceCount; i++) {
      const entry = 80 + i * 8;
      const isHighResImage =
        bytes[entry] === RESOURCE_TAG_HIGH_RES_IMAGE && bytes[entry + 1] === 0 && bytes[entry + 2] === 0;
      if (isHighResImage) imageStart = view.getUint32(entry + 4, true);
    }
    if (imageStart === undefined) throw new Error('The VTF has no image data resource.');
  } else {
    // Older versions: header, then the thumbnail, then the image data.
    const hasThumbnail = thumbnailFormat >= 0 && thumbnailWidth > 0 && thumbnailHeight > 0;
    imageStart = headerSize + (hasThumbnail ? mipmapByteSize(thumbnailFormat, thumbnailWidth, thumbnailHeight) : 0);
  }

  // Skip every smaller mipmap to reach the full-size one.
  let offset = imageStart;
  for (let level = mipmapCount - 1; level >= 1; level--) {
    const levelWidth = Math.max(1, width >> level);
    const levelHeight = Math.max(1, height >> level);
    offset += mipmapByteSize(format, levelWidth, levelHeight) * frames * faces * depth;
  }

  if (offset + mipmapByteSize(format, width, height) > buffer.byteLength) {
    throw new Error('The VTF is shorter than its header says. It may be damaged.');
  }

  const oneBitAlpha = format === FORMAT.DXT1_ONEBITALPHA || Boolean(flags & FLAG_ONE_BIT_ALPHA);
  const rgba = decodePixels(format, bytes, offset, width, height, oneBitAlpha);

  const formatName = FORMAT_NAMES[format] ?? `format ${format}`;
  const frameNote = frames > 1 ? `, frame 1 of ${frames}` : '';
  return { width, height, rgba, description: `VTF 7.${minorVersion}, ${formatName}${frameNote}` };
}

/** Size in bytes of one mipmap level (one frame, one face, one slice). */
function mipmapByteSize(format, width, height) {
  const blocks = Math.max(1, Math.ceil(width / 4)) * Math.max(1, Math.ceil(height / 4));
  switch (format) {
    case FORMAT.DXT1:
    case FORMAT.DXT1_ONEBITALPHA:
      return blocks * 8;
    case FORMAT.DXT3:
    case FORMAT.DXT5:
      return blocks * 16;
  }
  const bytesPerPixel = BYTES_PER_PIXEL[format];
  if (bytesPerPixel === undefined) throw new Error(`Unknown VTF image format ${format}.`);
  return width * height * bytesPerPixel;
}

/** Converts one mipmap of any supported format to RGBA. */
function decodePixels(format, bytes, offset, width, height, oneBitAlpha) {
  switch (format) {
    case FORMAT.DXT1:
    case FORMAT.DXT1_ONEBITALPHA:
      return decodeDxt(bytes, offset, width, height, 'DXT1', oneBitAlpha);
    case FORMAT.DXT3:
      return decodeDxt(bytes, offset, width, height, 'DXT3');
    case FORMAT.DXT5:
      return decodeDxt(bytes, offset, width, height, 'DXT5');
  }

  const pixelCount = width * height;
  const out = new Uint8ClampedArray(pixelCount * 4);
  const bytesPerPixel = BYTES_PER_PIXEL[format];

  const order = CHANNEL_ORDER[format];
  if (order) {
    const [r, g, b, a] = order;
    for (let i = 0; i < pixelCount; i++) {
      const src = offset + i * bytesPerPixel;
      const dst = i * 4;
      out[dst] = bytes[src + r];
      out[dst + 1] = bytes[src + g];
      out[dst + 2] = bytes[src + b];
      out[dst + 3] = a < 0 ? 255 : bytes[src + a];
    }
    return out;
  }

  // Grayscale and alpha-only formats.
  if (format === FORMAT.I8 || format === FORMAT.IA88 || format === FORMAT.A8) {
    for (let i = 0; i < pixelCount; i++) {
      const src = offset + i * bytesPerPixel;
      const dst = i * 4;
      const luminance = format === FORMAT.A8 ? 255 : bytes[src];
      out[dst] = out[dst + 1] = out[dst + 2] = luminance;
      if (format === FORMAT.I8) out[dst + 3] = 255;
      else if (format === FORMAT.IA88) out[dst + 3] = bytes[src + 1];
      else out[dst + 3] = bytes[src]; // A8
    }
    return out;
  }

  const name = FORMAT_NAMES[format] ?? format;
  throw new Error(
    `VTF format ${name} is not supported here. Open the source PNG/TGA instead, or re-save the VTF as DXT1, DXT5 or BGRA8888.`
  );
}
