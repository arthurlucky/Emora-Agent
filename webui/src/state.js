class Store {
  constructor() {
    this.state = {
      currentPage: 'chat',
      theme: localStorage.getItem('theme') || 'dark',
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
    this.listeners.forEach(l => l(key, value))
  }
  subscribe(l) { this.listeners.add(l); return () => this.listeners.delete(l) }
  toggleTheme() {
    const t = this.state.theme === 'dark' ? 'light' : 'dark'
    this.set('theme', t)
    document.documentElement.setAttribute('data-theme', t)
    localStorage.setItem('theme', t)
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
