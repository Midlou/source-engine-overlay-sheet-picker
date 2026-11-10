/**
 * Draws a 512×512 example sheet (a 4×4 grid of signs on a transparent
 * background), so the page shows something useful before a file is opened.
 */

const SIGNS = [
  { text: 'EXIT', background: '#1f8a4c', color: '#fff' },
  { text: 'NO ENTRY', background: '#b8262b', color: '#fff' },
  { text: 'B2', background: '#2a3a4a', color: '#f2c230' },
  { text: '→', background: '#1f8a4c', color: '#fff' },
  { text: 'WET FLOOR', background: '#f2c230', color: '#1a1a1a' },
  { text: 'A1', background: '#2a3a4a', color: '#fff' },
  { text: 'STAFF\nONLY', background: '#3a4a8c', color: '#fff' },
  { text: '←', background: '#1f8a4c', color: '#fff' },
  { text: 'DANGER', background: '#1a1a1a', color: '#f2c230' },
  { text: 'LOADING\nBAY', background: '#c45a1c', color: '#fff' },
  { text: '12', background: '#e8e4da', color: '#1a1a1a' },
  { text: '↑', background: '#1f8a4c', color: '#fff' },
  { text: 'OFFICE', background: '#5a6470', color: '#fff' },
  { text: 'C3', background: '#2a3a4a', color: '#7fd4ff' },
  { text: 'SECURITY', background: '#20262c', color: '#ff6b4a' },
  { text: '↓', background: '#1f8a4c', color: '#fff' },
];

const SHEET_SIZE = 512;
const CELL_SIZE = 128;
const MARGIN = 8; // transparent gap around each sign

export function createSampleSheet() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SHEET_SIZE;
  const ctx = canvas.getContext('2d');

  SIGNS.forEach((sign, index) => {
    const x = (index % 4) * CELL_SIZE;
    const y = Math.floor(index / 4) * CELL_SIZE;
    const size = CELL_SIZE - 2 * MARGIN;

    // Plate
    ctx.fillStyle = sign.background;
    ctx.beginPath();
    ctx.roundRect(x + MARGIN, y + MARGIN, size, size, 10);
    ctx.fill();

    // Inner border
    ctx.strokeStyle = sign.color;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(x + MARGIN + 6, y + MARGIN + 6, size - 12, size - 12, 6);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Text, one or two lines
    const lines = sign.text.split('\n');
    const isShort = sign.text.length <= 2;
    ctx.fillStyle = sign.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${isShort ? 52 : 17}px Arial, sans-serif`;
    lines.forEach((line, lineIndex) => {
      const offset = (lineIndex - (lines.length - 1) / 2) * 22;
      ctx.fillText(line, x + CELL_SIZE / 2, y + CELL_SIZE / 2 + offset);
    });
  });

  return canvas;
}
