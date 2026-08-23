import { icons } from '../utils/icons.js'
import { gatewayApi } from '../api.js'
import { showToast } from '../utils/helpers.js'
import { escapeHtml } from '../dom.js'

function runningBadge(gw) {
  if (gw.running) {
    return `<span class="badge is-on"><span class="status-dot is-on"></span>Running</span>`
  }
  return `<span class="badge is-off"><span class="status-dot is-off"></span>${escapeHtml(gw.info || 'Stopped')}</span>`
}

export function GatewayManager() {
  const el = document.createElement('div')
  el.className = 'fade-in'
  el.style.cssText = 'padding:24px;max-width:1100px;margin:0 auto;width:100%;'

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px;">
      <div>
        <h2 style="font-size:24px;font-weight:700;color:var(--text-primary);">Gateway Manager</h2>
        <p style="color:var(--text-muted);font-size:13px;margin-top:2px;">Kelola koneksi gateway komunikasi (Telegram, WhatsApp, dll).</p>
      </div>
      <button class="btn btn-secondary" id="refresh-gateways-btn">${icons.refresh} Refresh</button>
    </div>
    <div id="gateway-list" style="display:flex;flex-direction:column;gap:16px;">
      <div style="text-align:center;padding:40px;color:var(--text-muted);">
        <div class="loading-dots" style="justify-content:center;margin-bottom:12px;"><span></span><span></span><span></span></div>
        Memuat gateway...
      </div>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:20px;flex-wrap:wrap;">
      <span style="font-size:11.5px;color:var(--text-muted);" id="gateway-save-hint">Perubahan enable & konfigurasi butuh restart EMORA agar aktif.</span>
      <button class="btn btn-primary" id="save-gateways" style="min-width:180px;">${icons.save} Simpan Konfigurasi</button>
    </div>
  `

  const listEl = el.querySelector('#gateway-list')
  let gatewayData = []

  async function loadGateways() {
    try {
      const response = await gatewayApi.list()
      if (response.success) { gatewayData = response.gateways || []; renderGateways() }
      else throw new Error(response.error || 'Gagal memuat')
    } catch (error) {
      showToast('Gagal memuat gateway: ' + error.message, 'error')
      listEl.innerHTML = `<div style="text-align:center;padding:40px;color:var(--accent-red);">Gagal memuat data gateway.</div>`
    }
  }

  function renderGateways() {
    if (gatewayData.length === 0) {
      listEl.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);">Belum ada platform gateway terkonfigurasi.</div>`
      return
    }

    listEl.innerHTML = gatewayData.map((gw, index) => `
      <div class="card gateway-card" style="padding:18px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
          <div style="display:flex;align-items:center;gap:14px;min-width:0;">
            <div style="width:44px;height:44px;background:var(--bg-tertiary);border-radius:12px;display:flex;align-items:center;justify-content:center;color:var(--accent-cyan);flex-shrink:0;">
              ${gw.id === 'telegram' || gw.id === 'whatsapp' ? icons.chat : icons.gateway}
            </div>
            <div style="min-width:0;">
              <h3 style="font-weight:600;font-size:15px;color:var(--text-primary);">${escapeHtml(gw.name || gw.id)}</h3>
              <div style="display:flex;align-items:center;gap:10px;margin-top:4px;flex-wrap:wrap;">
                <span style="font-size:11px;color:var(--text-muted);text-transform:uppercase;font-family:var(--font-mono);">${escapeHtml(gw.id)}</span>
                ${runningBadge(gw)}
              </div>
            </div>
          </div>
          <label class="toggle" title="${gw.enabled ? 'Nonaktifkan' : 'Aktifkan'} ${escapeHtml(gw.name || gw.id)}">
            <input type="checkbox" ${gw.enabled ? 'checked' : ''} data-index="${index}">
            <span class="toggle-slider"></span>
          </label>
        </div>
        ${gw.enabled ? `<div style="border-top:1px solid var(--border);padding-top:16px;margin-top:16px;">
          ${Object.keys(gw.config || {}).length === 0
            ? `<div style="font-size:12px;color:var(--text-muted);padding:6px 0;">Tidak ada konfigurasi tambahan.</div>`
            : Object.entries(gw.config).map(([key, value]) => `
              <div style="display:grid;grid-template-columns:140px 1fr;gap:12px;align-items:center;margin-bottom:12px;">
                <label style="font-size:13px;color:var(--text-secondary);text-transform:capitalize;">${escapeHtml(key.replace(/([A-Z])/g, ' $1').trim())}</label>
                <input type="text" class="input" value="${escapeHtml(value)}" data-gw="${index}" data-key="${escapeHtml(key)}" placeholder="Enter ${escapeHtml(key)}...">
              </div>
            `).join('')}
        </div>` : ''}
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;border-top:1px solid var(--border);margin-top:14px;padding-top:14px;flex-wrap:wrap;">
          <span style="font-size:11px;color:var(--text-dim);">${gw.running ? 'Sedang berjalan' : 'Berhenti'} · konfigurasi baru butuh restart</span>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-sm ${gw.running ? 'btn-secondary' : 'btn-primary'} gateway-action-btn" data-action="start" data-platform="${escapeHtml(gw.id)}" ${gw.running ? 'disabled' : ''}>${icons.play || ''} Start</button>
            <button class="btn btn-sm btn-secondary gateway-action-btn" data-action="stop" data-platform="${escapeHtml(gw.id)}" ${!gw.running ? 'disabled' : ''}>${icons.stop || ''} Stop</button>
          </div>
        </div>
      </div>
    `).join('')

    listEl.querySelectorAll('.toggle input').forEach(toggle => {
      toggle.addEventListener('change', (e) => {
        gatewayData[parseInt(e.target.dataset.index)].enabled = e.target.checked
        renderGateways()
      })
    })

    listEl.querySelectorAll('input[data-gw]').forEach(input => {
      input.addEventListener('input', (e) => {
        gatewayData[parseInt(e.target.dataset.gw)].config[e.target.dataset.key] = e.target.value
      })
    })

    listEl.querySelectorAll('.gateway-action-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const platform = btn.dataset.platform
        const action = btn.dataset.action
        btn.disabled = true
        btn.textContent = '…'
        try {
          const res = await gatewayApi[action](platform)
          showToast(res.message || `Gateway ${platform} ${action === 'start' ? 'dijalankan' : 'dihentikan'}`)
          await loadGateways()
        } catch (err) {
          showToast('Gagal ' + (action === 'start' ? 'menjalankan' : 'menghentikan') + ' gateway: ' + err.message, 'error')
          btn.disabled = false
          btn.textContent = action === 'start' ? 'Start' : 'Stop'
        }
      })
    })
  }

  el.querySelector('#save-gateways').addEventListener('click', async () => {
    const btn = el.querySelector('#save-gateways')
    btn.disabled = true
    btn.textContent = 'Menyimpan...'
    try {
      const res = await gatewayApi.update(gatewayData)
      showToast(res.message || 'Konfigurasi gateway disimpan')
    } catch (error) {
      showToast('Gagal menyimpan: ' + error.message, 'error')
    } finally {
      btn.disabled = false
      btn.textContent = `${icons.save} Simpan Konfigurasi`
    }
  })

  el.querySelector('#refresh-gateways-btn').addEventListener('click', loadGateways)

  loadGateways()
  return el
}
