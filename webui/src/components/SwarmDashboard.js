// webui/src/components/SwarmDashboard.js
// Swarm / Container Agents Dashboard with inline chat, config editing, and delete actions

import { icons } from '../utils/icons.js'
import { swarmApi } from '../api.js'
import { showToast } from '../utils/helpers.js'
import { escapeHtml } from '../dom.js'

function statusBadge(status) {
  if (status === 'running') {
    return `<span class="badge is-on"><span class="status-dot is-on"></span>Running</span>`
  }
  return `<span class="badge is-off"><span class="status-dot is-off"></span>Stopped</span>`
}

function containerCard(c) {
  const logText = c.logs && c.logs.filter(Boolean).length
    ? escapeHtml(c.logs.filter(Boolean).join('\n'))
    : 'No output yet.'

  const actionBtn = c.status === 'running'
    ? `<button class="btn btn-danger swarm-action" data-action="stop" data-id="${escapeHtml(c.id)}" aria-label="Stop container ${escapeHtml(c.id)}">Stop</button>`
    : `<button class="btn btn-primary swarm-action" data-action="start" data-id="${escapeHtml(c.id)}" aria-label="Start container ${escapeHtml(c.id)}">Start</button>`

  return `
    <article class="card swarm-card" aria-label="Container ${escapeHtml(c.id)}" style="margin-bottom:1rem;">
      <div class="swarm-card__head">
        <div class="swarm-card__info">
          <h3 class="swarm-card__title" style="display:flex;align-items:center;gap:8px;">
            ${escapeHtml(c.id)}
            ${statusBadge(c.status)}
            ${c.pid ? `<span class="swarm-card__pid">PID ${c.pid}</span>` : ''}
          </h3>
        </div>
        <div class="swarm-card__actions" style="display:flex;gap:6px;">
          ${actionBtn}
          <button class="btn btn-ghost swarm-edit" data-id="${escapeHtml(c.id)}" title="Edit Config">${icons.edit || 'Edit'}</button>
          <button class="btn btn-ghost swarm-delete" style="color:var(--accent-red);" data-id="${escapeHtml(c.id)}" title="Delete Container">${icons.trash || 'Delete'}</button>
        </div>
      </div>
      
      <!-- Interactive Subagent Command Box -->
      <div class="swarm-card__chat-container" style="border:1px solid var(--border);border-radius:var(--radius-md);padding:10px;margin-bottom:10px;background:var(--bg-surface-raised);">
        <div class="swarm-card__chat-header" style="font-size:12px;font-weight:600;margin-bottom:6px;color:var(--text-secondary);display:flex;justify-content:space-between;align-items:center;">
          <span>Direct Agent Command Input</span>
          <button class="btn btn-ghost btn-toggle-history" style="padding:2px 6px;font-size:10.5px;">Show History</button>
        </div>
        <div class="swarm-card__chat-history" style="display:none;max-height:180px;overflow-y:auto;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px;font-size:12.5px;margin-bottom:8px;flex-direction:column;gap:8px;">
          <div style="color:var(--text-dim);font-style:italic;font-size:11.5px;text-align:center;">No recent commands.</div>
        </div>
        <form class="swarm-card__chat-form" data-id="${escapeHtml(c.id)}" style="display:flex;gap:8px;">
          <input type="text" class="input swarm-chat-input" placeholder="Type a task/command for ${escapeHtml(c.id)} (e.g. riset teknologi AI terbaru)..." required style="flex:1;font-size:12.5px;" />
          <button type="submit" class="btn btn-primary" style="padding:6px 12px;">Send</button>
        </form>
      </div>

      <div class="swarm-card__logs" role="log" aria-label="Container logs for ${escapeHtml(c.id)}">${logText}</div>
    </article>`
}

function skeleton() {
  return `
    <div class="swarm-skeleton" aria-busy="true" aria-label="Loading containers">
      <div class="swarm-skeleton__row"></div>
      <div class="swarm-skeleton__row"></div>
      <div class="swarm-skeleton__row"></div>
    </div>`
}

function errorState(message) {
  return `
    <div class="empty-state" role="alert">
      <span class="glyph">⚠</span>
      <span>Gagal memuat container</span>
      <span class="swarm-error-detail">${escapeHtml(message)}</span>
      <button class="btn" id="swarm-retry">Coba Lagi</button>
    </div>`
}

function emptyState() {
  return `
    <div class="empty-state" role="status">
      <span class="glyph">⬡</span>
      <span>Belum ada container</span>
      <span class="swarm-empty-hint">Buat container baru di form di atas untuk menjalankan agen terisolasi.</span>
    </div>`
}

export function SwarmDashboard() {
  const el = document.createElement('div')
  el.className = 'page page--swarm fade-in'

  el.innerHTML = `
    <div class="page__header">
      <span class="eyebrow">Swarm</span>
      <h2>Container Agents</h2>
      <p class="page__lede">Kelola agen-agen mandiri yang berjalan terisolasi di background. Setiap container punya memory, config, dan gateway sendiri.</p>
    </div>

    <form class="swarm-create-form" id="swarm-create-form" aria-label="Create new container">
      <label for="new-container-id" class="field-label">Nama Container</label>
      <div class="swarm-create-form__row">
        <input
          type="text"
          id="new-container-id"
          class="input"
          placeholder="mis. sales-bot"
          required
          pattern="[a-zA-Z0-9_-]+"
          title="Gunakan huruf, angka, dash, atau underscore"
          autocomplete="off"
        />
        <button type="submit" class="btn btn-primary">${icons.plus} Create</button>
      </div>
    </form>

    <div id="swarm-list" role="region" aria-label="Container list" aria-live="polite">
      ${skeleton()}
    </div>

    <!-- Modal Edit Configuration -->
    <div id="swarm-edit-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);z-index:1000;align-items:center;justify-content:center;padding:20px;overflow-y:auto;">
      <div class="card" style="width:100%;max-width:550px;background:var(--bg-base);border:1px solid var(--border-strong);padding:20px;">
        <h3 id="edit-modal-title" style="margin-bottom:16px;font-size:18px;font-weight:700;">Edit Subagent Configuration</h3>
        
        <form id="edit-config-form">
          <input type="hidden" id="edit-container-id" />
          
          <div style="margin-bottom:12px;">
            <label style="display:block;margin-bottom:6px;font-size:12px;color:var(--text-secondary);">Model Provider</label>
            <select id="edit-provider" class="input" style="background:var(--bg-input);color:var(--text-primary);border:1px solid var(--border);">
              <option value="gemini">Gemini (Google)</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="groq">Groq</option>
              <option value="openrouter">OpenRouter</option>
              <option value="ollama">Ollama (Lokal)</option>
              <option value="custom">Custom (OpenAI Compatible)</option>
            </select>
          </div>
          
          <div style="margin-bottom:12px;">
            <label style="display:block;margin-bottom:6px;font-size:12px;color:var(--text-secondary);">Model Name</label>
            <input type="text" id="edit-model-name" class="input" placeholder="e.g. gemini-1.5-flash, gpt-4o" required />
          </div>
          
          <div style="margin-bottom:12px;">
            <label style="display:block;margin-bottom:6px;font-size:12px;color:var(--text-secondary);">Model URL / Custom Base URL (Optional)</label>
            <input type="text" id="edit-model-url" class="input" placeholder="e.g. http://localhost:11434" />
          </div>
          
          <div style="margin-bottom:12px;">
            <label style="display:block;margin-bottom:6px;font-size:12px;color:var(--text-secondary);">API Key</label>
            <input type="password" id="edit-api-key" class="input" placeholder="Enter API Key / Token" />
          </div>

          <div style="margin-bottom:12px;border-top:1px dashed var(--border);padding-top:12px;">
            <label style="display:block;margin-bottom:6px;font-size:12px;color:var(--text-secondary);">Telegram Bot Token (Untuk bot gateway)</label>
            <input type="text" id="edit-telegram-token" class="input" placeholder="e.g. 123456:ABC-DEF..." />
          </div>

          <div style="margin-bottom:16px;display:flex;align-items:center;gap:10px;">
            <label class="switch" style="width:34px;height:19px;position:relative;display:inline-block;">
              <input type="checkbox" id="edit-gateway-enabled" />
              <span class="track" style="position:absolute;inset:0;background:var(--bg-input);border:1px solid var(--border-strong);border-radius:100px;cursor:pointer;"></span>
            </label>
            <label for="edit-gateway-enabled" style="font-size:13px;color:var(--text-primary);cursor:pointer;">Enable Gateway (Jalankan bot telegram)</label>
          </div>

          <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:20px;">
            <button type="button" class="btn btn-secondary" id="edit-cancel-btn">Batal</button>
            <button type="submit" class="btn btn-primary">Simpan Perubahan</button>
          </div>
        </form>
      </div>
    </div>
  `

  const listEl = el.querySelector('#swarm-list')
  const form = el.querySelector('#swarm-create-form')
  const input = el.querySelector('#new-container-id')

  // Edit Modal Elements
  const editModal = el.querySelector('#swarm-edit-modal')
  const editForm = el.querySelector('#edit-config-form')
  const editId = el.querySelector('#edit-container-id')
  const editProvider = el.querySelector('#edit-provider')
  const editModelName = el.querySelector('#edit-model-name')
  const editModelUrl = el.querySelector('#edit-model-url')
  const editApiKey = el.querySelector('#edit-api-key')
  const editTelegramToken = el.querySelector('#edit-telegram-token')
  const editGatewayEnabled = el.querySelector('#edit-gateway-enabled')
  const editCancelBtn = el.querySelector('#edit-cancel-btn')

  let refreshInterval = null
  let lastData = null

  async function load() {
    try {
      const list = await swarmApi.list()
      lastData = list
      render(list)
    } catch (err) {
      if (!lastData) {
        listEl.innerHTML = errorState(err.message || 'Connection error')
        const retryBtn = listEl.querySelector('#swarm-retry')
        if (retryBtn) retryBtn.addEventListener('click', load)
      }
    }
  }

  function render(list) {
    if (!list.length) {
      listEl.innerHTML = emptyState()
      return
    }

    listEl.innerHTML = `<div class="swarm-grid">${list.map(containerCard).join('')}</div>`
    bindActions()
  }

  function bindActions() {
    // Start / Stop
    listEl.querySelectorAll('.swarm-action').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id
        const action = btn.dataset.action
        const label = action === 'start' ? 'Start' : 'Stop'

        btn.disabled = true
        btn.textContent = '…'

        try {
          if (action === 'start') {
            await swarmApi.start(id)
            showToast(`Container ${id} berhasil dijalankan`)
          } else {
            await swarmApi.stop(id)
            showToast(`Container ${id} dihentikan`)
          }
          await load()
        } catch (err) {
          showToast(err.message || `Gagal ${label.toLowerCase()} container`, 'error')
          btn.disabled = false
          btn.textContent = label
        }
      })
    })

    // Edit configuration trigger
    listEl.querySelectorAll('.swarm-edit').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id
        try {
          const config = await swarmApi.getConfig(id)
          editId.value = id
          el.querySelector('#edit-modal-title').textContent = `Configuration: ${id}`
          editProvider.value = config.model_provider || 'gemini'
          editModelName.value = config.model_name || ''
          editModelUrl.value = config.model_url || ''
          editApiKey.value = config.model_api || ''
          editTelegramToken.value = config.telegram_token || ''
          editGatewayEnabled.checked = !!config.gateway_enabled

          editModal.style.display = 'flex'
        } catch (err) {
          showToast('Failed to load container config: ' + err.message, 'error')
        }
      })
    })

    // Delete container
    listEl.querySelectorAll('.swarm-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id
        if (confirm(`Apakah Anda yakin ingin menghapus container "${id}" beserta seluruh memori dan konfigurasinya? Tindakan ini tidak bisa dibatalkan.`)) {
          try {
            await swarmApi.delete(id)
            showToast(`Container ${id} berhasil dihapus`)
            load()
          } catch (err) {
            showToast('Gagal menghapus container: ' + err.message, 'error')
          }
        }
      })
    })

    // Toggle Command History
    listEl.querySelectorAll('.btn-toggle-history').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const card = e.target.closest('.card')
        const historyEl = card.querySelector('.swarm-card__chat-history')
        if (historyEl.style.display === 'none') {
          historyEl.style.display = 'flex'
          btn.textContent = 'Hide History'
        } else {
          historyEl.style.display = 'none'
          btn.textContent = 'Show History'
        }
      })
    })

    // Send Command/Chat
    listEl.querySelectorAll('.swarm-card__chat-form').forEach(chatForm => {
      chatForm.addEventListener('submit', async (e) => {
        e.preventDefault()
        const id = chatForm.dataset.id
        const inputEl = chatForm.querySelector('.swarm-chat-input')
        const historyEl = chatForm.closest('.card').querySelector('.swarm-card__chat-history')
        const message = inputEl.value.trim()
        if (!message) return

        const submitBtn = chatForm.querySelector('button[type="submit"]')
        submitBtn.disabled = true
        submitBtn.textContent = '…'

        // Show/Append to history
        if (historyEl.querySelector('div') && historyEl.querySelector('div').style.fontStyle === 'italic') {
          historyEl.innerHTML = '' // Clear empty hint
        }
        historyEl.style.display = 'flex'
        
        const userMsgEl = document.createElement('div')
        userMsgEl.style.cssText = 'align-self:flex-end;background:linear-gradient(135deg,#2b3a4a,#1d2733);color:var(--text-primary);padding:6px 10px;border-radius:8px;max-width:85%;border:1px solid var(--border-strong);'
        userMsgEl.textContent = message
        historyEl.appendChild(userMsgEl)
        historyEl.scrollTop = historyEl.scrollHeight

        inputEl.value = ''

        try {
          const res = await swarmApi.chat(id, message)
          
          const botMsgEl = document.createElement('div')
          botMsgEl.style.cssText = 'align-self:flex-start;background:var(--bg-surface);color:var(--text-primary);padding:6px 10px;border-radius:8px;max-width:85%;border:1px solid var(--border);'
          botMsgEl.innerHTML = escapeHtml(res.content).replace(/\n/g, '<br/>')
          
          historyEl.appendChild(botMsgEl)
          historyEl.scrollTop = historyEl.scrollHeight
        } catch (err) {
          const errMsgEl = document.createElement('div')
          errMsgEl.style.cssText = 'align-self:flex-start;color:var(--accent-red);padding:6px 10px;font-style:italic;'
          errMsgEl.textContent = `Error: ${err.message}`
          historyEl.appendChild(errMsgEl)
          historyEl.scrollTop = historyEl.scrollHeight
        } finally {
          submitBtn.disabled = false
          submitBtn.textContent = 'Send'
        }
      })
    })
  }

  // Save Config Form Submission
  editForm.addEventListener('submit', async (e) => {
    e.preventDefault()
    const id = editId.value
    const config = {
      model_provider: editProvider.value,
      model_name: editModelName.value.trim(),
      model_url: editModelUrl.value.trim(),
      model_api: editApiKey.value.trim(),
      telegram_token: editTelegramToken.value.trim(),
      gateway_enabled: editGatewayEnabled.checked
    }

    const submitBtn = editForm.querySelector('button[type="submit"]')
    submitBtn.disabled = true

    try {
      await swarmApi.saveConfig(id, config)
      showToast(`Konfigurasi container ${id} disimpan.`)
      editModal.style.display = 'none'
      load()
    } catch (err) {
      showToast('Gagal menyimpan konfigurasi: ' + err.message, 'error')
    } finally {
      submitBtn.disabled = false
    }
  })

  // Cancel edit modal
  editCancelBtn.addEventListener('click', () => {
    editModal.style.display = 'none'
  })

  // Close modal when clicking outside form card
  editModal.addEventListener('click', (e) => {
    if (e.target === editModal) {
      editModal.style.display = 'none'
    }
  })

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const id = input.value.trim()
    if (!id) return

    const btn = form.querySelector('button[type="submit"]')
    btn.disabled = true

    try {
      await swarmApi.create(id)
      showToast(`Container ${id} berhasil dibuat`)
      input.value = ''
      await load()
    } catch (err) {
      showToast(err.message || 'Gagal membuat container', 'error')
    } finally {
      btn.disabled = false
    }
  })

  // Initial load + auto-refresh
  load()
  refreshInterval = setInterval(() => {
    // Jangan render ulang (yang menghapus DOM list) saat user sedang
    // mengetik di form chat container / form create / modal edit terbuka.
    const ae = document.activeElement
    const busy = ae && (
      ae.matches('.swarm-chat-input') ||
      ae.matches('#new-container-id') ||
      ae.matches('#swarm-edit-modal input') ||
      ae.matches('#swarm-edit-modal select') ||
      ae.matches('#swarm-edit-modal textarea')
    )
    if (!busy && editModal.style.display !== 'flex') load()
  }, 5000)

  el._cleanup = () => {
    if (refreshInterval) clearInterval(refreshInterval)
  }

  return el
}
