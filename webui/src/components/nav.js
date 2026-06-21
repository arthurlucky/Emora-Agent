// webui/src/components/nav.js
// Nav bar atas: traffic-light dots ala terminal + prompt-style brand text
// di kiri, tab navigasi (chat/gateway/config) di kanan. Navigasi link
// ditangani secara global oleh router.js lewat atribut [data-link].

const TABS = [
  { path: "/", label: "chat", idx: "0001" },
  { path: "/gateway", label: "gateway", idx: "0002" },
  { path: "/settings", label: "config", idx: "0003" },
];

export function renderNav(container, activePath) {
  if (!container) return;

  container.innerHTML = `
    <nav class="app-nav">
      <div class="app-nav__brand">
        <div class="app-nav__dots">
          <span class="dot dot-red"></span>
          <span class="dot dot-amber"></span>
          <span class="dot dot-green"></span>
        </div>
        <div class="app-nav__prompt">
          <span class="prompt-user">emora</span><span class="prompt-dim">@</span><span class="prompt-host">webui</span><span class="prompt-dim"> ~</span>
          <span class="app-nav__subtitle">control panel</span>
        </div>
      </div>
      <div class="app-nav__tabs">
        ${TABS.map(
          (tab) => `
          <a
            href="${tab.path}"
            data-link
            class="app-nav__tab${tab.path === activePath ? " is-active" : ""}"
          >
            <span class="app-nav__tab-idx">${tab.idx}</span>
            <span class="app-nav__tab-label">${tab.label}</span>
          </a>`
        ).join("")}
      </div>
    </nav>
  `;
}
