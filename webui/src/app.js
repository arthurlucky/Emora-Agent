import { Sidebar } from './components/Sidebar.js'
import { Header } from './components/Header.js'
import { ChatInterface } from './components/ChatInterface.js'
import { GatewayManager } from './components/GatewayManager.js'
import { MemoryManager } from './components/MemoryManager.js'
import { SkillBrowser } from './components/SkillBrowser.js'
import { LibraryBrowser } from './components/LibraryBrowser.js'
import { SystemMonitor } from './components/SystemMonitor.js'
import { TerminalConsole } from './components/TerminalConsole.js'
import { ConfigEditor } from './components/ConfigEditor.js'
import { ProjectDebugger } from './components/ProjectDebugger.js'
import { SchedulerDashboard } from './components/SchedulerDashboard.js'
import { SwarmDashboard } from './components/SwarmDashboard.js'
import { store } from './state.js'

const pages = {
  chat: ChatInterface, gateways: GatewayManager,
  memory: MemoryManager, skills: SkillBrowser,
  library: LibraryBrowser, metrics: SystemMonitor,
  terminal: TerminalConsole, config: ConfigEditor,
  projects: ProjectDebugger, cron: SchedulerDashboard,
  swarm: SwarmDashboard
}

export function initApp() {
  const app = document.getElementById('app')
  const theme = store.get('theme')
  document.documentElement.setAttribute('data-theme', theme)
  
  app.innerHTML = ''
  const container = document.createElement('div')
  container.className = 'app-container'
  
  const sidebar = Sidebar()
  container.appendChild(sidebar)
  
  const overlay = document.createElement('div')
  overlay.className = 'sidebar-overlay'
  overlay.addEventListener('click', () => store.set('sidebarOpen', false))
  container.appendChild(overlay)
  
  const main = document.createElement('main')
  main.className = 'main-content'
  main.appendChild(Header())
  
  const pageContainer = document.createElement('div')
  pageContainer.id = 'page-container'
  pageContainer.style.cssText = 'flex:1;overflow-y:auto;display:flex;flex-direction:column;min-height:0;'
  main.appendChild(pageContainer)
  
  container.appendChild(main)
  app.appendChild(container)
  
  renderPage(store.get('currentPage'))
  
  store.subscribe((key, value) => {
    if (key === 'currentPage') renderPage(value)
    if (key === 'sidebarOpen') {
      sidebar.classList.toggle('open', value)
      overlay.classList.toggle('show', value)
    }
  })
}

function renderPage(pageId) {
  const container = document.getElementById('page-container')
  if (!container) return
  const PageComponent = pages[pageId] || pages.chat
  try {
    if (container.firstElementChild && container.firstElementChild._cleanup) {
      container.firstElementChild._cleanup()
    }
    container.innerHTML = ''
    container.appendChild(PageComponent())
  } catch (err) {
    console.error('Error rendering page:', err)
    container.innerHTML = `
      <div style="padding:40px;text-align:center;color:var(--text-primary);max-width:500px;margin:50px auto;background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;">
        <div style="font-size:32px;margin-bottom:12px;">⚠️</div>
        <h3 style="font-size:18px;font-weight:700;margin-bottom:8px;">Terjadi Kesalahan Saat Memuat Halaman</h3>
        <p style="color:var(--text-muted);font-size:12px;margin-bottom:16px;font-family:var(--font-mono);">${err.message || 'Unknown error'}</p>
        <button class="btn btn-primary" onclick="localStorage.clear();location.reload();">Reset Session & Reload</button>
      </div>
    `
  }
}
