/**
 * Everything the user can do to the selection and the saved regions.
 *
 * These functions only change `state` and then call `notifyChange()`; they
 * never touch the DOM. The viewer (mouse and keyboard on the sheet) and the
 * panel (buttons and fields) both call them.
 */

import { state, notifyChange, saveSettings, loadSettings, applySettings } from './state.js';
import { detectRegions } from './detect.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/* ---------- Loading a sheet ---------- */

/**
 * Makes `canvas` the current sheet and restores whatever was saved for it.
 * @param {HTMLCanvasElement} canvas
 * @param {string} key       storage key, usually the file name
 * @param {string} label     text for the top bar
 * @param {string} material  default material path for the keyvalue snippet
 */
export function setSheet(canvas, key, label, material) {
  state.sheet = canvas;
  state.width = canvas.width;
  state.height = canvas.height;
  state.sheetKey = key;
  state.sheetLabel = label;
  state.material = material;

  state.regions = [];
  state.multiSelection.clear();
  state.regionsBeforeDetect = null;
  state.liveDetect = false;
  state.detectMessage = '';

  applySettings(loadSettings(key));
  selectCells([0, 0], [0, 0]);
}

/** Applies settings from a loaded JSON file to the current sheet. */
export function importSettings(settings) {
  applySettings(settings);
  state.liveDetect = false;
  saveSettings();
  if (state.mode === 'grid') selectCells([0, 0], [0, 0]);
  else clearSelection();
}

/* ---------- Settings ---------- */

export function setMode(mode) {
  state.mode = mode;
  saveSettings();
  if (mode === 'grid') selectCells([0, 0], [0, 0]);
  else notifyChange();
}

export function setGridSize(columns, rows) {
  state.columns = columns;
  state.rows = rows;
  saveSettings();
  selectCells([0, 0], [0, 0]);
}

/** Changes a setting that only affects how values are computed or shown (inset, orientation, material). */
export function updateSetting(key, value) {
  state[key] = value;
  saveSettings();
  notifyChange();
}

/**
 * Hammer's default Start/End order on the face the overlay sits on.
 * @param {boolean} reverseU  the face shows U Start = 1, U End = 0
 * @param {boolean} reverseV  the face shows V Start = 1, V End = 0
 */
export function setOrientation(reverseU, reverseV) {
  state.reverseU = reverseU;
  state.reverseV = reverseV;
  saveSettings();
  notifyChange();
}

/* ---------- Grid selection ---------- */

export function cellSize() {
  return { w: state.width / state.columns, h: state.height / state.rows };
}

/** The [column, row] under a point given in sheet pixels. */
export function cellAt(point) {
  const cell = cellSize();
  return [
    clamp(Math.floor(point.x / cell.w), 0, state.columns - 1),
    clamp(Math.floor(point.y / cell.h), 0, state.rows - 1),
  ];
}

/** Selects every cell in the rectangle spanned by two [column, row] corners. */
export function selectCells([col1, row1], [col2, row2]) {
  const cell = cellSize();
  const left = Math.min(col1, col2);
  const top = Math.min(row1, row2);
  const columns = Math.abs(col2 - col1) + 1;
  const rows = Math.abs(row2 - row1) + 1;

  state.selection = { x: left * cell.w, y: top * cell.h, w: columns * cell.w, h: rows * cell.h };
  state.selectedRegion = -1;
  state.multiSelection.clear();
  notifyChange();
}

/** Arrow keys in grid mode: moves the selection by whole cells, keeping its size. */
export function moveGridSelection(deltaColumns, deltaRows) {
  if (!state.selection) return;
  const cell = cellSize();
  const spanColumns = Math.max(1, Math.round(state.selection.w / cell.w));
  const spanRows = Math.max(1, Math.round(state.selection.h / cell.h));
  const column = clamp(Math.round(state.selection.x / cell.w) + deltaColumns, 0, state.columns - spanColumns);
  const row = clamp(Math.round(state.selection.y / cell.h) + deltaRows, 0, state.rows - spanRows);
  selectCells([column, row], [column + spanColumns - 1, row + spanRows - 1]);
}

/* ---------- Free selection ---------- */

/** Selection drawn by dragging. Not tied to a saved region. */
export function setSelection(rect) {
  state.selection = rect;
  state.selectedRegion = -1;
  state.multiSelection.clear();
  notifyChange();
}

/**
 * Selection typed into the X/Y/W/H fields. Kept inside the sheet. If a saved
 * region is selected, it is updated too.
 */
export function editSelection(rect) {
  const x = clamp(rect.x, 0, state.width - 1);
  const y = clamp(rect.y, 0, state.height - 1);
  const edited = { x, y, w: clamp(rect.w, 1, state.width - x), h: clamp(rect.h, 1, state.height - y) };

  state.selection = edited;
  if (state.selectedRegion >= 0) {
    Object.assign(state.regions[state.selectedRegion], edited);
    state.liveDetect = false;
    saveSettings();
  }
  notifyChange();
}

export function clearSelection() {
  state.selection = null;
  state.selectedRegion = -1;
  state.multiSelection.clear();
  notifyChange();
}

/* ---------- Saved regions ---------- */

/** Index of the saved region under a point, or -1. The smallest one wins, so nested regions stay clickable. */
export function regionAt(point) {
  let best = -1;
  let bestArea = Infinity;
  state.regions.forEach((region, index) => {
    const inside =
      point.x >= region.x && point.x < region.x + region.w &&
      point.y >= region.y && point.y < region.y + region.h;
    const area = region.w * region.h;
    if (inside && area < bestArea) {
      best = index;
      bestArea = area;
    }
  });
  return best;
}

export function selectRegion(index) {
  const region = state.regions[index];
  if (!region) return;
  state.multiSelection.clear();
  state.selection = { x: region.x, y: region.y, w: region.w, h: region.h };
  state.selectedRegion = index;
  notifyChange();
}

/** Shift+click: adds or removes a region from the multi-selection. */
export function toggleRegionInSelection(index) {
  const picked = state.multiSelection;
  // Shift+clicking after a plain click keeps the first region in the set.
  if (picked.size === 0 && state.selectedRegion >= 0) picked.add(state.selectedRegion);

  if (picked.has(index)) picked.delete(index);
  else picked.add(index);

  const regions = [...picked].map((i) => state.regions[i]);
  state.selection = regions.length ? boundingRect(regions) : null;
  state.selectedRegion = picked.size === 1 ? [...picked][0] : -1;
  notifyChange();
}

/** Saves the current selection as a named region. Returns the name used. */
export function saveSelectionAsRegion(name) {
  if (!state.selection) return null;
  const finalName = name || `region_${state.regions.length + 1}`;
  state.regions.push({ name: finalName, ...state.selection });
  state.selectedRegion = state.regions.length - 1;
  state.multiSelection.clear();
  state.liveDetect = false;
  saveSettings();
  notifyChange();
  return finalName;
}

export function renameRegion(index, name) {
  state.regions[index].name = name || 'region';
  state.liveDetect = false;
  saveSettings();
  notifyChange();
}

export function deleteRegions(indices) {
  // Remove from the end so earlier indices stay valid.
  const sorted = [...new Set(indices)].sort((a, b) => b - a);
  for (const index of sorted) state.regions.splice(index, 1);
  state.liveDetect = false;
  saveSettings();
  clearSelection();
}

/** Delete key: removes the multi-selection, or else the selected region. */
export function deleteSelectedRegions() {
  if (state.multiSelection.size) deleteRegions([...state.multiSelection]);
  else if (state.selectedRegion >= 0) deleteRegions([state.selectedRegion]);
}

/** Replaces the multi-selected regions with one region covering all of them. Returns it, or null. */
export function mergeSelectedRegions() {
  const indices = [...state.multiSelection].sort((a, b) => a - b);
  if (indices.length < 2) return null;

  const first = indices[0];
  const merged = { name: state.regions[first].name, ...boundingRect(indices.map((i) => state.regions[i])) };

  for (const index of indices.slice(1).reverse()) state.regions.splice(index, 1);
  state.regions[first] = merged;

  state.liveDetect = false;
  saveSettings();
  selectRegion(first);
  return { region: merged, count: indices.length };
}

function boundingRect(rects) {
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.w));
  const bottom = Math.max(...rects.map((r) => r.y + r.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/* ---------- Auto-detect ---------- */

export function setDetectOption(key, value) {
  state.detect[key] = value;
  saveSettings();
}

/**
 * Detects the stickers and replaces the saved regions with them.
 * @param {{ rerun?: boolean }} options  rerun = triggered by a setting change,
 *   so keep the undo copy from the first run
 * @throws {Error} when the sheet has too many separate shapes
 */
export function runDetection({ rerun = false } = {}) {
  if (!state.sheet) return;

  const started = performance.now();
  const image = state.sheet.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, state.width, state.height);
  const { regions, shapeCount } = detectRegions(image, state.detect);
  const milliseconds = Math.round(performance.now() - started);

  if (!rerun) state.regionsBeforeDetect = state.regions.map((r) => ({ ...r }));

  // Name regions after the material: sheet_3_01, sheet_3_02, ...
  const baseName = state.material.split('/').pop().trim() || 'sticker';
  const digits = Math.max(2, String(regions.length).length);
  state.regions = regions.map((rect, i) => ({ name: `${baseName}_${String(i + 1).padStart(digits, '0')}`, ...rect }));

  state.mode = 'free';
  state.liveDetect = true;
  state.selection = null;
  state.selectedRegion = -1;
  state.multiSelection.clear();
  state.detectMessage =
    `Found ${plural(regions.length, 'region')} from ${plural(shapeCount, 'separate shape')} in ${milliseconds} ms. ` +
    'Changing a setting above re-runs detection until you edit a region by hand.';

  saveSettings();
  notifyChange();
}

export function undoDetection() {
  if (!state.regionsBeforeDetect) return;
  state.regions = state.regionsBeforeDetect;
  state.regionsBeforeDetect = null;
  state.liveDetect = false;
  state.detectMessage = '';
  saveSettings();
  clearSelection();
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}
