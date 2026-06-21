// webui/src/components/sessionList.js
// Sidebar daftar sesi chat. Dipakai di halaman chat. Pakai pola
// "createX(container, handlers) -> { render(state) }": listener event
// dipasang sekali di container (delegation), render() cuma ganti innerHTML
// jadi gak perlu re-attach listener tiap update.

import { escapeHtml } from "../dom.js";
import { formatRelative, shortId } from "../format.js";

export function createSessionList(container, handlers) {
  let editingId = null;

  function renderItem(session, activeId) {
    const isActive = session.id === activeId;
    const isEditing = session.id === editingId;
    const name = session.name || `Sesi ${shortId(session.id)}`;

    if (isEditing) {
      return `
        <li class="session-item is-editing" data-id="${session.id}">
          <form data-action="rename-form" data-id="${session.id}" class="session-item__rename-form">
            <input
              type="text"
              class="input session-item__rename-input"
              data-rename-input
              value="${escapeHtml(name)}"
              maxlength="60"
              autocomplete="off"
            />
          </form>
        </li>`;
    }

    return `
      <li class="session-item${isActive ? " is-active" : ""}" data-id="${session.id}">
        <button type="button" class="session-item__main" data-action="select" data-id="${session.id}">
          <span class="session-item__name">${escapeHtml(name)}</span>
          <span class="session-item__meta">
            <span class="session-item__id">#${shortId(session.id)}</span>
            <span class="session-item__dot">·</span>
            <span class="session-item__time">${formatRelative(session.updatedAt)}</span>
            <span class="session-item__dot">·</span>
            <span class="session-item__count">${session.messageCount ?? 0} pesan</span>
          </span>
        </button>
        <span class="session-item__actions">
          <button type="button" class="icon-btn" data-action="rename" data-id="${session.id}" title="Ganti nama">✎</button>
          <button type="button" class="icon-btn icon-btn--danger" data-action="delete" data-id="${session.id}" title="Hapus sesi">✕</button>
        </span>
      </li>`;
  }

  function render(state) {
    const { sessions = [], activeId = null, loading = false } = state;

    if (loading) {
      container.innerHTML = `
        <div class="session-sidebar__header">
          <span class="eyebrow">Sesi</span>
          <button type="button" class="btn btn-ghost" disabled>+ Baru</button>
        </div>
        <div class="empty-state"><span class="glyph">⋯</span><span>Memuat sesi…</span></div>`;
      return;
    }

    container.innerHTML = `
      <div class="session-sidebar__header">
        <span class="eyebrow">Sesi (${sessions.length})</span>
        <button type="button" class="btn btn-primary" data-action="new-session">+ Baru</button>
      </div>
      <ul class="session-list">
        ${
          sessions.length
            ? sessions.map((s) => renderItem(s, activeId)).join("")
            : `<li class="empty-state"><span class="glyph">∅</span><span>Belum ada sesi.<br/>Mulai obrolan baru.</span></li>`
        }
      </ul>`;

    const renameInput = container.querySelector("[data-rename-input]");
    if (renameInput) {
      renameInput.focus();
      renameInput.select();
    }
  }

  container.addEventListener("click", (e) => {
    const newBtn = e.target.closest('[data-action="new-session"]');
    if (newBtn) {
      handlers.onCreate();
      return;
    }
    const renameBtn = e.target.closest('[data-action="rename"]');
    if (renameBtn) {
      editingId = renameBtn.dataset.id;
      handlers.requestRerender();
      return;
    }
    const deleteBtn = e.target.closest('[data-action="delete"]');
    if (deleteBtn) {
      handlers.onDelete(deleteBtn.dataset.id);
      return;
    }
    const selectBtn = e.target.closest('[data-action="select"]');
    if (selectBtn) {
      handlers.onSelect(selectBtn.dataset.id);
    }
  });

  container.addEventListener("submit", (e) => {
    const form = e.target.closest('[data-action="rename-form"]');
    if (!form) return;
    e.preventDefault();
    const input = form.querySelector("[data-rename-input]");
    const value = input.value.trim();
    const id = form.dataset.id;
    editingId = null;
    if (value) handlers.onRename(id, value);
    else handlers.requestRerender();
  });

  container.addEventListener(
    "focusout",
    (e) => {
      const form = e.target.closest('[data-action="rename-form"]');
      if (!form) return;
      // blur tanpa submit (mis. klik di luar) -> batalkan edit
      setTimeout(() => {
        if (editingId === form.dataset.id) {
          editingId = null;
          handlers.requestRerender();
        }
      }, 120);
    },
    true
  );

  container.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && e.target.matches("[data-rename-input]")) {
      editingId = null;
      handlers.requestRerender();
    }
  });

  return { render };
}
