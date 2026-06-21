import { icons } from '../utils/icons.js'
import { store } from '../state.js'

export function Header() {
  const el = document.createElement('header')
  el.className = 'header'
  
  const pageTitles = {
    chat: 'AI Chat', gateways: 'Gateway Manager',
    memory: 'Memory Manager', config: 'Configuration',
    projects: 'Project Debugger'
  }
  
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;">
      <button class="btn-icon mobile-only" id="menu-toggle" style="display:none;">${icons.menu}</button>
      <h1 class="header-title" id="page-title">AI Chat</h1>
    </div>
    <div class="header-actions">
      <button class="btn-icon" id="theme-toggle" title="Toggle theme">
        ${store.get('theme') === 'dark' ? icons.sun : icons.moon}
      </button>
    </div>
  `
  
  el.querySelector('#theme-toggle').addEventListener('click', () => store.toggleTheme())
  
  const menuToggle = el.querySelector('#menu-toggle')
  if (menuToggle) {
    menuToggle.addEventListener('click', () => store.set('sidebarOpen', !store.get('sidebarOpen')))
  }
  
  store.subscribe((key, value) => {
    if (key === 'currentPage') el.querySelector('#page-title').textContent = pageTitles[value] || value
    if (key === 'theme') {
      el.querySelector('#theme-toggle').innerHTML = value === 'dark' ? icons.sun : icons.moon
    }
  })
  
  return el
}
