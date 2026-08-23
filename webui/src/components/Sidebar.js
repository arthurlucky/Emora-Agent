import { icons } from '../utils/icons.js'
import { store } from '../state.js'

const menuItems = [
  { id: 'chat', label: 'AI Chat', icon: 'chat' },
  { id: 'swarm', label: 'Swarm Manager', icon: 'bot' },
  { id: 'gateways', label: 'Gateway Manager', icon: 'gateway' },
  { id: 'memory', label: 'Memory Manager', icon: 'memory' },
  { id: 'skills', label: 'Skill Catalog', icon: 'puzzle' },
  { id: 'library', label: 'Knowledge Library', icon: 'globe' },
  { id: 'metrics', label: 'System Metrics', icon: 'zap' },
  { id: 'cron', label: 'Cron Scheduler', icon: 'refresh' },
  { id: 'terminal', label: 'Terminal Console', icon: 'code' },
  { id: 'config', label: 'Configuration', icon: 'config' },
  { id: 'projects', label: 'Project Debugger', icon: 'project' }
]

export function Sidebar() {
  const el = document.createElement('aside')
  el.className = 'sidebar'
  el.id = 'sidebar'
  
  el.innerHTML = `
    <div class="sidebar-header">
      <div class="sidebar-logo">
        <div class="sidebar-logo-icon">E</div>
        <div>
          <div class="sidebar-logo-text">EMORA</div>
          <div class="sidebar-logo-sub">Agent Intelligence</div>
        </div>
      </div>
    </div>
    <nav class="sidebar-nav">
      ${menuItems.map(item => `
        <button class="nav-item" data-page="${item.id}">
          ${icons[item.icon]}
          <span>${item.label}</span>
        </button>
      `).join('')}
    </nav>
    <div class="sidebar-footer">
      <div class="status-indicator">
        <div class="status-dot" id="sys-status-dot"></div>
        <span id="sys-status-label">Checking...</span>
      </div>
    </div>
  `
  
  const statusDot = el.querySelector('#sys-status-dot')
  const statusLabel = el.querySelector('#sys-status-label')

  async function checkHealth() {
    try {
      const res = await fetch('/api/health')
      const body = await res.json()
      if (res.ok && body.status === 'ok') {
        statusDot.className = 'status-dot'
        statusDot.classList.add('is-on')
        statusLabel.textContent = `Online · ${body.model || 'default'}`
      } else {
        throw new Error('unhealthy')
      }
    } catch {
      statusDot.className = 'status-dot'
      statusDot.classList.add('is-off')
      statusLabel.textContent = 'Server Tidak Terjangkau'
    }
  }
  checkHealth()
  const healthTimer = setInterval(checkHealth, 15000)
  el._cleanup = () => { clearInterval(healthTimer) }
  
  el.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      store.set('currentPage', btn.dataset.page)
      store.set('sidebarOpen', false)
    })
  })
  
  store.subscribe((key, value) => {
    if (key === 'currentPage') {
      el.querySelectorAll('.nav-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.page === value)
      })
    }
    if (key === 'sidebarOpen') el.classList.toggle('open', value)
  })
  
  const currentPage = store.get('currentPage')
  const activeBtn = el.querySelector(`[data-page="${currentPage}"]`)
  if (activeBtn) activeBtn.classList.add('active')
  
  return el
}
