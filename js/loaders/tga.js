/**
 * Truevision TGA (.tga) reader. Browsers can't decode TGA themselves, and it's
 * the usual source format for Source engine textures.
 *
 * Supports uncompressed and RLE-compressed images, 8-bit grayscale and
 * 24/32-bit true color. Color-mapped (palette) images are not supported.
 */

const TYPE_TRUE_COLOR = 2;
const TYPE_GRAYSCALE = 3;
const TYPE_TRUE_COLOR_RLE = 10;
const TYPE_GRAYSCALE_RLE = 11;

const ORIGIN_RIGHT = 0x10; // image descriptor bit 4: pixels run right to left
const ORIGIN_TOP = 0x20;   // image descriptor bit 5: rows run top to bottom

/**
 * @param {ArrayBuffer} buffer
 * @returns {{ width: number, height: number, rgba: Uint8ClampedArray, description: string }}
 */
export function decodeTga(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  // 18-byte header
  const idLength = bytes[0];
  const hasColorMap = bytes[1] !== 0;
  const imageType = bytes[2];
  const colorMapLength = view.getUint16(5, true);
  const colorMapEntryBits = bytes[7];
  const width = view.getUint16(12, true);
  const height = view.getUint16(14, true);
  const bitsPerPixel = bytes[16];
  const descriptor = bytes[17];

  if (![TYPE_TRUE_COLOR, TYPE_GRAYSCALE, TYPE_TRUE_COLOR_RLE, TYPE_GRAYSCALE_RLE].includes(imageType)) {
    throw new Error(`This TGA type (${imageType}) is not supported. Use uncompressed or RLE true-color/grayscale.`);
  }
  const bytesPerPixel = bitsPerPixel / 8;
  if (![1, 3, 4].includes(bytesPerPixel)) {
    throw new Error('Only 8, 24 and 32-bit TGA files are supported.');
  }

  // Pixel data follows the header, the image ID and the (unused) color map.
  let position = 18 + idLength + (hasColorMap ? colorMapLength * Math.ceil(colorMapEntryBits / 8) : 0);
  const pixelCount = width * height;
  const stored = new Uint8ClampedArray(pixelCount * 4); // in file order

  // Copies one pixel from the file (BGR(A) or gray) into `stored` as RGBA.
  const writePixel = (index, source) => {
    const dst = index * 4;
    if (bytesPerPixel === 1) {
      stored[dst] = stored[dst + 1] = stored[dst + 2] = bytes[source];
      stored[dst + 3] = 255;
    } else {
      stored[dst] = bytes[source + 2];
      stored[dst + 1] = bytes[source + 1];
      stored[dst + 2] = bytes[source];
      stored[dst + 3] = bytesPerPixel === 4 ? bytes[source + 3] : 255;
    }
  };

  const isRle = imageType === TYPE_TRUE_COLOR_RLE || imageType === TYPE_GRAYSCALE_RLE;
  if (!isRle) {
    for (let i = 0; i < pixelCount; i++, position += bytesPerPixel) writePixel(i, position);
  } else {
    // Each packet starts with a header byte: the top bit says "repeat one
    // pixel" (run-length packet) or "copy raw pixels"; the low 7 bits + 1 is
    // the pixel count.
    let i = 0;
    while (i < pixelCount && position < bytes.length) {
      const packetHeader = bytes[position++];
      const count = (packetHeader & 0x7f) + 1;
      if (packetHeader & 0x80) {
        for (let k = 0; k < count && i < pixelCount; k++) writePixel(i++, position);
        position += bytesPerPixel;
      } else {
        for (let k = 0; k < count && i < pixelCount; k++, position += bytesPerPixel) writePixel(i++, position);
      }
    }
  }

  // Some tools write 32-bit TGAs with an all-zero alpha channel. Treat those as opaque.
  if (bytesPerPixel === 4 && !hasAnyAlpha(stored)) {
    for (let i = 3; i < stored.length; i += 4) stored[i] = 255;
  }

  // Reorder rows/columns so the result is top-to-bottom, left-to-right.
  const fromTop = Boolean(descriptor & ORIGIN_TOP);
  const fromRight = Boolean(descriptor & ORIGIN_RIGHT);
  const rgba = new Uint8ClampedArray(pixelCount * 4);
  for (let y = 0; y < height; y++) {
    const sourceY = fromTop ? y : height - 1 - y;
    for (let x = 0; x < width; x++) {
      const sourceX = fromRight ? width - 1 - x : x;
      const src = (sourceY * width + sourceX) * 4;
      rgba.set(stored.subarray(src, src + 4), (y * width + x) * 4);
    }
  }

  return { width, height, rgba, description: `TGA ${bitsPerPixel}-bit` };
}

function hasAnyAlpha(rgba) {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 0) return true;
  return false;
}
