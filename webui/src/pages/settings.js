// webui/src/pages/settings.js
// Editor buat AGENT.md & SOUL.md — dua "tab" yang nyimpen state textarea-nya
// sendiri-sendiri, dengan indikator unsaved-changes karena AGENT.md lumayan
// gede (puluhan KB instruksi terstruktur).

import * as api from "../api.js";
import * as toast from "../toast.js";

const FILES = [
  { key: "agent", label: "AGENT.md", desc: "Instruksi perilaku & aturan tool EMORA." },
  { key: "soul", label: "SOUL.md", desc: "Persona & gaya komunikasi EMORA." },
];

export async function mount(root) {
  root.innerHTML = `
    <div class="page page--settings">
      <div class="page__header">
        <span class="eyebrow">Konfigurasi</span>
        <h2>System Prompt</h2>
        <p class="page__lede">Edit langsung file AGENT.md &amp; SOUL.md yang dipakai EMORA sebagai system prompt. Perubahan langsung kepakai tanpa perlu restart.</p>
      </div>

      <div class="settings-tabs" data-tabs>
        ${FILES.map(
          (f, i) => `<button type="button" class="settings-tab${i === 0 ? " is-active" : ""}" data-tab="${f.key}">${f.label}<span class="dirty-dot" data-dirty-dot="${f.key}" hidden></span></button>`
        ).join("")}
      </div>

      <div class="card settings-editor" data-editor-wrap>
        <div class="empty-state"><span class="glyph">⋯</span><span>Memuat konfigurasi…</span></div>
      </div>
    </div>`;

  const tabsEl = root.querySelector("[data-tabs]");
  const editorWrap = root.querySelector("[data-editor-wrap]");

  const content = { agent: "", soul: "" };
  const original = { agent: "", soul: "" };
  let activeKey = "agent";

  function isDirty(key) {
    return content[key] !== original[key];
  }

  function updateDirtyDots() {
    for (const f of FILES) {
      const dot = root.querySelector(`[data-dirty-dot="${f.key}"]`);
      if (dot) dot.hidden = !isDirty(f.key);
    }
  }

  function renderEditor() {
    const meta = FILES.find((f) => f.key === activeKey);
    const dirty = isDirty(activeKey);
    editorWrap.innerHTML = `
      <div class="settings-editor__head">
        <p class="settings-editor__desc">${meta.desc}</p>
        <div class="settings-editor__actions">
          ${dirty ? `<span class="badge is-warn">Belum disimpan</span>` : `<span class="badge is-on">Tersimpan</span>`}
          <button type="button" class="btn btn-ghost" data-action="reset" ${dirty ? "" : "disabled"}>Batalkan</button>
          <button type="button" class="btn btn-primary" data-action="save" ${dirty ? "" : "disabled"}>Simpan</button>
        </div>
      </div>
      <textarea class="textarea settings-editor__textarea" data-editor-textarea spellcheck="false">${escapeForTextarea(content[activeKey])}</textarea>
      <div class="settings-editor__footer">
        <span>${content[activeKey].length.toLocaleString("id-ID")} karakter</span>
      </div>`;

    const textarea = editorWrap.querySelector("[data-editor-textarea]");
    textarea.addEventListener("input", () => {
      content[activeKey] = textarea.value;
      updateDirtyDots();
      const actions = editorWrap.querySelector(".settings-editor__actions");
      const dirtyNow = isDirty(activeKey);
      actions.querySelector('[data-action="reset"]').disabled = !dirtyNow;
      actions.querySelector('[data-action="save"]').disabled = !dirtyNow;
      actions.querySelector(".badge").outerHTML = dirtyNow
        ? `<span class="badge is-warn">Belum disimpan</span>`
        : `<span class="badge is-on">Tersimpan</span>`;
    });
  }

  function switchTab(key) {
    activeKey = key;
    for (const btn of root.querySelectorAll("[data-tab]")) {
      btn.classList.toggle("is-active", btn.dataset.tab === key);
    }
    renderEditor();
  }

  tabsEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-tab]");
    if (btn) switchTab(btn.dataset.tab);
  });

  editorWrap.addEventListener("click", async (e) => {
    const resetBtn = e.target.closest('[data-action="reset"]');
    if (resetBtn) {
      content[activeKey] = original[activeKey];
      updateDirtyDots();
      renderEditor();
      return;
    }
    const saveBtn = e.target.closest('[data-action="save"]');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = "Menyimpan…";
      try {
        await api.saveConfig({ [activeKey]: content[activeKey] });
        original[activeKey] = content[activeKey];
        updateDirtyDots();
        renderEditor();
        toast.success(`${FILES.find((f) => f.key === activeKey).label} disimpan.`);
      } catch (err) {
        toast.error(`Gagal menyimpan: ${err.message}`);
        renderEditor();
      }
    }
  });

  try {
    const data = await api.getConfig();
    content.agent = data.agent || "";
    content.soul = data.soul || "";
    original.agent = content.agent;
    original.soul = content.soul;
    renderEditor();
  } catch (err) {
    editorWrap.innerHTML = `<div class="empty-state"><span class="glyph">!</span><span>Gagal memuat konfigurasi: ${err.message}</span></div>`;
  }
}

function escapeForTextarea(str) {
  // textarea innerHTML cuma butuh escape & dan < supaya gak ke-parse sebagai tag
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;");
}
