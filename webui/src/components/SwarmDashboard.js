import { swarmApi } from '../api.js'
import { escapeHtml } from '../dom.js'

function statusBadge(status) {
  if (status === "running") return `<span class="badge is-on" style="background:var(--success);color:#fff;padding:2px 8px;border-radius:12px;font-size:0.8rem">RUNNING</span>`
  return `<span class="badge is-off" style="background:var(--surface-3);padding:2px 8px;border-radius:12px;font-size:0.8rem">STOPPED</span>`
}

export function SwarmDashboard() {
  const el = document.createElement('div')
  el.className = 'page-content'
  
  el.innerHTML = `
    <div class="page-header">
      <div>
        <h2 class="page-title">Swarm / Container Agents</h2>
        <p class="page-desc">Manage isolated agent sandboxes running in the background.</p>
      </div>
    </div>
    
    <div class="panel" style="margin-bottom:1rem;background:var(--surface-2);padding:1rem;border-radius:8px">
      <form id="create-container-form" style="display:flex;gap:0.5rem">
        <input type="text" id="new-container-id" class="input" placeholder="Container Name (e.g., sales-bot)" required style="flex:1" />
        <button type="submit" class="btn btn-primary">Create Sandbox</button>
      </form>
    </div>
    
    <div id="swarm-list" style="display:flex;flex-direction:column;gap:1rem">
      <div class="empty-state">Loading containers...</div>
    </div>
  `

  const listEl = el.querySelector('#swarm-list')
  const form = el.querySelector('#create-container-form')
  const input = el.querySelector('#new-container-id')
  
  let refreshInterval = null

  async function load() {
    try {
      const list = await swarmApi.list()
      render(list)
    } catch (err) {
      console.error(err)
    }
  }

  function render(list) {
    if (!list.length) {
      listEl.innerHTML = `<div class="empty-state">No containers available. Create one above.</div>`
      return
    }

    listEl.innerHTML = list.map(c => `
      <div class="card" style="display:flex;justify-content:space-between;align-items:flex-start;background:var(--surface-2);padding:1rem;border-radius:8px">
        <div style="flex:1;min-width:0;margin-right:1rem">
          <div style="display:flex;align-items:center;gap:1rem;margin-bottom:0.5rem">
            <h3 style="margin:0;font-size:1.1rem;color:var(--text-1)">${escapeHtml(c.id)}</h3>
            ${statusBadge(c.status)}
            ${c.pid ? `<span style="font-size:0.8rem;color:var(--text-3)">PID: ${c.pid}</span>` : ''}
          </div>
          <div style="background:var(--surface-1);padding:0.75rem;border-radius:4px;font-family:monospace;font-size:0.8rem;color:var(--text-2);max-height:150px;overflow-y:auto;white-space:pre-wrap">
${c.logs && c.logs.length ? escapeHtml(c.logs.join('\\n')) : 'No logs yet.'}
          </div>
        </div>
        <div style="display:flex;gap:0.5rem;flex-shrink:0">
          ${c.status === 'running'
            ? `<button class="btn btn-secondary action-stop" data-id="${escapeHtml(c.id)}">Stop</button>`
            : `<button class="btn btn-primary action-start" data-id="${escapeHtml(c.id)}">Start</button>`}
        </div>
      </div>
    `).join('')

    listEl.querySelectorAll('.action-start').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.target.dataset.id
        btn.disabled = true
        btn.textContent = '...'
        try {
          await swarmApi.start(id)
          load()
        } catch(err) {
          alert('Error: ' + (err.message || 'Failed to start'))
          btn.disabled = false
          btn.textContent = 'Start'
        }
      })
    })

    listEl.querySelectorAll('.action-stop').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.target.dataset.id
        btn.disabled = true
        btn.textContent = '...'
        try {
          await swarmApi.stop(id)
          load()
        } catch(err) {
          alert('Error: ' + (err.message || 'Failed to stop'))
          btn.disabled = false
          btn.textContent = 'Stop'
        }
      })
    })
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const id = input.value.trim()
    if (!id) return
    const btn = form.querySelector('button')
    btn.disabled = true
    try {
      await swarmApi.create(id)
      input.value = ''
      load()
    } catch(err) {
      alert('Error: ' + (err.message || 'Failed to create'))
    } finally {
      btn.disabled = false
    }
  })

  // Poll for logs and status
  load()
  refreshInterval = setInterval(load, 5000)

  // Cleanup on unmount (assuming the framework provides a way to unmount)
  // For this vanilla JS structure, we rely on the user navigating away. 
  // Ideally, app.js should call a destroy() method if it existed, but we'll 
  // attach it to the element so a clever router could find it.
  el._cleanup = () => clearInterval(refreshInterval)

  return el
}
