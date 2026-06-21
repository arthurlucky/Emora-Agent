// webui/src/components/chatPanel.js
// Panel chat utama: daftar pesan + input ala prompt CLI EMORA
// (`[xxxxxxxx] You >`). Auto-scroll ke bawah tiap ada pesan baru.

import { escapeHtml } from "../dom.js";
import { formatClock, shortId } from "../format.js";

export function createChatPanel(container, handlers) {
  container.innerHTML = `
    <div class="chat-panel__messages" data-messages></div>
    <form class="chat-panel__input-row" data-send-form>
      <span class="chat-prompt" data-prompt-label>[--------] You &gt;</span>
      <textarea
        class="chat-panel__input"
        data-input
        rows="1"
        placeholder="Ketik pesan… (Enter untuk kirim, Shift+Enter baris baru)"
        disabled
      ></textarea>
      <button type="submit" class="btn btn-primary chat-panel__send" data-send-btn disabled>Kirim</button>
    </form>`;

  const messagesEl = container.querySelector("[data-messages]");
  const formEl = container.querySelector("[data-send-form]");
  const inputEl = container.querySelector("[data-input]");
  const sendBtn = container.querySelector("[data-send-btn]");
  const promptLabel = container.querySelector("[data-prompt-label]");

  function autoGrow() {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + "px";
  }

  function submit() {
    const text = inputEl.value.trim();
    if (!text) return;
    handlers.onSend(text);
    inputEl.value = "";
    autoGrow();
  }

  formEl.addEventListener("submit", (e) => {
    e.preventDefault();
    submit();
  });

  inputEl.addEventListener("input", autoGrow);

  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });

  function bubble(msg) {
    const isUser = msg.role === "user";
    const isSystem = msg.role === "system";
    if (isSystem) return "";
    return `
      <div class="msg ${isUser ? "msg--user" : "msg--assistant"}">
        <div class="msg__meta">
          <span class="msg__role">${isUser ? "you" : "emora"}</span>
          ${msg.timestamp ? `<span class="msg__time">${formatClock(msg.timestamp)}</span>` : ""}
        </div>
        <div class="msg__bubble">${escapeHtml(msg.content)}</div>
      </div>`;
  }

  function render(state) {
    const { sessionId, messages = [], sending = false, loadingMessages = false } = state;

    promptLabel.textContent = sessionId ? `[${shortId(sessionId)}] You >` : "[--------] You >";
    inputEl.disabled = !sessionId || sending;
    sendBtn.disabled = !sessionId || sending;
    sendBtn.textContent = sending ? "Mengirim…" : "Kirim";

    if (!sessionId) {
      messagesEl.innerHTML = `
        <div class="empty-state">
          <span class="glyph">▌</span>
          <span>Pilih atau buat sesi buat mulai ngobrol.</span>
        </div>`;
      return;
    }

    if (loadingMessages) {
      messagesEl.innerHTML = `<div class="empty-state"><span class="glyph">⋯</span><span>Memuat riwayat…</span></div>`;
      return;
    }

    const wasNearBottom =
      messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 120;

    if (!messages.length) {
      messagesEl.innerHTML = `
        <div class="empty-state">
          <span class="glyph">○</span>
          <span>Sesi ini masih kosong. Sapa Emora dulu, bro.</span>
        </div>`;
      return;
    }

    messagesEl.innerHTML =
      messages.map(bubble).join("") +
      (sending
        ? `<div class="msg msg--assistant msg--pending">
             <div class="msg__meta"><span class="msg__role">emora</span></div>
             <div class="msg__bubble"><span class="cursor-blink"></span></div>
           </div>`
        : "");

    if (wasNearBottom || sending) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  return { render };
}
