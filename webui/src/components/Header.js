import { icons } from '../utils/icons.js'
import { store } from '../state.js'

export function Header() {
  const el = document.createElement('header')
  el.className = 'header'
  
  const pageTitles = {
    chat: 'AI Chat', gateways: 'Gateway Manager',
    memory: 'Memory Manager', skills: 'Skill Catalog',
    library: 'Knowledge Library', metrics: 'System Metrics',
    terminal: 'Terminal Console', config: 'Configuration',
    projects: 'Project Debugger', cron: 'Cron Scheduler',
    swarm: 'Swarm Manager'
  }
  
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;">
      <button class="btn-icon mobile-only" id="menu-toggle" style="display:none;">${icons.menu}</button>
      <h1 class="header-title" id="page-title">AI Chat</h1>
    </div>
    <div class="header-actions">
      <button class="btn btn-secondary btn-sm" id="theme-toggle" title="Ganti Tema">
        ${icons.sun} <span id="theme-label" style="text-transform:capitalize;">${store.get('theme')}</span>
      </button>
    </div>
  `
  
  el.querySelector('#theme-toggle').addEventListener('click', () => store.cycleTheme())
  
  const menuToggle = el.querySelector('#menu-toggle')
  if (menuToggle) {
    menuToggle.addEventListener('click', () => store.set('sidebarOpen', !store.get('sidebarOpen')))
  }
  
  store.subscribe((key, value) => {
    if (key === 'currentPage') el.querySelector('#page-title').textContent = pageTitles[value] || value
    if (key === 'theme') {
      const label = el.querySelector('#theme-label')
      if (label) label.textContent = value
    }
  })
  
  return el
}
