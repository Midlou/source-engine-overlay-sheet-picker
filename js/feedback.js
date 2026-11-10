/**
 * Small user feedback helpers: the toast message and copying to the clipboard.
 */

const toastElement = document.getElementById('toast');
const fallbackBox = document.getElementById('clipboardFallback');
const fallbackText = document.getElementById('clipboardFallbackText');

let toastTimer;

/** Shows a short message in the bottom-right corner. Errors stay up longer. */
export function toast(message, { error = false } = {}) {
  toastElement.textContent = message;
  toastElement.classList.toggle('error', error);
  toastElement.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastElement.hidden = true; }, error ? 5000 : 1600);
}

/**
 * Copies text to the clipboard. Must be called from a click handler.
 * When the browser refuses (plain http, old browsers), the text is shown
 * selected in a box so the user can press Ctrl+C.
 */
export function copyText(text, label) {
  fallbackBox.hidden = true;

  const showFallback = () => {
    fallbackBox.hidden = false;
    fallbackText.value = text;
    fallbackText.focus();
    fallbackText.select();
  };

  try {
    navigator.clipboard.writeText(text).then(() => toast(`Copied ${label}`), showFallback);
  } catch {
    showFallback();
  }
}
