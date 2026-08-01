function getSafeStorage(key, fallback = null) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch (e) {
    return fallback;
  }
}

function setSafeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {}
}

class Store {
  constructor() {
    let persistedPage = 'chat'
    try { persistedPage = sessionStorage.getItem('emora_page') || 'chat' } catch {}
    this.state = {
      currentPage: persistedPage,
      theme: getSafeStorage('theme', 'dark'),
      sessionId: `session_${Date.now()}`,
      messages: [],
      gateways: [],
      memories: [],
      projects: [],
      currentPlan: null,
      debugLogs: [],
      isLoading: false,
      sidebarOpen: false
    }
    this.listeners = new Set()
  }
  get(key) { return this.state[key] }
  set(key, value) {
    this.state[key] = value
    if (key === 'currentPage') { try { sessionStorage.setItem('emora_page', value) } catch {} }
    this.listeners.forEach(l => l(key, value))
  }
  subscribe(l) { this.listeners.add(l); return () => this.listeners.delete(l) }
  cycleTheme() {
    const themes = ['dark', 'cyberpunk', 'solarized', 'light']
    const currentIdx = themes.indexOf(this.state.theme)
    const nextTheme = themes[(currentIdx + 1) % themes.length]
    this.set('theme', nextTheme)
    document.documentElement.setAttribute('data-theme', nextTheme)
    setSafeStorage('theme', nextTheme)
  }
  addMessage(m) { this.state.messages.push(m); this.notify('messages', this.state.messages) }
  addDebugLog(l) {
    this.state.debugLogs.unshift(l)
    if (this.state.debugLogs.length > 500) this.state.debugLogs.pop()
    this.notify('debugLogs', this.state.debugLogs)
  }
  notify(k, v) { this.listeners.forEach(l => l(k, v)) }
}

export const store = new Store()
