/**
 * Application state shared by every module, plus saving it in localStorage.
 *
 * Modules change `state` directly (through the functions in actions.js) and
 * then call `notifyChange()`. main.js listens and redraws the canvas and the
 * side panel.
 *
 * Coordinates are in sheet pixels. A rectangle is { x, y, w, h }.
 */

const STORAGE_PREFIX = 'overlay-sheet-picker:';

export const state = {
  // The loaded sheet
  sheet: null,            // HTMLCanvasElement with the decoded image
  sheetKey: 'sample',     // identifies the sheet in localStorage (its file name)
  sheetLabel: '',         // text shown in the top bar
  width: 0,
  height: 0,

  // Layout settings (saved per sheet)
  mode: 'grid',           // 'grid' = click cells, 'free' = drag rectangles
  columns: 4,
  rows: 4,
  inset: 0.5,             // pixels to pull each UV edge inward
  reverseU: false,        // Hammer's default on the face is U Start = 1, U End = 0
  reverseV: false,        // Hammer's default on the face is V Start = 1, V End = 0
  material: 'overlays/sample_sheet',

  // Saved regions (saved per sheet) and the current selection
  regions: [],            // [{ name, x, y, w, h }]
  selection: null,        // the rectangle the UV values are computed from
  selectedRegion: -1,     // index into `regions`, or -1 when the selection isn't a saved region
  multiSelection: new Set(), // region indices picked with Shift+click

  // Auto-detect settings (saved per sheet) and status
  detect: {
    background: 'alpha',  // 'alpha' or 'solid'
    threshold: 16,
    mergeGap: 0,
    minSize: 8,
    padding: 0,
  },
  regionsBeforeDetect: null, // kept for "Undo detect"
  liveDetect: false,         // re-run detection when a setting changes
  detectMessage: '',

  // View
  zoom: 1,
};

/* ---------- Change notification ---------- */

const listeners = [];

export function onChange(listener) {
  listeners.push(listener);
}

export function notifyChange() {
  for (const listener of listeners) listener();
}

/* ---------- Persistence ---------- */

/** The part of the state that is saved per sheet and exported as JSON. */
export function getSettings() {
  return {
    mode: state.mode,
    columns: state.columns,
    rows: state.rows,
    inset: state.inset,
    reverseU: state.reverseU,
    reverseV: state.reverseV,
    material: state.material,
    detect: { ...state.detect },
    regions: state.regions.map(({ name, x, y, w, h }) => ({ name, x, y, w, h })),
  };
}

/** Saves the current sheet's settings. Storage can be unavailable (private windows), so failures are ignored. */
export function saveSettings() {
  try {
    localStorage.setItem(STORAGE_PREFIX + state.sheetKey, JSON.stringify(getSettings()));
  } catch {
    // Nothing to do: the app works without storage.
  }
}

export function loadSettings(sheetKey) {
  try {
    const text = localStorage.getItem(STORAGE_PREFIX + sheetKey);
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/**
 * Copies validated values from saved settings (localStorage or a loaded JSON
 * file) into the state. Unknown or invalid values are ignored.
 */
export function applySettings(saved) {
  if (!saved || typeof saved !== 'object') return;

  if (saved.mode === 'grid' || saved.mode === 'free') state.mode = saved.mode;
  if (isCount(saved.columns)) state.columns = Math.min(64, Math.floor(saved.columns));
  if (isCount(saved.rows)) state.rows = Math.min(64, Math.floor(saved.rows));
  if (isNonNegative(saved.inset)) state.inset = saved.inset;
  if (typeof saved.reverseU === 'boolean') state.reverseU = saved.reverseU;
  if (typeof saved.reverseV === 'boolean') state.reverseV = saved.reverseV;
  if (typeof saved.material === 'string') state.material = saved.material;

  const detect = saved.detect;
  if (detect && typeof detect === 'object') {
    if (detect.background === 'alpha' || detect.background === 'solid') state.detect.background = detect.background;
    for (const key of ['threshold', 'mergeGap', 'minSize', 'padding']) {
      if (isNonNegative(detect[key])) state.detect[key] = detect[key];
    }
  }

  if (Array.isArray(saved.regions)) {
    state.regions = saved.regions
      .filter((r) => r && r.w > 0 && r.h > 0)
      .map((r) => ({ name: String(r.name || 'region'), x: Number(r.x), y: Number(r.y), w: Number(r.w), h: Number(r.h) }));
  }
}

const isCount = (value) => Number.isFinite(value) && value >= 1;
const isNonNegative = (value) => Number.isFinite(value) && value >= 0;
