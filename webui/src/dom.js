// webui/src/dom.js
// Helper kecil buat kerja sama DOM tanpa framework. Sengaja minimalis —
// EMORA web UI ini gak butuh virtual DOM, cukup innerHTML + event delegation.

/** Escape string biar aman dipasang ke innerHTML (cegah XSS dari nama sesi, isi chat, dll). */
export function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** querySelector shortcut, scoped ke root opsional. */
export function qs(selector, root = document) {
  return root.querySelector(selector);
}

/** querySelectorAll shortcut yang langsung balikin array (bukan NodeList). */
export function qsa(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

/**
 * Bikin elemen lewat object props ringkas. Dipakai buat node sekali pakai
 * (toast, dsb) di luar template string biasa.
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value !== undefined && value !== null) {
      node.setAttribute(key, value);
    }
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}
