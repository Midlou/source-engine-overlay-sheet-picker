/**
 * DXT (S3TC / BC1–BC3) block decompression.
 *
 * DXT images are stored as 4×4 pixel blocks. Every block has a color part:
 *   - two 16-bit RGB565 endpoint colors (c0, c1)
 *   - sixteen 2-bit indices that pick one of four palette colors per pixel
 *
 * DXT1 blocks are 8 bytes: just the color part. When c0 <= c1 the palette has
 * only three colors and index 3 means "transparent black" (1-bit alpha).
 * DXT3 blocks are 16 bytes: 8 bytes of explicit 4-bit alpha, then the color part.
 * DXT5 blocks are 16 bytes: two 8-bit alpha endpoints and sixteen 3-bit indices
 * into an interpolated alpha palette, then the color part.
 */

/**
 * @param {Uint8Array} bytes   whole file contents
 * @param {number} offset      where the image data starts
 * @param {number} width
 * @param {number} height
 * @param {'DXT1'|'DXT3'|'DXT5'} variant
 * @param {boolean} oneBitAlpha  DXT1 only: treat index 3 of a 3-color block as transparent
 * @returns {Uint8ClampedArray} RGBA pixels, row by row
 */
export function decodeDxt(bytes, offset, width, height, variant, oneBitAlpha = false) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  const blocksWide = Math.max(1, Math.ceil(width / 4));
  const blocksHigh = Math.max(1, Math.ceil(height / 4));
  const blockSize = variant === 'DXT1' ? 8 : 16;
  const alpha = new Uint8Array(16);

  for (let blockY = 0; blockY < blocksHigh; blockY++) {
    for (let blockX = 0; blockX < blocksWide; blockX++) {
      let p = offset + (blockY * blocksWide + blockX) * blockSize;

      alpha.fill(255);
      if (variant === 'DXT3') {
        readExplicitAlpha(bytes, p, alpha);
        p += 8;
      } else if (variant === 'DXT5') {
        readInterpolatedAlpha(bytes, p, alpha);
        p += 8;
      }

      const palette = readColorPalette(bytes, p, variant === 'DXT1', oneBitAlpha);
      const indices = readUint32(bytes, p + 4);

      for (let i = 0; i < 16; i++) {
        const x = blockX * 4 + (i % 4);
        const y = blockY * 4 + Math.floor(i / 4);
        if (x >= width || y >= height) continue; // block hangs over the image edge

        const color = palette[(indices >>> (2 * i)) & 3];
        const q = (y * width + x) * 4;
        pixels[q] = color[0];
        pixels[q + 1] = color[1];
        pixels[q + 2] = color[2];
        pixels[q + 3] = Math.min(color[3], alpha[i]);
      }
    }
  }
  return pixels;
}

/** DXT3: sixteen 4-bit alpha values, two per byte, low nibble first. */
function readExplicitAlpha(bytes, p, alpha) {
  for (let i = 0; i < 8; i++) {
    const byte = bytes[p + i];
    alpha[2 * i] = (byte & 0x0f) * 17;       // scale 0–15 to 0–255
    alpha[2 * i + 1] = (byte >> 4) * 17;
  }
}

/** DXT5: two alpha endpoints and sixteen 3-bit indices into an 8-entry table. */
function readInterpolatedAlpha(bytes, p, alpha) {
  const a0 = bytes[p];
  const a1 = bytes[p + 1];
  const table = [a0, a1];
  if (a0 > a1) {
    for (let i = 1; i < 7; i++) table.push(Math.floor(((7 - i) * a0 + i * a1) / 7));
  } else {
    for (let i = 1; i < 5; i++) table.push(Math.floor(((5 - i) * a0 + i * a1) / 5));
    table.push(0, 255);
  }

  // 48 bits of indices, read as two 24-bit halves to stay inside 32-bit integers.
  const low = bytes[p + 2] | (bytes[p + 3] << 8) | (bytes[p + 4] << 16);
  const high = bytes[p + 5] | (bytes[p + 6] << 8) | (bytes[p + 7] << 16);
  for (let i = 0; i < 16; i++) {
    const index = i < 8 ? (low >> (3 * i)) & 7 : (high >> (3 * (i - 8))) & 7;
    alpha[i] = table[index];
  }
}

/** Builds the 4-entry RGBA palette from the two RGB565 endpoints. */
function readColorPalette(bytes, p, isDxt1, oneBitAlpha) {
  const c0 = bytes[p] | (bytes[p + 1] << 8);
  const c1 = bytes[p + 2] | (bytes[p + 3] << 8);
  const [r0, g0, b0] = rgb565(c0);
  const [r1, g1, b1] = rgb565(c1);
  const mix = (a, b, wa, wb) => (a * wa + b * wb) / (wa + wb);

  // DXT3/DXT5 always use four colors. DXT1 uses four only when c0 > c1.
  if (!isDxt1 || c0 > c1) {
    return [
      [r0, g0, b0, 255],
      [r1, g1, b1, 255],
      [mix(r0, r1, 2, 1), mix(g0, g1, 2, 1), mix(b0, b1, 2, 1), 255],
      [mix(r0, r1, 1, 2), mix(g0, g1, 1, 2), mix(b0, b1, 1, 2), 255],
    ];
  }
  return [
    [r0, g0, b0, 255],
    [r1, g1, b1, 255],
    [mix(r0, r1, 1, 1), mix(g0, g1, 1, 1), mix(b0, b1, 1, 1), 255],
    [0, 0, 0, oneBitAlpha ? 0 : 255],
  ];
}

/** Expands a 16-bit 5:6:5 color to 8 bits per channel. */
function rgb565(value) {
  return [
    ((value >> 11) & 31) * 255 / 31,
    ((value >> 5) & 63) * 255 / 63,
    (value & 31) * 255 / 31,
  ];
}

function readUint32(bytes, p) {
  return (bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16) | (bytes[p + 3] << 24)) >>> 0;
}
