/**
 * The core conversion: a pixel rectangle on the sheet becomes the four
 * texture coordinates that Hammer's info_overlay uses.
 *
 *   StartU / EndU  horizontal edges, 0 = left of the sheet, 1 = right
 *   StartV / EndV  vertical edges,   0 = top of the sheet,  1 = bottom
 */

export const UV_KEYS = ['StartU', 'EndU', 'StartV', 'EndV'];

/**
 * @param {{ x: number, y: number, w: number, h: number }} rect  pixels
 * @param {number} sheetWidth   pixels
 * @param {number} sheetHeight  pixels
 * @param {object} options
 * @param {number} options.inset     pull each edge inward by this many pixels
 *   (0.5 samples the centre of the edge texels, which stops neighbouring
 *   stickers bleeding in through texture filtering)
 * @param {boolean} options.reverseU  Hammer's default on this face is U Start = 1
 * @param {boolean} options.reverseV  Hammer's default on this face is V Start = 1
 * @returns {{ StartU: number, EndU: number, StartV: number, EndV: number }}
 */
export function computeOverlayUV(rect, sheetWidth, sheetHeight, { inset = 0, reverseU = false, reverseV = false } = {}) {
  // Never inset past the middle of the rectangle.
  const pull = Math.max(0, Math.min(inset, rect.w / 2 - 0.001, rect.h / 2 - 0.001));

  const left = (rect.x + pull) / sheetWidth;
  const right = (rect.x + rect.w - pull) / sheetWidth;
  const top = (rect.y + pull) / sheetHeight;
  const bottom = (rect.y + rect.h - pull) / sheetHeight;

  // Hammer picks the order of Start/End per face, depending on which way the
  // face points. Keeping the same order stops the sticker coming out mirrored.
  return {
    StartU: reverseU ? right : left,
    EndU: reverseU ? left : right,
    StartV: reverseV ? bottom : top,
    EndV: reverseV ? top : bottom,
  };
}

/** Up to 6 decimals, without trailing zeros: 0.25, 0.003418, 1. */
export function formatUV(value) {
  return String(Number(value.toFixed(6)));
}

/** Text block in .vmf keyvalue syntax. */
export function keyvaluesSnippet(uv, material) {
  const lines = [];
  if (material.trim()) lines.push(`"material" "${material.trim()}"`);
  for (const key of UV_KEYS) lines.push(`"${key}" "${formatUV(uv[key])}"`);
  return lines.join('\n');
}
