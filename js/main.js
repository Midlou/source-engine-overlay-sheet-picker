/**
 * Entry point: connects the viewer, the panel and file loading, then opens
 * the built-in sample sheet.
 */

import { state, onChange } from './state.js';
import { setSheet } from './actions.js';
import { createViewer } from './viewer.js';
import { initPanel, renderPanel } from './panel.js';
import { loadSheetFile } from './loaders/index.js';
import { createSampleSheet } from './sample-sheet.js';
import { toast } from './feedback.js';

const $ = (id) => document.getElementById(id);
const viewport = $('viewport');
const dropHint = $('dropHint');

const viewer = createViewer({ canvas: $('sheetCanvas'), viewport, zoomLabel: $('zoomLabel') });
initPanel();

// Every state change redraws both halves of the page.
onChange(() => {
  renderPanel();
  viewer.render();
});

/* ---------- Opening files ---------- */

async function openFile(file) {
  try {
    const { canvas, description } = await loadSheetFile(file);
    const baseName = file.name.replace(/\.[^.]+$/, '');
    const label = `${file.name}  ·  ${canvas.width} × ${canvas.height}  ·  ${description}`;
    setSheet(canvas, `file:${file.name}`, label, `overlays/${baseName}`);
    viewer.fit();
    toast(`Opened ${file.name}`);
  } catch (error) {
    toast(error.message || 'Could not open that file.', { error: true });
  }
}

$('fileInput').addEventListener('change', (event) => {
  const file = event.target.files[0];
  event.target.value = ''; // so choosing the same file again still fires "change"
  if (file) openFile(file);
});

/* ---------- Drag and drop ---------- */

// dragenter/dragleave fire for every child element, so count them to know
// when the drag has really left the viewport.
let dragDepth = 0;

function hideDropHint() {
  dragDepth = 0;
  dropHint.hidden = true;
}

viewport.addEventListener('dragenter', (event) => {
  if (!event.dataTransfer.types.includes('Files')) return;
  event.preventDefault();
  dragDepth++;
  dropHint.hidden = false;
});

viewport.addEventListener('dragleave', () => {
  dragDepth--;
  if (dragDepth <= 0) hideDropHint();
});

viewport.addEventListener('drop', (event) => {
  event.preventDefault();
  hideDropHint();
  const file = event.dataTransfer.files[0];
  if (file) openFile(file);
});

// Allow dropping, hide the hint however the drag ends, and stop a file dropped
// outside the viewport from making the browser navigate away to it.
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => {
  event.preventDefault();
  hideDropHint();
});
window.addEventListener('dragend', hideDropHint);

/* ---------- Help texts ---------- */

// Explanations under the fields are hidden by default. The choice is
// remembered for every sheet, separately from the per-sheet settings.
const HELP_STORAGE_KEY = 'overlay-sheet-picker:show-help';
const showHelpCheckbox = $('showHelp');

function setHelpVisible(visible) {
  document.body.classList.toggle('show-help', visible);
  showHelpCheckbox.checked = visible;
}

try {
  setHelpVisible(localStorage.getItem(HELP_STORAGE_KEY) === 'true');
} catch {
  setHelpVisible(false);
}

showHelpCheckbox.addEventListener('change', () => {
  setHelpVisible(showHelpCheckbox.checked);
  try {
    localStorage.setItem(HELP_STORAGE_KEY, String(showHelpCheckbox.checked));
  } catch {
    // Storage unavailable: the setting just isn't remembered.
  }
});

/* ---------- Zoom buttons ---------- */

$('zoomIn').addEventListener('click', () => viewer.stepZoom(1));
$('zoomOut').addEventListener('click', () => viewer.stepZoom(-1));
$('zoomFit').addEventListener('click', () => viewer.fit());
$('zoomActual').addEventListener('click', () => viewer.setZoom(1));

/* ---------- Redraw on theme or size changes ---------- */

// Canvas colors come from CSS tokens, so redraw when the theme changes.
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', viewer.render);
new MutationObserver(viewer.render).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['data-theme'],
});

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(viewer.render, 100);
});

/* ---------- Start ---------- */

setSheet(createSampleSheet(), 'sample', 'Sample sheet (example, 512 × 512)', 'overlays/sample_sheet');
viewer.fit();

// Exposed for debugging in the browser console.
window.overlaySheetPicker = { state };
