/**
 * Turns a dropped or chosen file into a canvas the rest of the app can use.
 * VTF and TGA are decoded here; PNG, JPEG, WebP, BMP and GIF use the browser.
 */

import { decodeVtf } from './vtf.js';
import { decodeTga } from './tga.js';

/**
 * @param {File} file
 * @returns {Promise<{ canvas: HTMLCanvasElement, description: string }>}
 */
export async function loadSheetFile(file) {
  const extension = (file.name.split('.').pop() || '').toLowerCase();

  if (extension === 'vtf' || extension === 'tga') {
    const buffer = await file.arrayBuffer();
    const image = extension === 'vtf' ? decodeVtf(buffer) : decodeTga(buffer);
    return { canvas: rgbaToCanvas(image.rgba, image.width, image.height), description: image.description };
  }

  const bitmap = await createImageBitmap(file);
  const canvas = createCanvas(bitmap.width, bitmap.height);
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close();
  return { canvas, description: extension.toUpperCase() };
}

function rgbaToCanvas(rgba, width, height) {
  const canvas = createCanvas(width, height);
  canvas.getContext('2d').putImageData(new ImageData(rgba, width, height), 0, 0);
  return canvas;
}

function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
