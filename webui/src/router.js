// webui/src/router.js
// Router super ringan berbasis History API. Gak ada dependency — cukup
// untuk 3 halaman EMORA Control Panel (chat, gateway, settings).
// server.js sudah punya SPA fallback (semua GET non-/api -> index.html)
// jadi navigasi langsung ke URL (refresh / ketik manual) tetap jalan.

const routes = [];
let mainContainer = null;
let navContainer = null;
let renderNav = null;
let currentCleanup = null;

export function registerRoute(path, mount) {
  routes.push({ path, mount });
}

function matchRoute(pathname) {
  return routes.find((r) => r.path === pathname) || routes.find((r) => r.path === "/");
}

async function render(pathname) {
  const route = matchRoute(pathname);
  if (!route) return;

  if (typeof currentCleanup === "function") {
    try {
      currentCleanup();
    } catch {
      // ignore cleanup errors, jangan sampai blokir navigasi
    }
    currentCleanup = null;
  }

  if (renderNav) renderNav(navContainer, pathname);

  mainContainer.innerHTML = "";
  const result = await route.mount(mainContainer);
  if (typeof result === "function") currentCleanup = result;
}

export function navigate(path, { replace = false } = {}) {
  if (path === window.location.pathname) {
    render(path);
    return;
  }
  if (replace) {
    window.history.replaceState({}, "", path);
  } else {
    window.history.pushState({}, "", path);
  }
  render(path);
}

export function initRouter({ main, nav, navRenderer }) {
  mainContainer = main;
  navContainer = nav;
  renderNav = navRenderer;

  // Intercept klik di link internal (<a data-link href="/gateway">)
  document.addEventListener("click", (e) => {
    const anchor = e.target.closest("[data-link]");
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("http") || anchor.target === "_blank") return;
    e.preventDefault();
    navigate(href);
  });

  window.addEventListener("popstate", () => render(window.location.pathname));

  render(window.location.pathname);
}
