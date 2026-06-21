const API_BASE = ''

async function request(url, options = {}) {
  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers }
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

export const chatApi = {
  send: (sessionId, message) => request('/api/chat', {
    method: 'POST', body: JSON.stringify({ sessionId, message })
  }),
  upload: (file) => {
    const formData = new FormData()
    formData.append('file', file)
    return fetch(`${API_BASE}/api/upload`, { method: 'POST', body: formData }).then(r => r.json())
  },
  getHistory: (sessionId) => request(`/api/history/${sessionId}`)
}

export const gatewayApi = {
  list: () => request('/api/gateways'),
  update: (gateways) => request('/api/gateways', {
    method: 'POST', body: JSON.stringify({ gateways })
  })
}

export const memoryApi = {
  list: () => request('/api/memory'),
  create: (name, content = []) => request('/api/memory', {
    method: 'POST', body: JSON.stringify({ action: 'create', name, content })
  }),
  rename: (id, name) => request('/api/memory', {
    method: 'POST', body: JSON.stringify({ action: 'rename', id, name })
  }),
  delete: (id) => request(`/api/memory/${id}`, { method: 'DELETE' })
}

export const configApi = {
  get: () => request('/api/config'),
  save: (agent, soul) => request('/api/config', {
    method: 'POST', body: JSON.stringify({ agent, soul })
  })
}

export const projectApi = {
  list: () => request('/api/projects'),
  get: (name) => request(`/api/projects/${name}`),
  create: (projectName, tasks) => request('/api/projects', {
    method: 'POST', body: JSON.stringify({ projectName, tasks })
  })
}

export function connectPMStream(onMessage) {
  const es = new EventSource(`${API_BASE}/stream-pm`)
  es.onmessage = (e) => onMessage(JSON.parse(e.data))
  es.onerror = () => es.close()
  return () => es.close()
}
