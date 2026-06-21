// webui/src/toast.js
// Pengganti composables/useToast.ts versi Nuxt. Satu toast node ditempel
// langsung ke <body>, dikontrol lewat fungsi show/success/error/info.

let node = null;
let hideTimer = null;

function ensureNode() {
  if (node) return node;
  node = document.createElement("div");
  node.className = "toast";
  node.style.display = "none";
  document.body.appendChild(node);
  return node;
}

export function show(message, type = "info") {
  const n = ensureNode();
  n.textContent = message;
  n.className = "toast" + (type === "error" ? " is-error" : type === "success" ? " is-success" : "");
  n.style.display = "block";
  // restart fade-in animation
  n.classList.remove("is-visible");
  // force reflow supaya transition re-trigger tiap kali toast baru muncul
  void n.offsetWidth;
  n.classList.add("is-visible");

  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    n.classList.remove("is-visible");
    setTimeout(() => {
      if (n) n.style.display = "none";
    }, 180);
  }, 3200);
}

export const success = (message) => show(message, "success");
export const error = (message) => show(message, "error");
export const info = (message) => show(message, "info");
