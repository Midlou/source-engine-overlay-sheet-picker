/**
 * The sheet view on the left: draws the sheet with the grid, saved regions
 * and selection on a canvas, and turns mouse, keyboard and wheel input into
 * actions.
 */

import { state } from './state.js';
import * as actions from './actions.js';

const ZOOM_STEPS = [0.125, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16];
const MAX_CANVAS_SIZE = 8192; // browsers refuse canvases much larger than this
const DRAG_THRESHOLD = 3;     // screen pixels before a click becomes a drag

/**
 * @param {object} elements
 * @param {HTMLCanvasElement} elements.canvas
 * @param {HTMLElement} elements.viewport   the scrolling container
 * @param {HTMLElement} elements.zoomLabel
 */
export function createViewer({ canvas, viewport, zoomLabel }) {
  /* ---------- Drawing ---------- */

  function render() {
    if (!state.sheet) return;

    const zoom = state.zoom;
    const cssWidth = Math.max(1, Math.round(state.width * zoom));
    const cssHeight = Math.max(1, Math.round(state.height * zoom));
    // Draw at device resolution, but never past the browser's canvas size limit.
    const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_CANVAS_SIZE / Math.max(cssWidth, cssHeight));

    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    canvas.width = Math.max(1, Math.round(cssWidth * pixelRatio));
    canvas.height = Math.max(1, Math.round(cssHeight * pixelRatio));

    const ctx = canvas.getContext('2d');
    // From here on, drawing coordinates are sheet pixels.
    ctx.setTransform(pixelRatio * zoom, 0, 0, pixelRatio * zoom, 0, 0);
    ctx.imageSmoothingEnabled = zoom < 1; // crisp texels when zoomed in
    ctx.clearRect(0, 0, state.width, state.height);
    ctx.drawImage(state.sheet, 0, 0);

    const hairline = 1 / zoom; // one screen pixel, in sheet pixels
    const colors = {
      accent: cssToken('--accent'),
      selection: cssToken('--selection'),
    };

    if (state.mode === 'grid') drawGrid(ctx, hairline, colors);
    drawSavedRegions(ctx, hairline, colors);
    drawSelection(ctx, hairline, colors);
  }

  function drawGrid(ctx, hairline, colors) {
    const cell = actions.cellSize();
    ctx.strokeStyle = colors.accent;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = hairline;
    ctx.beginPath();
    for (let column = 1; column < state.columns; column++) {
      ctx.moveTo(column * cell.w, 0);
      ctx.lineTo(column * cell.w, state.height);
    }
    for (let row = 1; row < state.rows; row++) {
      ctx.moveTo(0, row * cell.h);
      ctx.lineTo(state.width, row * cell.h);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawSavedRegions(ctx, hairline, colors) {
    state.regions.forEach((region, index) => {
      if (index === state.selectedRegion) return; // drawn as the selection instead

      if (state.multiSelection.has(index)) {
        ctx.strokeStyle = colors.selection;
        ctx.lineWidth = 2 * hairline;
        ctx.strokeRect(region.x, region.y, region.w, region.h);
        return;
      }

      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = hairline;
      ctx.setLineDash([4 * hairline, 3 * hairline]);
      ctx.strokeRect(region.x, region.y, region.w, region.h);
      ctx.setLineDash([]);

      // Name label, when there's room for it
      if (state.mode === 'free' && region.w * state.zoom > 40) {
        ctx.font = `${11 * hairline}px Consolas, monospace`;
        ctx.fillStyle = colors.accent;
        ctx.textBaseline = 'top';
        ctx.fillText(region.name, region.x + 3 * hairline, region.y + 3 * hairline, region.w - 6 * hairline);
      }
    });
  }

  function drawSelection(ctx, hairline, colors) {
    const selection = state.selection;
    if (!selection) return;

    // Dim everything outside the selection (even-odd fill leaves a hole).
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.beginPath();
    ctx.rect(0, 0, state.width, state.height);
    ctx.rect(selection.x, selection.y, selection.w, selection.h);
    ctx.fill('evenodd');

    ctx.strokeStyle = colors.selection;
    ctx.lineWidth = 2 * hairline;
    ctx.strokeRect(selection.x, selection.y, selection.w, selection.h);

    // Dashed line where the UVs actually sit after the inset, once it's visible.
    const inset = Math.min(state.inset, selection.w / 2, selection.h / 2);
    if (inset > 0 && inset * state.zoom >= 2) {
      ctx.lineWidth = hairline;
      ctx.setLineDash([3 * hairline, 3 * hairline]);
      ctx.strokeRect(selection.x + inset, selection.y + inset, selection.w - 2 * inset, selection.h - 2 * inset);
      ctx.setLineDash([]);
    }
  }

  /* ---------- Zoom ---------- */

  /**
   * @param {number} zoom
   * @param {{x:number,y:number}} [anchor]  screen point that should stay under the cursor
   */
  function setZoom(zoom, anchor) {
    const previousZoom = state.zoom;
    let anchorOnSheet;
    if (anchor) {
      const box = canvas.getBoundingClientRect();
      anchorOnSheet = { x: (anchor.x - box.left) / previousZoom, y: (anchor.y - box.top) / previousZoom };
    }

    state.zoom = Math.max(0.05, Math.min(32, zoom));
    zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
    render();

    if (anchor) {
      const box = canvas.getBoundingClientRect();
      viewport.scrollLeft += box.left + anchorOnSheet.x * state.zoom - anchor.x;
      viewport.scrollTop += box.top + anchorOnSheet.y * state.zoom - anchor.y;
    }
  }

  let fitPending = false;

  function fit() {
    const padding = 48; // matches the stage padding on both sides
    const availableWidth = viewport.clientWidth - padding;
    const availableHeight = viewport.clientHeight - padding;

    // The viewport has no size yet (page still laying out, or hidden). Fit as soon as it does.
    if (availableWidth <= 0 || availableHeight <= 0) {
      fitPending = true;
      return;
    }
    fitPending = false;
    setZoom(Math.max(0.05, Math.min(availableWidth / state.width, availableHeight / state.height)));
  }

  new ResizeObserver(() => {
    if (fitPending) fit();
  }).observe(viewport);

  /** Moves to the next zoom step in `direction` (+1 in, -1 out). */
  function stepZoom(direction, anchor) {
    const current = state.zoom;
    const next = direction > 0
      ? ZOOM_STEPS.find((step) => step > current * 1.001)
      : [...ZOOM_STEPS].reverse().find((step) => step < current * 0.999);
    if (next) setZoom(next, anchor);
  }

  /* ---------- Pointer input ---------- */

  let drag = null; // { start: sheet point, startScreen: {x,y}, moved: boolean }

  /** Converts a mouse event to sheet pixel coordinates. */
  function toSheetPoint(event) {
    const box = canvas.getBoundingClientRect();
    return { x: (event.clientX - box.left) / state.zoom, y: (event.clientY - box.top) / state.zoom };
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !state.sheet) return;
    try {
      canvas.setPointerCapture(event.pointerId); // keep receiving moves outside the canvas
    } catch {
      // Not every pointer can be captured; dragging still works inside the canvas.
    }
    canvas.focus({ preventScroll: true });

    const point = toSheetPoint(event);
    drag = { start: point, startScreen: { x: event.clientX, y: event.clientY }, moved: false };

    if (state.mode === 'grid') {
      const cell = actions.cellAt(point);
      actions.selectCells(cell, cell);
    }
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const point = toSheetPoint(event);
    const distance = Math.hypot(event.clientX - drag.startScreen.x, event.clientY - drag.startScreen.y);
    if (distance > DRAG_THRESHOLD) drag.moved = true;

    if (state.mode === 'grid') {
      actions.selectCells(actions.cellAt(drag.start), actions.cellAt(point));
    } else if (drag.moved) {
      actions.setSelection(rectFromDrag(drag.start, point));
    }
  });

  canvas.addEventListener('pointerup', (event) => {
    if (!drag) return;
    const wasClick = !drag.moved;
    drag = null;
    if (state.mode !== 'free' || !wasClick) return;

    // A click in free mode picks a saved region.
    const hit = actions.regionAt(toSheetPoint(event));
    if (hit >= 0) {
      if (event.shiftKey) actions.toggleRegionInSelection(hit);
      else actions.selectRegion(hit);
    } else if (!event.shiftKey) {
      actions.clearSelection();
    }
  });

  canvas.addEventListener('pointercancel', () => { drag = null; });

  /** Rectangle between two points, snapped outward to whole pixels and kept inside the sheet. */
  function rectFromDrag(a, b) {
    const left = clampInt(Math.floor(Math.min(a.x, b.x)), 0, state.width - 1);
    const top = clampInt(Math.floor(Math.min(a.y, b.y)), 0, state.height - 1);
    const right = clampInt(Math.ceil(Math.max(a.x, b.x)), left + 1, state.width);
    const bottom = clampInt(Math.ceil(Math.max(a.y, b.y)), top + 1, state.height);
    return { x: left, y: top, w: right - left, h: bottom - top };
  }

  /* ---------- Keyboard and wheel ---------- */

  const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

  canvas.addEventListener('keydown', (event) => {
    if (state.mode === 'free' && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault();
      actions.deleteSelectedRegions();
      return;
    }
    const arrow = ARROWS[event.key];
    if (state.mode === 'grid' && arrow) {
      event.preventDefault();
      actions.moveGridSelection(arrow[0], arrow[1]);
    }
  });

  // Ctrl + wheel zooms around the cursor; a plain wheel scrolls as usual.
  viewport.addEventListener('wheel', (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    stepZoom(event.deltaY < 0 ? 1 : -1, { x: event.clientX, y: event.clientY });
  }, { passive: false });

  return { render, fit, setZoom, stepZoom };
}

function clampInt(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function cssToken(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
