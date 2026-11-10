/**
 * The settings panel on the right: connects its fields and buttons to the
 * actions, and shows the current state (UV values, saved regions, ...).
 */

import { state, getSettings } from './state.js';
import * as actions from './actions.js';
import { computeOverlayUV, formatUV, keyvaluesSnippet, UV_KEYS } from './uv.js';
import { toast, copyText } from './feedback.js';

const $ = (id) => document.getElementById(id);

const el = {
  fileLabel: $('fileLabel'),
  modeHint: $('modeHint'),
  gridColumns: $('gridColumns'),
  gridRows: $('gridRows'),
  inset: $('insetInput'),
  material: $('materialInput'),

  detectThreshold: $('detectThreshold'),
  detectMergeGap: $('detectMergeGap'),
  detectMinSize: $('detectMinSize'),
  detectPadding: $('detectPadding'),
  detectButton: $('detectButton'),
  undoDetectButton: $('undoDetectButton'),
  detectInfo: $('detectInfo'),

  uvValues: Object.fromEntries(UV_KEYS.map((key) => [key, $(`value${key}`)])),
  sizeInfo: $('sizeInfo'),
  selectionFields: { x: $('selectionX'), y: $('selectionY'), w: $('selectionW'), h: $('selectionH') },
  snippet: $('snippet'),
  copySnippetButton: $('copySnippetButton'),

  regionNameInput: $('regionNameInput'),
  saveRegionButton: $('saveRegionButton'),
  regionList: $('regionList'),
  mergeButton: $('mergeButton'),
  copyJsonButton: $('copyJsonButton'),
  jsonInput: $('jsonInput'),
};

const MODE_HINTS = {
  grid: 'Click a cell, or drag across cells for a sticker that spans several. Arrow keys move the selection.',
  free: 'Drag a rectangle (snaps to whole pixels). Click a saved region to select it, Shift+click to select several. Fine-tune with X, Y, W and H.',
};

/** UV values for a rectangle with the current inset and face orientation. */
function uvFor(rect) {
  return computeOverlayUV(rect, state.width, state.height, {
    inset: state.inset,
    reverseU: state.reverseU,
    reverseV: state.reverseV,
  });
}

/* ---------- Rendering ---------- */

export function renderPanel() {
  el.fileLabel.textContent = state.sheetLabel;
  renderSettings();
  renderDetectStatus();
  renderSelection();
  renderRegionList();
}

function renderSettings() {
  checkRadio('mode', state.mode);
  checkRadio('background', state.detect.background);
  checkRadio('orientation', `${state.reverseU ? 1 : 0}${state.reverseV ? 1 : 0}`);

  setFieldValue(el.gridColumns, state.columns);
  setFieldValue(el.gridRows, state.rows);
  setFieldValue(el.inset, state.inset);
  setFieldValue(el.material, state.material);
  setFieldValue(el.detectThreshold, state.detect.threshold);
  setFieldValue(el.detectMergeGap, state.detect.mergeGap);
  setFieldValue(el.detectMinSize, state.detect.minSize);
  setFieldValue(el.detectPadding, state.detect.padding);

  el.gridColumns.disabled = el.gridRows.disabled = state.mode !== 'grid';
  el.modeHint.textContent = MODE_HINTS[state.mode];
}

function renderDetectStatus() {
  el.undoDetectButton.hidden = !state.regionsBeforeDetect;
  el.detectInfo.hidden = !state.detectMessage;
  el.detectInfo.textContent = state.detectMessage;
}

function renderSelection() {
  const selection = state.selection;
  const uv = selection ? uvFor(selection) : null;

  for (const key of UV_KEYS) el.uvValues[key].textContent = uv ? formatUV(uv[key]) : '–';
  for (const [key, field] of Object.entries(el.selectionFields)) {
    setFieldValue(field, selection ? round2(selection[key]) : '');
  }

  if (selection) {
    // Hammer's default texture scale is 0.25 units per texel.
    el.sizeInfo.textContent =
      `${round2(selection.w)} × ${round2(selection.h)} px  ·  aspect ${round3(selection.w / selection.h)}  ·  ` +
      `${round2(selection.w * 0.25)} × ${round2(selection.h * 0.25)} units at 0.25 texture scale`;
  } else {
    el.sizeInfo.textContent = 'No selection';
  }

  el.snippet.textContent = uv ? keyvaluesSnippet(uv, state.material) : '';
}

function renderRegionList() {
  const list = el.regionList;
  list.textContent = '';

  el.mergeButton.hidden = state.multiSelection.size < 2;
  el.mergeButton.textContent = `Merge ${state.multiSelection.size} selected`;

  if (state.regions.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'No saved regions yet. Select one on the sheet, name it, then press Save. Or use Detect regions.';
    list.append(empty);
    return;
  }

  state.regions.forEach((region, index) => {
    const item = document.createElement('li');
    if (index === state.selectedRegion || state.multiSelection.has(index)) item.className = 'selected';

    const nameInput = document.createElement('input');
    nameInput.className = 'text-input';
    nameInput.id = `regionName${index}`;
    nameInput.value = region.name;
    nameInput.setAttribute('aria-label', 'Region name');
    nameInput.addEventListener('change', () => actions.renameRegion(index, nameInput.value.trim()));

    const selectButton = button('Select', 'btn small', (event) => {
      if (event.shiftKey) actions.toggleRegionInSelection(index);
      else actions.selectRegion(index);
    });

    const deleteButton = button('Delete', 'btn small danger', () => actions.deleteRegions([index]));

    const uv = uvFor(region);
    const uvLine = document.createElement('div');
    uvLine.className = 'region-uv';
    uvLine.textContent =
      `U ${formatUV(uv.StartU)}–${formatUV(uv.EndU)}   V ${formatUV(uv.StartV)}–${formatUV(uv.EndV)}`;

    item.append(nameInput, selectButton, deleteButton, uvLine);
    list.append(item);
  });
}

/* ---------- Wiring ---------- */

let detectTimer;

export function initPanel() {
  // Sheet layout
  onRadioChange('mode', (value) => actions.setMode(value));
  for (const field of [el.gridColumns, el.gridRows]) {
    field.addEventListener('input', () => {
      const columns = parseInt(el.gridColumns.value, 10);
      const rows = parseInt(el.gridRows.value, 10);
      if (inRange(columns, 1, 64) && inRange(rows, 1, 64)) actions.setGridSize(columns, rows);
    });
  }
  el.inset.addEventListener('input', () => {
    const inset = parseFloat(el.inset.value);
    if (inset >= 0) actions.updateSetting('inset', inset);
  });
  el.material.addEventListener('input', () => actions.updateSetting('material', el.material.value));

  // Auto-detect
  onRadioChange('background', (value) => {
    actions.setDetectOption('background', value);
    // A sensible starting threshold for each background type.
    actions.setDetectOption('threshold', value === 'alpha' ? 16 : 24);
    rerunDetectionIfLive();
  });
  const detectFields = [
    [el.detectThreshold, 'threshold'],
    [el.detectMergeGap, 'mergeGap'],
    [el.detectMinSize, 'minSize'],
    [el.detectPadding, 'padding'],
  ];
  for (const [field, key] of detectFields) {
    field.addEventListener('input', () => {
      const value = parseFloat(field.value);
      if (!(value >= 0)) return;
      actions.setDetectOption(key, Math.round(value));
      rerunDetectionIfLive();
    });
  }
  el.detectButton.addEventListener('click', () => detect(false));
  el.undoDetectButton.addEventListener('click', () => {
    actions.undoDetection();
    toast('Restored the regions from before detection');
  });

  // Overlay UVs
  // Radio values are two digits: "10" means U reversed, V not.
  onRadioChange('orientation', (value) => actions.setOrientation(value[0] === '1', value[1] === '1'));
  for (const field of Object.values(el.selectionFields)) {
    field.addEventListener('change', () => {
      if (!state.selection) return;
      const rect = Object.fromEntries(Object.entries(el.selectionFields).map(([key, input]) => [key, Number(input.value)]));
      if (Object.values(rect).every(Number.isFinite)) actions.editSelection(rect);
    });
  }
  for (const copyButton of document.querySelectorAll('[data-copy]')) {
    copyButton.addEventListener('click', () => {
      if (!state.selection) return toast('Select a region on the sheet first.', { error: true });
      const key = copyButton.dataset.copy;
      copyText(formatUV(uvFor(state.selection)[key]), key);
    });
  }
  el.copySnippetButton.addEventListener('click', () => {
    if (!state.selection) return toast('Select a region on the sheet first.', { error: true });
    copyText(keyvaluesSnippet(uvFor(state.selection), state.material), 'keyvalues');
  });

  // Saved regions
  el.saveRegionButton.addEventListener('click', () => {
    const name = actions.saveSelectionAsRegion(el.regionNameInput.value.trim());
    if (!name) return toast('Select a region on the sheet first.', { error: true });
    el.regionNameInput.value = '';
    toast(`Saved ${name}`);
  });
  el.regionNameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') el.saveRegionButton.click();
  });
  el.mergeButton.addEventListener('click', () => {
    const result = actions.mergeSelectedRegions();
    if (result) toast(`Merged ${result.count} regions into ${result.region.name}`);
  });

  // JSON export / import
  el.copyJsonButton.addEventListener('click', () => copyText(JSON.stringify(buildExport(), null, 2), 'JSON'));
  el.jsonInput.addEventListener('change', async () => {
    const file = el.jsonInput.files[0];
    el.jsonInput.value = '';
    if (!file) return;
    try {
      actions.importSettings(JSON.parse(await file.text()));
      toast(`Loaded ${file.name}`);
    } catch {
      toast('That file is not valid picker JSON.', { error: true });
    }
  });
}

function detect(rerun) {
  try {
    actions.runDetection({ rerun });
  } catch (error) {
    toast(error.message, { error: true });
  }
}

/** While detection is "live", setting changes re-run it after a short pause. */
function rerunDetectionIfLive() {
  if (!state.liveDetect) return;
  clearTimeout(detectTimer);
  detectTimer = setTimeout(() => detect(true), 150);
}

/** The JSON from "Copy JSON": the saved settings plus each region's UV values. */
function buildExport() {
  const settings = getSettings();
  return {
    sheet: state.sheetKey,
    width: state.width,
    height: state.height,
    ...settings,
    regions: settings.regions.map((region) => {
      const uv = uvFor(region);
      return { ...region, ...Object.fromEntries(UV_KEYS.map((key) => [key, Number(formatUV(uv[key]))])) };
    }),
  };
}

/* ---------- Small DOM helpers ---------- */

function checkRadio(name, value) {
  const radio = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (radio) radio.checked = true;
}

function onRadioChange(name, handler) {
  for (const radio of document.querySelectorAll(`input[name="${name}"]`)) {
    radio.addEventListener('change', () => handler(radio.value));
  }
}

/** Updates a field unless the user is typing in it. */
function setFieldValue(field, value) {
  if (document.activeElement !== field) field.value = value;
}

function button(text, className, onClick) {
  const element = document.createElement('button');
  element.className = className;
  element.textContent = text;
  element.addEventListener('click', onClick);
  return element;
}

const inRange = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const round2 = (value) => String(Number(value.toFixed(2)));
const round3 = (value) => String(Number(value.toFixed(3)));
