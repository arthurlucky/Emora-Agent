import { icons } from '../utils/icons.js'
import { store } from '../state.js'

const menuItems = [
  { id: 'chat', label: 'AI Chat', icon: 'chat' },
  { id: 'gateways', label: 'Gateway Manager', icon: 'gateway' },
  { id: 'memory', label: 'Memory Manager', icon: 'memory' },
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
        <div class="status-dot"></div>
        <span>System Online</span>
      </div>
    </div>
  `
  
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
