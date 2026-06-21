import { Sidebar } from './components/Sidebar.js'
import { Header } from './components/Header.js'
import { ChatInterface } from './components/ChatInterface.js'
import { GatewayManager } from './components/GatewayManager.js'
import { MemoryManager } from './components/MemoryManager.js'
import { ConfigEditor } from './components/ConfigEditor.js'
import { ProjectDebugger } from './components/ProjectDebugger.js'
import { store } from './state.js'

const pages = {
  chat: ChatInterface, gateways: GatewayManager,
  memory: MemoryManager, config: ConfigEditor, projects: ProjectDebugger
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
  pageContainer.style.cssText = 'flex:1;overflow:hidden;'
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
  const PageComponent = pages[pageId]
  if (PageComponent) {
    container.innerHTML = ''
    container.appendChild(PageComponent())
  }
}
