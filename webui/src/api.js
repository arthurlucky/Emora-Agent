const API_BASE = ''

async function request(url, options = {}) {
  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers }
  })
  if (!response.ok) {
    let message = `HTTP ${response.status}`
    try {
      const body = await response.json()
      if (body.error) message = body.error
      if (body.hint) message += ` — ${body.hint}`
    } catch { /* body bukan JSON, pakai fallback */ }
    throw new Error(message)
  }
  return response.json()
}

export const chatApi = {
  send: (sessionId, message) => request('/api/chat', {
    method: 'POST', body: JSON.stringify({ sessionId, message })
  }),
  sendStream: (sessionId, message, { onEvent, onToken, onDone, onError }) => {
    const controller = new AbortController();
    let timeoutId = null;
    let finished = false;

    const finish = (fn, payload) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutId);
      try { fn && fn(payload); } catch (e) { console.error('[Stream callback error]', e); }
    };

    const resetTimeout = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => controller.abort(new Error('Timeout: Tidak ada respon dari server.')), 60000);
    };
    resetTimeout();
    
    fetch(`${API_BASE}/api/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message }),
      signal: controller.signal
    }).then(async (res) => {
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const b = await res.json(); msg = b.error || msg; } catch {}
        throw new Error(msg);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let streamEnded = false;

      while (true) {
        const { done, value } = await reader.read();
        resetTimeout();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmed.slice(6));
              if (data.type === 'stream_token') {
                streamEnded = false;
                onToken && onToken(data.content);
              }
              else if (data.type === 'done') finish(onDone, data);
              else if (data.type === 'error') finish(onError, data.content || 'Terjadi kesalahan pada server.');
              else onEvent && onEvent(data);
            } catch (e) {
              console.error('[Stream Parse Error]', e);
            }
          }
        }
      }
      clearTimeout(timeoutId);
      // Stream ditutup server tanpa event 'done'/'error' (mis. balasan
      // command /clear, /help). Pastikan callback tetap terpanggil biar
      // state loading gak nyangkut selamanya.
      if (!finished) finish(onDone, { type: 'done', content: '', ended: streamEnded });
    }).catch(err => {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError' || err.message.includes('Timeout')) {
        finish(onError, 'Koneksi terputus atau timeout.');
      } else {
        finish(onError, err.message);
      }
    });
    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  },
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
  }),
  start: (platform) => request('/api/gateways', {
    method: 'POST', body: JSON.stringify({ action: 'start', platform })
  }),
  stop: (platform) => request('/api/gateways', {
    method: 'POST', body: JSON.stringify({ action: 'stop', platform })
  })
}

export const memoryApi = {
  list: () => request('/api/memory'),
  get: (id) => request(`/api/memory/${id}`),
  create: (name, content = []) => request('/api/memory', {
    method: 'POST', body: JSON.stringify({ action: 'create', name, content })
  }),
  rename: (id, name) => request('/api/memory', {
    method: 'POST', body: JSON.stringify({ action: 'rename', id, name })
  }),
  delete: (id) => request(`/api/memory/${id}`, { method: 'DELETE' })
}

export const skillApi = {
  list: () => request('/api/skills'),
  get: (name) => request(`/api/skills/${name}`),
  toggle: (name, enabled) => request('/api/skills/toggle', {
    method: 'POST', body: JSON.stringify({ name, enabled })
  })
}

export const libraryApi = {
  list: () => request('/api/library'),
  readFile: (relPath) => request(`/api/library/file?path=${encodeURIComponent(relPath)}`)
}

export const systemApi = {
  getMetrics: () => request('/api/system/metrics')
}

export const terminalApi = {
  exec: (command) => request('/api/terminal/exec', {
    method: 'POST', body: JSON.stringify({ command })
  })
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

export async function getSessions() { return request('/api/sessions'); }
export async function createSession(name) { return request('/api/sessions', { method: 'POST', body: JSON.stringify({ name }) }); }
export async function renameSession(id, name) { return request(`/api/sessions/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }); }
export async function deleteSession(id) { return request(`/api/sessions/${id}`, { method: 'DELETE' }); }
export async function getHistory(sessionId) { return request(`/api/history/${sessionId}`); }
export async function sendMessage(sessionId, message) { return request('/api/chat', { method: 'POST', body: JSON.stringify({ sessionId, message }) }); }

export const cronApi = {
  list: () => request('/api/cron'),
  save: (data) => request('/api/cron', { method: 'POST', body: JSON.stringify(data) }),
  delete: (name) => request(`/api/cron/${encodeURIComponent(name)}`, { method: 'DELETE' })
}

export const swarmApi = {
  list: () => request('/api/swarm/list'),
  create: (id) => request('/api/swarm/create', { method: 'POST', body: JSON.stringify({ id }) }),
  start: (id) => request('/api/swarm/start', { method: 'POST', body: JSON.stringify({ id }) }),
  stop: (id) => request('/api/swarm/stop', { method: 'POST', body: JSON.stringify({ id }) }),
  delete: (id) => request('/api/swarm/delete', { method: 'POST', body: JSON.stringify({ id }) }),
  getConfig: (id) => request(`/api/swarm/config/${id}`),
  saveConfig: (id, config) => request(`/api/swarm/config/${id}`, { method: 'POST', body: JSON.stringify(config) }),
  chat: (id, message) => request('/api/swarm/chat', { method: 'POST', body: JSON.stringify({ id, message }) })
}
