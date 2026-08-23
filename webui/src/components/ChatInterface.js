import { icons } from '../utils/icons.js'
import { store } from '../state.js'
import { chatApi, memoryApi } from '../api.js'
import { showToast, formatRelative, copyToClipboard } from '../utils/helpers.js'
import { renderMarkdown, renderWidgets } from '../format.js'

// Voice recognition setup (Chrome/Android only)
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition || null

function newUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function loadPersistedSession() {
  try { return localStorage.getItem('emora_active_session') } catch { return null }
}

function persistSession(id) {
  try { localStorage.setItem('emora_active_session', id) } catch {}
}

export function ChatInterface() {
  const el = document.createElement('div')
  el.className = 'chat-wrapper'
  el.style.cssText = 'display:flex;flex-direction:column;height:100%;background:var(--bg-base);overflow:hidden;'
  
  let currentSessionId = store.get('sessionId') || loadPersistedSession()
  if (!currentSessionId) {
    currentSessionId = newUuid()
    store.set('sessionId', currentSessionId)
    persistSession(currentSessionId)
  } else if (!store.get('sessionId')) {
    store.set('sessionId', currentSessionId)
  }

  el.innerHTML = `
    <!-- Sub-header status bar -->
    <div class="chat-subheader">
      <div class="session-badge" id="session-badge-btn" style="cursor:pointer;" title="Klik untuk ganti sesi chat">
        <span class="pulse-dot"></span>
        <span class="session-id-text" id="active-session-label">Sesi: ${currentSessionId.slice(0, 8)}...</span>
      </div>
      <div class="chat-actions-header">
        <button class="btn btn-secondary btn-sm" id="switch-session-btn">${icons.memory} Pindah Sesi</button>
        <button class="btn btn-secondary btn-sm" id="upload-btn">${icons.upload} Upload</button>
        <button class="btn btn-primary btn-sm" id="new-session-btn">${icons.plus} Sesi Baru</button>
      </div>
    </div>

    <!-- Messages list -->
    <div id="chat-messages" class="chat-messages-container">
      <div class="welcome-hero">
        <div class="bot-avatar-glow">${icons.bot}</div>
        <h2 class="welcome-title">EMORA AI Agent</h2>
        <p class="welcome-subtitle">Self-hosted Autonomous AI Agent — Siap membantu tugas, shell command, dan otomatisasi skill.</p>
        
        <!-- Prompt Suggestion Chips -->
        <div class="prompt-chips-container">
          <button class="prompt-chip" data-prompt="Cek status sistem dan penggunaan resource saat ini">
            ${icons.zap} Status Sistem
          </button>
          <button class="prompt-chip" data-prompt="Tampilkan daftar skill yang tersedia di EMORA">
            ${icons.puzzle} Daftar Skill
          </button>
          <button class="prompt-chip" data-prompt="Cari informasi tentang teknologi AI agent terbaru">
            ${icons.globe} Cari Berita AI
          </button>
          <button class="prompt-chip" data-prompt="Buatkan file hello.py yang mencetak grafik bintang sederhana">
            ${icons.code} Buat Script Python
          </button>
        </div>
      </div>
    </div>

    <!-- Input bar card -->
    <div class="chat-input-card" id="chat-drop-zone">
      <div class="chat-input-toolbar" style="display:flex;align-items:center;justify-content:space-between;padding:4px 8px 0;">
        <div style="display:flex;gap:6px;">
          <button class="btn-icon" id="upload-toolbar-btn" title="Upload file" style="font-size:16px;">${icons.upload}</button>
          <button class="btn-icon" id="voice-btn" title="Input suara" style="font-size:16px;">🎤</button>
          <button class="btn-icon" id="export-chat-btn" title="Export riwayat chat" style="font-size:16px;">📤</button>
        </div>
        <span id="char-counter" style="font-size:10px;color:var(--text-muted);font-family:var(--font-mono);">0/4000</span>
      </div>
      <div class="attachment-preview-container" id="attachment-preview-container"></div>
      <div class="chat-input-wrapper">
        <textarea id="chat-input" class="chat-input-field" placeholder="Tanyakan sesuatu atau berikan perintah..." rows="1" maxlength="4000"></textarea>
        <button class="btn btn-primary send-btn" id="send-btn" title="Kirim pesan (Enter)">
          ${icons.send}
        </button>
      </div>
      <div id="drop-overlay" style="display:none;position:absolute;inset:0;background:rgba(79,216,196,0.15);border:2px dashed var(--accent-cyan);border-radius:12px;z-index:10;align-items:center;justify-content:center;font-size:16px;color:var(--accent-cyan);font-weight:600;">📂 Lepaskan file di sini</div>
    </div>
    <input type="file" id="file-input" style="display:none;" accept="*/*">

    <!-- Session Switcher Modal -->
    <div id="session-switcher-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(6px);z-index:400;align-items:center;justify-content:center;padding:20px;">
      <div class="card" style="width:100%;max-width:500px;max-height:80vh;display:flex;flex-direction:column;padding:0;overflow:hidden;border:1px solid var(--border-strong);">
        <div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;background:var(--bg-surface-raised);">
          <div>
            <h3 style="font-weight:700;font-size:16px;color:var(--text-primary);">Pindah Sesi Obrolan</h3>
            <span style="font-size:11px;color:var(--text-muted);">Pilih sesi obrolan aktif atau buat sesi baru</span>
          </div>
          <button class="btn-icon" id="session-switcher-close">${icons.close}</button>
        </div>
        <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;gap:10px;">
          <button class="btn btn-primary" id="modal-create-session" style="flex:1;">${icons.plus} Buat Sesi Baru</button>
        </div>
        <div style="flex:1;overflow-y:auto;padding:12px 16px;" id="session-modal-list">
          <div style="text-align:center;padding:30px;color:var(--text-muted);">Memuat daftar sesi...</div>
        </div>
      </div>
    </div>
  `
  
  const messagesContainer = el.querySelector('#chat-messages')
  const input = el.querySelector('#chat-input')
  const sendBtn = el.querySelector('#send-btn')
  const fileInput = el.querySelector('#file-input')
  const sessionModal = el.querySelector('#session-switcher-modal')
  const sessionModalList = el.querySelector('#session-modal-list')
  const activeSessionLabel = el.querySelector('#active-session-label')
  const charCounter = el.querySelector('#char-counter')
  const dropZone = el.querySelector('#chat-drop-zone')
  const dropOverlay = el.querySelector('#drop-overlay')

  input.addEventListener('input', () => {
    input.style.height = 'auto'
    input.style.height = Math.min(input.scrollHeight, 140) + 'px'
    const len = input.value.length
    charCounter.textContent = `${len}/4000`
    charCounter.style.color = len > 3600 ? 'var(--accent-amber)' : len > 3900 ? 'var(--accent-red)' : 'var(--text-muted)'
  })

  // ── Drag & Drop upload ──────────────────────────────────────────────────
  const previewContainer = el.querySelector('#attachment-preview-container')
  let pendingAttachments = []

  function renderAttachmentPreviews() {
    previewContainer.innerHTML = ''
    pendingAttachments.forEach((file, index) => {
      const card = document.createElement('div')
      card.className = 'attachment-card fade-in'
      card.innerHTML = `
        <div class="attachment-card-icon">📎</div>
        <div class="attachment-card-name" title="${file.name}">${file.name}</div>
        <div class="attachment-upload-status" id="upload-status-${index}" style="display:none;margin-right:4px;">
          <div class="loading-dots"><span></span><span></span><span></span></div>
        </div>
        <button class="attachment-remove-btn" data-index="${index}" title="Batal upload">✖</button>
      `
      previewContainer.appendChild(card)
    })
    
    previewContainer.querySelectorAll('.attachment-remove-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.currentTarget.dataset.index)
        pendingAttachments.splice(idx, 1)
        renderAttachmentPreviews()
      })
    })
  }

  function handleFileUpload(file) {
    if (!file) return
    pendingAttachments.push(file)
    renderAttachmentPreviews()
  }

  dropZone.style.position = 'relative'
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault()
    dropOverlay.style.display = 'flex'
  })
  dropZone.addEventListener('dragleave', (e) => {
    if (!dropZone.contains(e.relatedTarget)) dropOverlay.style.display = 'none'
  })
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault()
    dropOverlay.style.display = 'none'
    for (const file of e.dataTransfer.files) {
      handleFileUpload(file)
    }
  })

  // ── Voice Input (Chrome/Android only) ──────────────────────────────────
  const voiceBtn = el.querySelector('#voice-btn')
  if (SpeechRecognition) {
    const recognition = new SpeechRecognition()
    recognition.lang = 'id-ID'
    recognition.interimResults = false
    let voiceActive = false
    recognition.onresult = (e) => {
      const transcript = e.results[0][0].transcript
      input.value = (input.value ? input.value + ' ' : '') + transcript
      input.dispatchEvent(new Event('input'))
      voiceBtn.textContent = '🎤'
      voiceActive = false
    }
    recognition.onerror = () => { voiceBtn.textContent = '🎤'; voiceActive = false }
    recognition.onend = () => { voiceBtn.textContent = '🎤'; voiceActive = false }
    voiceBtn.addEventListener('click', () => {
      if (voiceActive) { recognition.stop(); voiceBtn.textContent = '🎤'; voiceActive = false }
      else { recognition.start(); voiceBtn.textContent = '🔴'; voiceActive = true; showToast('Mulai berbicara...', 'info') }
    })
  } else {
    voiceBtn.style.display = 'none'
  }

  // ── Export Chat ────────────────────────────────────────────────────────
  el.querySelector('#export-chat-btn').addEventListener('click', () => {
    const msgs = store.get('messages') || []
    if (!msgs.length) { showToast('Belum ada pesan untuk diekspor', 'info'); return }
    const md = msgs.map(m =>
      `**${m.role === 'user' ? 'Kamu' : 'EMORA'}** (${new Date(m.timestamp).toLocaleString('id-ID')}):\n${m.content}`
    ).join('\n\n---\n\n')
    const blob = new Blob([md], { type: 'text/markdown' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `emora-chat-${Date.now()}.md`
    a.click()
    showToast('Chat berhasil diekspor!')
  })

  el.querySelector('#upload-toolbar-btn').addEventListener('click', () => fileInput.click())

  // Prompt chips event listener
  function bindChips() {
    messagesContainer.querySelectorAll('.prompt-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const promptText = chip.getAttribute('data-prompt')
        if (promptText) {
          input.value = promptText
          sendMessage()
        }
      })
    })
  }
  bindChips()
  
  async function sendMessage() {
    const content = input.value.trim()
    if ((!content && pendingAttachments.length === 0) || store.get('isLoading')) return
    
    input.value = ''
    input.style.height = 'auto'
    store.set('isLoading', true)

    let finalContent = content
    if (pendingAttachments.length > 0) {
      const uploadPromises = pendingAttachments.map(async (file, index) => {
        const statusEl = previewContainer.querySelector(`#upload-status-${index}`)
        const removeBtn = previewContainer.querySelector(`button[data-index="${index}"]`)
        if (statusEl) statusEl.style.display = 'block'
        if (removeBtn) removeBtn.style.display = 'none' // Prevent removal during upload
        
        const result = await chatApi.upload(file)
        if (result && (result.filename || result.storedName)) {
          const servedName = result.storedName || result.path || result.filename
          return `[${result.filename || file.name}](${window.location.origin}/uploads/${servedName})`
        }
        return `[Gagal upload: ${file.name}]`
      })
      const uploadResults = await Promise.all(uploadPromises)
      finalContent = (content + '\n\n' + uploadResults.join('\n')).trim()
      pendingAttachments = []
      renderAttachmentPreviews()
    }

    addMessage({ role: 'user', content: finalContent, timestamp: Date.now() })

    // Remove welcome hero if present
    const welcome = messagesContainer.querySelector('.welcome-hero')
    if (welcome) welcome.remove()

    // Create live bot response container
    const botRow = document.createElement('div')
    botRow.className = 'chat-message-row bot-row fade-in'
    
    botRow.innerHTML = `
      <div class="avatar-badge bot-badge">${icons.bot}</div>
      <div class="message-bubble bot-bubble">
        <!-- Live Real-Time Thinking & Badges Box -->
        <div class="live-activity-box" style="margin-bottom:10px;padding:10px 12px;background:var(--bg-surface-raised);border:1px solid var(--border);border-radius:8px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-secondary);font-weight:600;">
              <span class="pulse-dot"></span>
              <span class="thinking-text">EMORA sedang berpikir...</span>
            </div>
            <button class="btn btn-secondary btn-sm stop-stream-btn" style="padding:2px 8px;font-size:11px;color:var(--accent-red);border-color:var(--accent-red);background:transparent;">⏹ Stop</button>
          </div>
          <div class="badges-row" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;"></div>
        </div>

        <div class="bubble-content"></div>
        <div class="bubble-footer" style="display:none;">
          <span class="bubble-time">${formatTime(Date.now())}</span>
          <button class="copy-btn">${icons.copy} Copy</button>
        </div>
      </div>
    `

    messagesContainer.appendChild(botRow)
    messagesContainer.scrollTop = messagesContainer.scrollHeight

    const thinkingTextEl = botRow.querySelector('.thinking-text')
    const badgesRow = botRow.querySelector('.badges-row')
    const bubbleContent = botRow.querySelector('.bubble-content')
    const bubbleFooter = botRow.querySelector('.bubble-footer')
    const activityBox = botRow.querySelector('.live-activity-box')
    const stopBtn = botRow.querySelector('.stop-stream-btn')

    let accumulatedText = ''
    const currentId = store.get('sessionId')
    const activeBadges = new Set()

    const abortStream = chatApi.sendStream(currentId, content, {
      onEvent: (event) => {
        if (event.type === 'thinking') {
          thinkingTextEl.textContent = event.text
        } else if (event.type === 'skill_use' || event.type === 'skill_read') {
          const skillName = event.skill || event.name || '?'
          if (!activeBadges.has(`s:${skillName}`)) {
            activeBadges.add(`s:${skillName}`)
            const badge = document.createElement('span')
            badge.className = 'badge fade-in'
            badge.style.cssText = 'background:rgba(163,113,247,0.18);color:var(--accent-purple);border:1px solid var(--accent-purple);font-size:11px;padding:3px 8px;border-radius:6px;display:inline-flex;align-items:center;gap:4px;'
            badge.innerHTML = `${icons.puzzle} skill: <strong>${escapeHtml(skillName)}</strong>`
            badgesRow.appendChild(badge)
          }
        } else if (event.type === 'tool_use') {
          const toolName = event.tool || event.name || '?'
          if (!activeBadges.has(`t:${toolName}`)) {
            activeBadges.add(`t:${toolName}`)
            const badge = document.createElement('span')
            badge.className = 'badge fade-in'
            badge.style.cssText = 'background:rgba(79,216,196,0.18);color:var(--accent-cyan);border:1px solid var(--accent-cyan);font-size:11px;padding:3px 8px;border-radius:6px;display:inline-flex;align-items:center;gap:4px;'
            badge.innerHTML = `${icons.zap} tool: <strong>${escapeHtml(toolName)}</strong>`
            badgesRow.appendChild(badge)
          }
        } else if (event.type === 'command') {
          // Balasan perintah slash (/clear, /new, /sesi, /help, dsb).
          const cmdText = event.content || ''
          if (event.newSessionId && event.newSessionId !== store.get('sessionId')) {
            store.set('sessionId', event.newSessionId)
            persistSession(event.newSessionId)
            activeSessionLabel.textContent = `Sesi: ${event.newSessionId.slice(0, 8)}...`
          }
          bubbleContent.innerHTML = renderMarkdown(cmdText)
          store.set('isLoading', false)
          activityBox.style.display = 'none'
          bubbleFooter.style.display = 'flex'
          store.addMessage({ role: 'assistant', content: cmdText, timestamp: Date.now() })
        }
        messagesContainer.scrollTop = messagesContainer.scrollHeight
      },
      onToken: (token) => {
        accumulatedText += token
        bubbleContent.innerHTML = renderMarkdown(accumulatedText)
        messagesContainer.scrollTop = messagesContainer.scrollHeight
      },
      onDone: (data) => {
        store.set('isLoading', false)
        activityBox.style.display = 'none'
        bubbleFooter.style.display = 'flex'
        const finalText = data?.content || accumulatedText
        if (finalText) {
          bubbleContent.innerHTML = renderMarkdown(finalText)
          renderWidgets(bubbleContent)
          store.addMessage({ role: 'assistant', content: finalText, timestamp: Date.now() })
        }
        const copyBtn = botRow.querySelector('.copy-btn')
        if (copyBtn) {
          copyBtn.addEventListener('click', () => {
            copyToClipboard(finalText)
            showToast('Teks berhasil disalin')
          })
        }
        messagesContainer.scrollTop = messagesContainer.scrollHeight
      },
      onError: (err) => {
        store.set('isLoading', false)
        activityBox.style.display = 'none'
        bubbleContent.innerHTML += `<div style="color:var(--accent-red);margin-top:10px;font-size:12px;padding:8px;background:rgba(255,100,100,0.1);border-radius:6px;">❌ ${escapeHtml(err)}</div>`
        if (accumulatedText) {
          bubbleFooter.style.display = 'flex'
          store.addMessage({ role: 'assistant', content: accumulatedText, timestamp: Date.now() })
        }
      }
    })
    
    stopBtn.addEventListener('click', () => {
      abortStream()
      store.set('isLoading', false)
      activityBox.style.display = 'none'
      bubbleContent.innerHTML += `<div style="color:var(--accent-amber);margin-top:10px;font-size:12px;">(Dihentikan oleh pengguna)</div>`
      if (accumulatedText) {
        bubbleFooter.style.display = 'flex'
        store.addMessage({ role: 'assistant', content: accumulatedText, timestamp: Date.now() })
      }
    })
  }
  
  sendBtn.addEventListener('click', sendMessage)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  })

  el.querySelector('#upload-btn').addEventListener('click', () => fileInput.click())

  // ── Global keyboard shortcuts ──────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      sessionModal.style.display = 'none'
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
      e.preventDefault()
      createNewSession()
    }
  })
  
  fileInput.addEventListener('change', (e) => {
    for (const file of e.target.files) {
      handleFileUpload(file)
    }
    fileInput.value = ''
  })
  
  // New session button
  el.querySelector('#new-session-btn').addEventListener('click', async () => {
    await createNewSession()
  })

  el.querySelector('#modal-create-session').addEventListener('click', async () => {
    await createNewSession()
    sessionModal.style.display = 'none'
  })

  async function createNewSession() {
    try {
      const res = await memoryApi.create()
      const newId = res.session?.id || res.memory?.id || `session_${Date.now()}`
      switchSession(newId, res.session?.name || 'Sesi Baru')
      showToast('Sesi obrolan baru dimulai')
    } catch (e) {
      showToast('Gagal membuat sesi di server', 'error')
    }
  }

  // Session switcher listeners
  el.querySelector('#switch-session-btn').addEventListener('click', openSessionSwitcher)
  el.querySelector('#session-badge-btn').addEventListener('click', openSessionSwitcher)
  el.querySelector('#session-switcher-close').addEventListener('click', () => sessionModal.style.display = 'none')
  sessionModal.addEventListener('click', (e) => { if (e.target === sessionModal) sessionModal.style.display = 'none' })

  async function openSessionSwitcher() {
    sessionModalList.innerHTML = `<div style="text-align:center;padding:30px;color:var(--text-muted);"><div class="loading-dots" style="justify-content:center;margin-bottom:12px;"><span></span><span></span><span></span></div>Memuat sesi obrolan...</div>`
    sessionModal.style.display = 'flex'

    try {
      const res = await memoryApi.list()
      const sessions = res.sessions || res.memories || []
      renderSessionModalList(sessions)
    } catch (err) {
      sessionModalList.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted);">Gagal mengambil daftar sesi.</div>`
    }
  }

  function renderSessionModalList(sessions) {
    const currentId = store.get('sessionId')
    if (sessions.length === 0) {
      sessionModalList.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted);">Belum ada sesi tersimpan.</div>`
      return
    }

    sessionModalList.innerHTML = sessions.map(s => {
      const isActive = s.id === currentId
      return `
        <div class="session-modal-item" data-id="${s.id}" data-name="${escapeHtml(s.name || 'Sesi')}" style="padding:12px 14px;border-radius:10px;margin-bottom:8px;background:${isActive ? 'var(--accent-cyan-dim)' : 'var(--bg-surface-raised)'};border:1px solid ${isActive ? 'var(--accent-cyan)' : 'var(--border)'};display:flex;align-items:center;justify-content:space-between;cursor:pointer;transition:all 0.15s;">
          <div>
            <div style="font-weight:600;font-size:13.5px;color:${isActive ? 'var(--accent-cyan)' : 'var(--text-primary)'};display:flex;align-items:center;gap:6px;">
              ${isActive ? '<span class="pulse-dot"></span>' : ''} ${escapeHtml(s.name || 'Sesi')}
            </div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">
              💬 ${s.messageCount || 0} pesan · Updated ${formatRelative(s.updatedAt)}
            </div>
          </div>
          <button class="btn btn-sm ${isActive ? 'btn-primary' : 'btn-secondary'}">${isActive ? 'Aktif' : 'Pilih'}</button>
        </div>
      `
    }).join('')

    sessionModalList.querySelectorAll('.session-modal-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = item.dataset.id
        const name = item.dataset.name
        switchSession(id, name)
        sessionModal.style.display = 'none'
      })
    })
  }

  async function switchSession(id, name = null) {
    store.set('sessionId', id)
    persistSession(id)
    activeSessionLabel.textContent = `Sesi: ${(name || id).slice(0, 16)}...`
    messagesContainer.innerHTML = `<div style="text-align:center;padding:50px;color:var(--text-muted);"><div class="loading-dots" style="justify-content:center;margin-bottom:12px;"><span></span><span></span><span></span></div>Memuat riwayat obrolan...</div>`

    try {
      const history = await chatApi.getHistory(id)
      messagesContainer.innerHTML = ''
      if (Array.isArray(history) && history.length > 0) {
        store.set('messages', history)
        history.forEach(msg => addMessage(msg, false))
      } else {
        store.set('messages', [])
        renderWelcomeHero()
      }
    } catch (err) {
      messagesContainer.innerHTML = ''
      renderWelcomeHero()
    }
  }

  function renderWelcomeHero() {
    messagesContainer.innerHTML = `
      <div class="welcome-hero">
        <div class="bot-avatar-glow">${icons.bot}</div>
        <h2 class="welcome-title">EMORA AI Agent</h2>
        <p class="welcome-subtitle">Self-hosted Autonomous AI Agent — Siap membantu tugas, shell command, dan otomatisasi skill.</p>
        
        <div class="prompt-chips-container">
          <button class="prompt-chip" data-prompt="Cek status sistem dan penggunaan resource saat ini">${icons.zap} Status Sistem</button>
          <button class="prompt-chip" data-prompt="Tampilkan daftar skill yang tersedia di EMORA">${icons.puzzle} Daftar Skill</button>
          <button class="prompt-chip" data-prompt="Cari berita teknologi terbaru hari ini">${icons.globe} Cari Berita</button>
        </div>
      </div>
    `
    bindChips()
  }
  
  function addMessage(message, appendToStore = true) {
    if (appendToStore) store.addMessage(message)
    const msgEl = document.createElement('div')
    msgEl.className = `chat-message-row ${message.role === 'user' ? 'user-row' : 'bot-row'} fade-in`
    
    const isUser = message.role === 'user'
    const renderedBody = isUser ? escapeHtml(message.content) : renderMarkdown(message.content)

    msgEl.innerHTML = `
      <div class="avatar-badge ${isUser ? 'user-badge' : 'bot-badge'}">
        ${isUser ? icons.user : icons.bot}
      </div>
      <div class="message-bubble ${isUser ? 'user-bubble' : 'bot-bubble'}">
        <div class="bubble-content">${renderedBody}</div>
        <div class="bubble-footer">
          <span class="bubble-time">${formatTime(message.timestamp)}</span>
          ${!isUser ? `<button class="copy-btn">${icons.copy} Copy</button>` : ''}
        </div>
      </div>
    `
    
    if (!isUser) {
      renderWidgets(msgEl)
      msgEl.querySelector('.copy-btn').addEventListener('click', () => {
        copyToClipboard(message.content)
        showToast('Teks berhasil disalin')
      })
    }
    
    const welcome = messagesContainer.querySelector('.welcome-hero')
    if (welcome) welcome.remove()
    messagesContainer.appendChild(msgEl)
    messagesContainer.scrollTop = messagesContainer.scrollHeight
  }
  
  function escapeHtml(text) {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML.replace(/\n/g, '<br>')
  }
  
  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  
  // Only toggle send button state — live-activity-box handles thinking display
  store.subscribe((key, value) => {
    if (key === 'isLoading') {
      sendBtn.disabled = value
      sendBtn.style.opacity = value ? '0.5' : '1'
      input.disabled = value
    }
  })

  // Muat riwayat sesi persisten saat pertama render (setelah refresh page),
  // supaya percakapan sebelumnya tidak hilang. Sesui baru tetap welcome hero.
  if (loadPersistedSession() && currentSessionId) {
    switchSession(currentSessionId)
  }
  
  return el
}
