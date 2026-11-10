/**
 * Automatic sticker detection.
 *
 * Finds every separate shape on a sheet and returns its bounding box, in five
 * steps:
 *
 *   1. Foreground mask   Mark each pixel as "sticker" or "background", using
 *                        its alpha or its difference from the corner color.
 *   2. Components        Flood-fill the mask to find groups of touching
 *                        sticker pixels (4-connectivity: up, down, left,
 *                        right) and record each group's bounding box.
 *   3. Merge             Join boxes that overlap or are closer than the merge
 *                        gap, so stickers made of loose parts (letters, a
 *                        separate dot) become one region.
 *   4. Clean up          Drop boxes smaller than the minimum size and grow the
 *                        rest by the padding.
 *   5. Order             Sort into reading order: rows top to bottom, then
 *                        left to right inside each row.
 *
 * Everything works on plain pixel data, with no DOM access, so it can be
 * tested on its own.
 */

/** Above this many shapes the merge step gets slow, and the result is almost certainly noise. */
const MAX_SHAPES = 4000;

/**
 * @param {{ width: number, height: number, data: Uint8ClampedArray }} image  RGBA pixels (e.g. ImageData)
 * @param {object} options
 * @param {'alpha'|'solid'} options.background  how to tell sticker from background
 * @param {number} options.threshold  alpha (or color difference) a pixel must exceed
 * @param {number} options.mergeGap   boxes this many pixels apart or closer are merged
 * @param {number} options.minSize    boxes narrower or shorter than this are dropped
 * @param {number} options.padding    pixels added around each box
 * @returns {{ regions: Array<{x:number,y:number,w:number,h:number}>, shapeCount: number }}
 */
export function detectRegions(image, options) {
  const { width, height } = image;

  const mask = buildForegroundMask(image, options.background, options.threshold);
  const shapes = findConnectedComponents(mask, width, height);

  let boxes = shapes;
  if (boxes.length > MAX_SHAPES) boxes = boxes.filter((box) => box.pixelCount >= 4); // ignore single-pixel noise
  if (boxes.length > MAX_SHAPES) {
    throw new Error(
      `Found ${shapes.length} separate shapes, which is too many to sort out. ` +
      'Raise the threshold, or switch between Transparent and Solid color.'
    );
  }

  boxes = mergeNearbyBoxes(boxes, options.mergeGap);

  const regions = boxes
    .filter((box) => boxWidth(box) >= options.minSize && boxHeight(box) >= options.minSize)
    .map((box) => toPaddedRect(box, options.padding, width, height));

  return { regions: sortInReadingOrder(regions), shapeCount: shapes.length };
}

/* ---------- Step 1: foreground mask ---------- */

/**
 * Returns one byte per pixel: 1 = part of a sticker, 0 = background.
 *
 * 'alpha'  A pixel is foreground when its alpha is above the threshold.
 * 'solid'  The top-left pixel is taken as the background color. A pixel is
 *          foreground when any channel differs from it by more than the
 *          threshold (and it isn't transparent).
 */
function buildForegroundMask({ width, height, data }, background, threshold) {
  const mask = new Uint8Array(width * height);

  if (background === 'alpha') {
    for (let i = 0; i < mask.length; i++) {
      mask[i] = data[i * 4 + 3] > threshold ? 1 : 0;
    }
    return mask;
  }

  const [bgR, bgG, bgB] = [data[0], data[1], data[2]];
  for (let i = 0; i < mask.length; i++) {
    const p = i * 4;
    const difference = Math.max(
      Math.abs(data[p] - bgR),
      Math.abs(data[p + 1] - bgG),
      Math.abs(data[p + 2] - bgB)
    );
    mask[i] = data[p + 3] > 16 && difference > threshold ? 1 : 0;
  }
  return mask;
}

/* ---------- Step 2: connected components ---------- */

/**
 * Scans the mask row by row. Each time it meets a foreground pixel that no
 * shape has claimed yet, it flood-fills from there and records the bounding
 * box of everything it reached.
 *
 * The flood fill uses an explicit stack instead of recursion, so large shapes
 * can't overflow the call stack. Each pixel is pushed at most once, so the
 * whole pass is linear in the number of pixels.
 *
 * Boxes use inclusive pixel coordinates: { left, top, right, bottom }.
 */
function findConnectedComponents(mask, width, height) {
  const UNVISITED = 1;
  const VISITED = 2;
  const stack = new Int32Array(width * height);
  const shapes = [];

  for (let start = 0; start < mask.length; start++) {
    if (mask[start] !== UNVISITED) continue;

    const box = { left: width, top: height, right: -1, bottom: -1, pixelCount: 0 };
    let stackSize = 0;
    stack[stackSize++] = start;
    mask[start] = VISITED;

    while (stackSize > 0) {
      const index = stack[--stackSize];
      const x = index % width;
      const y = (index - x) / width;

      box.pixelCount++;
      if (x < box.left) box.left = x;
      if (x > box.right) box.right = x;
      if (y < box.top) box.top = y;
      if (y > box.bottom) box.bottom = y;

      // Visit the four direct neighbours.
      if (x > 0 && mask[index - 1] === UNVISITED) { mask[index - 1] = VISITED; stack[stackSize++] = index - 1; }
      if (x < width - 1 && mask[index + 1] === UNVISITED) { mask[index + 1] = VISITED; stack[stackSize++] = index + 1; }
      if (y > 0 && mask[index - width] === UNVISITED) { mask[index - width] = VISITED; stack[stackSize++] = index - width; }
      if (y < height - 1 && mask[index + width] === UNVISITED) { mask[index + width] = VISITED; stack[stackSize++] = index + width; }
    }

    shapes.push(box);
  }
  return shapes;
}

/* ---------- Step 3: merge nearby boxes ---------- */

/**
 * Repeatedly joins any two boxes whose gap is at most `mergeGap` pixels on
 * both axes. Overlapping boxes always count as close. A merged box is bigger
 * than either part, so it can now reach boxes neither part reached; that's
 * why the loop runs until a full pass merges nothing.
 */
function mergeNearbyBoxes(boxes, mergeGap) {
  const result = boxes.map((box) => ({ ...box }));
  let mergedSomething = true;

  while (mergedSomething) {
    mergedSomething = false;
    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        if (!areClose(result[i], result[j], mergeGap)) continue;
        absorb(result[i], result[j]);
        result.splice(j, 1);
        j = i; // box i just grew: compare it against all the others again
        mergedSomething = true;
      }
    }
  }
  return result;
}

/**
 * Empty pixels between two boxes along one axis. Negative when they overlap.
 * Example: a box ending at x = 10 and one starting at x = 12 have a gap of 1.
 */
function gapBetween(startA, endA, startB, endB) {
  return Math.max(startB - endA - 1, startA - endB - 1);
}

function areClose(a, b, mergeGap) {
  return (
    gapBetween(a.left, a.right, b.left, b.right) <= mergeGap &&
    gapBetween(a.top, a.bottom, b.top, b.bottom) <= mergeGap
  );
}

function absorb(target, other) {
  target.left = Math.min(target.left, other.left);
  target.top = Math.min(target.top, other.top);
  target.right = Math.max(target.right, other.right);
  target.bottom = Math.max(target.bottom, other.bottom);
  target.pixelCount += other.pixelCount;
}

/* ---------- Step 4: clean up ---------- */

const boxWidth = (box) => box.right - box.left + 1;
const boxHeight = (box) => box.bottom - box.top + 1;

/** Converts an inclusive box to { x, y, w, h }, grown by `padding` and kept inside the sheet. */
function toPaddedRect(box, padding, sheetWidth, sheetHeight) {
  const x = Math.max(0, box.left - padding);
  const y = Math.max(0, box.top - padding);
  const right = Math.min(sheetWidth, box.right + 1 + padding);
  const bottom = Math.min(sheetHeight, box.bottom + 1 + padding);
  return { x, y, w: right - x, h: bottom - y };
}

/* ---------- Step 5: reading order ---------- */

/**
 * Groups rectangles into rows, then sorts each row left to right.
 * A rectangle joins the current row when its top edge is within half the
 * height of the row's first rectangle; otherwise it starts a new row.
 */
function sortInReadingOrder(rects) {
  const byTop = [...rects].sort((a, b) => a.y - b.y);
  const rows = [];

  for (const rect of byTop) {
    const row = rows[rows.length - 1];
    if (row && rect.y < row.top + row.firstHeight / 2) {
      row.items.push(rect);
    } else {
      rows.push({ top: rect.y, firstHeight: rect.h, items: [rect] });
    }
  }

  return rows.flatMap((row) => row.items.sort((a, b) => a.x - b.x));
}
