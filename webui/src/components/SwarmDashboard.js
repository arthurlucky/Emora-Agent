// webui/src/components/SwarmDashboard.js
// Swarm / Container Agents Dashboard

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
    <article class="card swarm-card" aria-label="Container ${escapeHtml(c.id)}">
      <div class="swarm-card__head">
        <div class="swarm-card__info">
          <h3 class="swarm-card__title">${escapeHtml(c.id)}</h3>
          <div class="swarm-card__meta">
            ${statusBadge(c.status)}
            ${c.pid ? `<span class="swarm-card__pid">PID ${c.pid}</span>` : ''}
          </div>
        </div>
        <div class="swarm-card__actions">${actionBtn}</div>
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
  `

  const listEl = el.querySelector('#swarm-list')
  const form = el.querySelector('#swarm-create-form')
  const input = el.querySelector('#new-container-id')

  let refreshInterval = null
  let lastData = null

  async function load() {
    try {
      const list = await swarmApi.list()
      lastData = list
      render(list)
    } catch (err) {
      // Only show error state if we have no cached data
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
  }

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
  refreshInterval = setInterval(load, 5000)

  el._cleanup = () => {
    if (refreshInterval) clearInterval(refreshInterval)
  }

  return el
}
