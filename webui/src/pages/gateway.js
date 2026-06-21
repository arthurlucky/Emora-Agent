// webui/src/pages/gateway.js

import * as api from "../api.js";
import * as toast from "../toast.js";
import { escapeHtml } from "../dom.js";

function statusBadge(running, enabled) {
  if (running) return `<span class="badge is-on"><span class="status-dot is-on"></span>Aktif</span>`;
  if (enabled) return `<span class="badge is-warn"><span class="status-dot is-pending"></span>Menunggu restart</span>`;
  return `<span class="badge is-off"><span class="status-dot is-off"></span>Nonaktif</span>`;
}

function cardTemplate({ key, title, desc, enabled, running, fields }) {
  return `
    <form class="card gateway-card" data-gateway-form="${key}">
      <div class="gateway-card__head">
        <div>
          <h3 class="gateway-card__title">${title}</h3>
          <p class="gateway-card__desc">${desc}</p>
        </div>
        ${statusBadge(running, enabled)}
      </div>

      <label class="gateway-card__toggle">
        <span class="switch">
          <input type="checkbox" data-field="enabled" ${enabled ? "checked" : ""} />
          <span class="track"></span>
        </span>
        <span>Aktifkan gateway ${title}</span>
      </label>

      ${fields}

      <div class="gateway-card__footer">
        <span class="gateway-card__hint">Perubahan baru aktif setelah EMORA di-restart.</span>
        <button type="submit" class="btn btn-primary">Simpan</button>
      </div>
    </form>`;
}

export async function mount(root) {
  root.innerHTML = `
    <div class="page page--gateway">
      <div class="page__header">
        <span class="eyebrow">Gateway</span>
        <h2>Koneksi Pesan</h2>
        <p class="page__lede">Atur gateway Telegram &amp; WhatsApp yang dipakai EMORA buat nerima pesan dari luar.</p>
      </div>
      <div class="gateway-grid" data-grid>
        <div class="empty-state"><span class="glyph">⋯</span><span>Memuat status gateway…</span></div>
      </div>
    </div>`;

  const grid = root.querySelector("[data-grid]");

  async function load() {
    try {
      const { gateways } = await api.getGateway();
      render(gateways);
    } catch (err) {
      grid.innerHTML = `<div class="empty-state"><span class="glyph">!</span><span>Gagal memuat status gateway: ${escapeHtml(err.message)}</span></div>`;
    }
  }

  function render(gateways) {
    const tg = gateways.telegram;
    const wa = gateways.whatsapp;

    grid.innerHTML =
      cardTemplate({
        key: "telegram",
        title: "Telegram",
        desc: "Bot Telegram via Telegraf. Token diambil dari BotFather.",
        enabled: tg.enabled,
        running: tg.running,
        fields: `
          <div class="gateway-card__field">
            <label class="field-label">Bot Token</label>
            <input
              type="text"
              class="input"
              data-field="token"
              placeholder="${tg.hasToken ? escapeHtml(tg.token) : "Belum diisi — tempel token dari @BotFather"}"
              autocomplete="off"
            />
            <p class="field-hint">Kosongkan kalau gak mau ganti token yang sudah tersimpan.</p>
          </div>
          <div class="gateway-card__field">
            <label class="field-label">Allowed User ID (pisah koma)</label>
            <input
              type="text"
              class="input"
              data-field="allowedIds"
              value="${escapeHtml(tg.allowedIds)}"
              placeholder="123456789, 987654321"
              autocomplete="off"
            />
          </div>`,
      }) +
      cardTemplate({
        key: "whatsapp",
        title: "WhatsApp",
        desc: "Koneksi WhatsApp via Baileys, pakai pairing/QR dari nomor terdaftar.",
        enabled: wa.enabled,
        running: wa.running,
        fields: `
          <div class="gateway-card__field">
            <label class="field-label">Nomor WhatsApp</label>
            <input
              type="text"
              class="input"
              data-field="phoneNumber"
              value="${escapeHtml(wa.phoneNumber)}"
              placeholder="62812xxxxxxx"
              autocomplete="off"
            />
          </div>
          <div class="gateway-card__field">
            <label class="field-label">Allowed Numbers (pisah koma)</label>
            <input
              type="text"
              class="input"
              data-field="allowedNumbers"
              value="${escapeHtml(wa.allowedNumbers)}"
              placeholder="62812xxxxxxx, 62813xxxxxxx"
              autocomplete="off"
            />
          </div>`,
      });
  }

  grid.addEventListener("submit", async (e) => {
    const form = e.target.closest("[data-gateway-form]");
    if (!form) return;
    e.preventDefault();

    const key = form.dataset.gatewayForm;
    const enabled = form.querySelector('[data-field="enabled"]').checked;
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = "Menyimpan…";

    try {
      let result;
      if (key === "telegram") {
        const token = form.querySelector('[data-field="token"]').value;
        const allowedIds = form.querySelector('[data-field="allowedIds"]').value;
        result = await api.saveTelegramGateway({ enabled, token, allowedIds });
      } else {
        const phoneNumber = form.querySelector('[data-field="phoneNumber"]').value;
        const allowedNumbers = form.querySelector('[data-field="allowedNumbers"]').value;
        result = await api.saveWhatsappGateway({ enabled, phoneNumber, allowedNumbers });
      }
      toast.success(result.message || "Konfigurasi disimpan.");
      await load();
    } catch (err) {
      toast.error(`Gagal menyimpan: ${err.message}`);
      submitBtn.disabled = false;
      submitBtn.textContent = "Simpan";
    }
  });

  await load();
}
