// webui/src/pages/chat.js

import * as api from "../api.js";
import * as toast from "../toast.js";
import { createSessionList } from "../components/sessionList.js";
import { createChatPanel } from "../components/chatPanel.js";

export async function mount(root) {
  root.innerHTML = `
    <div class="chat-layout">
      <aside class="session-sidebar" data-sidebar></aside>
      <section class="chat-panel" data-panel></section>
    </div>`;

  const sidebarEl = root.querySelector("[data-sidebar]");
  const panelEl = root.querySelector("[data-panel]");

  const state = {
    sessions: [],
    activeSessionId: null,
    messages: [],
    loadingSessions: true,
    loadingMessages: false,
    sending: false,
  };

  const sessionList = createSessionList(sidebarEl, {
    onCreate: createNewSession,
    onSelect: selectSession,
    onRename: doRenameSession,
    onDelete: doDeleteSession,
    requestRerender: renderSidebar,
  });

  const chatPanel = createChatPanel(panelEl, {
    onSend: sendMessage,
  });

  function renderSidebar() {
    sessionList.render({
      sessions: state.sessions,
      activeId: state.activeSessionId,
      loading: state.loadingSessions,
    });
  }

  function renderPanel() {
    chatPanel.render({
      sessionId: state.activeSessionId,
      messages: state.messages,
      sending: state.sending,
      loadingMessages: state.loadingMessages,
    });
  }

  async function fetchSessions({ keepActive = true } = {}) {
    state.loadingSessions = true;
    renderSidebar();
    try {
      const { sessions } = await api.getSessions();
      state.sessions = sessions;
      state.loadingSessions = false;

      const stillExists = state.sessions.some((s) => s.id === state.activeSessionId);
      if (!keepActive || !stillExists) {
        if (state.sessions.length) {
          await selectSession(state.sessions[0].id);
          return;
        }
        state.activeSessionId = null;
        state.messages = [];
      }
      renderSidebar();
      renderPanel();
    } catch (err) {
      state.loadingSessions = false;
      renderSidebar();
      toast.error(`Gagal memuat sesi: ${err.message}`);
    }
  }

  async function selectSession(id) {
    if (state.activeSessionId === id) return;
    state.activeSessionId = id;
    state.loadingMessages = true;
    renderSidebar();
    renderPanel();
    try {
      const { messages } = await api.getMessages(id);
      if (state.activeSessionId !== id) return; // user udah pindah sesi sebelum respons datang
      state.messages = messages;
      state.loadingMessages = false;
      renderPanel();
    } catch (err) {
      state.loadingMessages = false;
      renderPanel();
      toast.error(`Gagal memuat riwayat: ${err.message}`);
    }
  }

  async function createNewSession() {
    try {
      const { session } = await api.createSession();
      state.sessions = [session, ...state.sessions];
      renderSidebar();
      await selectSession(session.id);
      toast.success("Sesi baru dibuat.");
    } catch (err) {
      toast.error(`Gagal membuat sesi: ${err.message}`);
    }
  }

  async function doRenameSession(id, name) {
    try {
      await api.renameSession(id, name);
      state.sessions = state.sessions.map((s) => (s.id === id ? { ...s, name } : s));
      renderSidebar();
      toast.success("Nama sesi diperbarui.");
    } catch (err) {
      renderSidebar();
      toast.error(`Gagal mengganti nama: ${err.message}`);
    }
  }

  async function doDeleteSession(id) {
    const session = state.sessions.find((s) => s.id === id);
    const label = session ? session.name || `#${id.slice(0, 8)}` : "sesi ini";
    if (!window.confirm(`Hapus "${label}"? Riwayat chat-nya gak bisa dibalikin.`)) return;

    try {
      await api.deleteSession(id);
      state.sessions = state.sessions.filter((s) => s.id !== id);
      if (state.activeSessionId === id) {
        state.activeSessionId = null;
        state.messages = [];
        if (state.sessions.length) {
          await selectSession(state.sessions[0].id);
        }
      }
      renderSidebar();
      renderPanel();
      toast.success("Sesi dihapus.");
    } catch (err) {
      toast.error(`Gagal menghapus sesi: ${err.message}`);
    }
  }

  async function sendMessage(text) {
    if (!state.activeSessionId || state.sending) return;
    const sessionId = state.activeSessionId;

    state.messages = [...state.messages, { role: "user", content: text, timestamp: Date.now() }];
    state.sending = true;
    renderPanel();

    try {
      const { reply } = await api.sendChat(sessionId, text);
      if (state.activeSessionId === sessionId) {
        state.messages = [...state.messages, { role: "assistant", content: reply, timestamp: Date.now() }];
      }
      state.sending = false;
      renderPanel();
      // refresh urutan & messageCount di sidebar tanpa ganggu sesi aktif
      fetchSessions({ keepActive: true });
    } catch (err) {
      state.sending = false;
      renderPanel();
      toast.error(`Gagal mengirim pesan: ${err.message}`);
    }
  }

  renderSidebar();
  renderPanel();
  await fetchSessions();
}
