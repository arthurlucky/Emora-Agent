import { icons } from '../utils/icons.js'
import { store } from '../state.js'
import { chatApi } from '../api.js'
import { showToast } from '../utils/helpers.js'

export function ChatInterface() {
  const el = document.createElement('div')
  el.style.cssText = 'display:flex;flex-direction:column;height:100%;'
  
  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 24px;border-bottom:1px solid var(--border);">
      <span style="font-family:var(--font-mono);font-size:12px;color:var(--text-muted);padding:4px 10px;background:var(--bg-secondary);border-radius:6px;">
        ${store.get('sessionId').slice(0, 8)}...
      </span>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-secondary btn-sm" id="upload-btn">${icons.upload} Upload</button>
        <button class="btn btn-secondary btn-sm" id="new-session-btn">${icons.refresh} New Session</button>
      </div>
    </div>
    <div id="chat-messages" style="flex:1;overflow-y:auto;padding:24px;display:flex;flex-direction:column;gap:16px;">
      <div style="text-align:center;padding:40px;color:var(--text-muted);">
        ${icons.bot}
        <p style="margin-top:16px;font-size:18px;font-weight:600;">Welcome to EMORA</p>
        <p style="margin-top:8px;font-size:14px;">Start a conversation or upload a file</p>
      </div>
    </div>
    <div style="padding:16px 24px;border-top:1px solid var(--border);">
      <div style="display:flex;gap:12px;align-items:flex-end;">
        <textarea id="chat-input" class="input" placeholder="Type your message..." rows="1" style="resize:none;min-height:48px;max-height:120px;padding:12px 16px;"></textarea>
        <button class="btn btn-primary" id="send-btn" style="height:48px;padding:0 20px;">${icons.send}</button>
      </div>
    </div>
    <input type="file" id="file-input" style="display:none;" accept="*/*">
  `
  
  const messagesContainer = el.querySelector('#chat-messages')
  const input = el.querySelector('#chat-input')
  const sendBtn = el.querySelector('#send-btn')
  const fileInput = el.querySelector('#file-input')
  
  input.addEventListener('input', () => {
    input.style.height = 'auto'
    input.style.height = Math.min(input.scrollHeight, 120) + 'px'
  })
  
  async function sendMessage() {
    const content = input.value.trim()
    if (!content || store.get('isLoading')) return
    
    addMessage({ role: 'user', content, timestamp: Date.now() })
    input.value = ''
    input.style.height = 'auto'
    store.set('isLoading', true)
    
    try {
      const response = await chatApi.send(store.get('sessionId'), content)
      if (response.success) {
        addMessage({ role: 'assistant', content: response.reply, timestamp: Date.now() })
      }
    } catch (error) {
      showToast('Failed to send message', 'error')
    } finally {
      store.set('isLoading', false)
    }
  }
  
  sendBtn.addEventListener('click', sendMessage)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  })
  
  el.querySelector('#upload-btn').addEventListener('click', () => fileInput.click())
  
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0]
    if (!file) return
    try {
      const result = await chatApi.upload(file)
      if (result.success) {
        addMessage({ role: 'user', content: `[File: ${result.filename}]\n\n${result.content.slice(0, 2000)}`, timestamp: Date.now() })
        showToast('File uploaded successfully')
      }
    } catch (error) { showToast('Failed to upload file', 'error') }
    fileInput.value = ''
  })
  
  el.querySelector('#new-session-btn').addEventListener('click', () => {
    store.set('sessionId', `session_${Date.now()}`)
    store.set('messages', [])
    messagesContainer.innerHTML = `
      <div style="text-align:center;padding:40px;color:var(--text-muted);">
        ${icons.bot}
        <p style="margin-top:16px;font-size:18px;font-weight:600;">New Session Started</p>
        <p style="margin-top:8px;font-size:14px;">Start a fresh conversation</p>
      </div>
    `
  })
  
  function addMessage(message) {
    store.addMessage(message)
    const msgEl = document.createElement('div')
    msgEl.className = 'fade-in'
    msgEl.style.cssText = `display:flex;${message.role === 'user' ? 'justify-content:flex-end;' : 'justify-content:flex-start;'}`
    
    const bubble = document.createElement('div')
    bubble.style.cssText = `
      max-width:70%;padding:12px 16px;border-radius:16px;font-size:14px;line-height:1.6;word-break:break-word;
      ${message.role === 'user' 
        ? 'background:var(--accent);color:white;border-bottom-right-radius:4px;' 
        : 'background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border);border-bottom-left-radius:4px;'}
    `
    bubble.innerHTML = `
      <div style="white-space:pre-wrap;">${escapeHtml(message.content)}</div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:8px;opacity:0.7;font-size:11px;">
        ${formatTime(message.timestamp)}
        ${message.role === 'assistant' ? `<button class="copy-btn" style="background:none;border:none;color:inherit;cursor:pointer;padding:2px 6px;border-radius:4px;display:flex;align-items:center;gap:4px;">${icons.copy} Copy</button>` : ''}
      </div>
    `
    
    if (message.role === 'assistant') {
      bubble.querySelector('.copy-btn').addEventListener('click', () => {
        navigator.clipboard.writeText(message.content)
        showToast('Copied to clipboard')
      })
    }
    
    msgEl.appendChild(bubble)
    const welcome = messagesContainer.querySelector('[style*="text-align:center"]')
    if (welcome) welcome.remove()
    messagesContainer.appendChild(msgEl)
    messagesContainer.scrollTop = messagesContainer.scrollHeight
  }
  
  function escapeHtml(text) {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }
  
  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  
  store.subscribe((key, value) => {
    if (key === 'isLoading') {
      if (value) {
        const loadingEl = document.createElement('div')
        loadingEl.id = 'loading-indicator'
        loadingEl.style.cssText = 'display:flex;justify-content:flex-start;'
        loadingEl.innerHTML = `<div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:16px;border-bottom-left-radius:4px;padding:12px 16px;"><div class="loading-dots"><span></span><span></span><span></span></div></div>`
        messagesContainer.appendChild(loadingEl)
        messagesContainer.scrollTop = messagesContainer.scrollHeight
      } else {
        const loading = messagesContainer.querySelector('#loading-indicator')
        if (loading) loading.remove()
      }
    }
  })
  
  return el
}
