import { icons } from '../utils/icons.js'
import { memoryApi } from '../api.js'
import { showToast, formatBytes, formatTime } from '../utils/helpers.js'
import { renderMarkdown } from '../format.js'
import { escapeHtml } from '../dom.js'

export function MemoryManager() {
  const el = document.createElement('div')
  el.className = 'fade-in'
  el.style.padding = '24px'
  
  el.innerHTML = `
    <div style="max-width:1100px;margin:0 auto;">
      <!-- Header -->
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px;">
        <div>
          <h2 style="font-size:24px;font-weight:700;letter-spacing:-0.5px;color:var(--text-primary);">Memory & Session Manager</h2>
          <p style="color:var(--text-muted);font-size:13px;margin-top:2px;">Inspeksi, kelola, dan kelola riwayat memori percakapan persisten EMORA.</p>
        </div>
        <div style="display:flex;gap:10px;">
          <button class="btn btn-secondary" id="refresh-memory-btn">${icons.refresh} Refresh</button>
          <button class="btn btn-primary" id="create-memory-btn">${icons.plus} Sesi Memori Baru</button>
        </div>
      </div>

      <!-- Stats Grid -->
      <div class="grid grid-3" style="margin-bottom:24px;gap:16px;">
        <div class="card" style="padding:16px 20px;display:flex;align-items:center;gap:16px;">
          <div style="width:44px;height:44px;border-radius:12px;background:rgba(79,216,196,0.12);color:var(--accent-cyan);display:flex;align-items:center;justify-content:center;">
            ${icons.memory}
          </div>
          <div>
            <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);font-weight:600;">Total Memori</div>
            <div style="font-size:22px;font-weight:700;color:var(--text-primary);" id="stat-total-sessions">0</div>
          </div>
        </div>
        <div class="card" style="padding:16px 20px;display:flex;align-items:center;gap:16px;">
          <div style="width:44px;height:44px;border-radius:12px;background:rgba(163,113,247,0.12);color:var(--accent-purple);display:flex;align-items:center;justify-content:center;">
            ${icons.chat}
          </div>
          <div>
            <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);font-weight:600;">Total Pesan Stored</div>
            <div style="font-size:22px;font-weight:700;color:var(--text-primary);" id="stat-total-messages">0</div>
          </div>
        </div>
        <div class="card" style="padding:16px 20px;display:flex;align-items:center;gap:16px;">
          <div style="width:44px;height:44px;border-radius:12px;background:rgba(255,170,0,0.12);color:#ffaa00;display:flex;align-items:center;justify-content:center;">
            ${icons.save}
          </div>
          <div>
            <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);font-weight:600;">Ukuran Penyimpanan</div>
            <div style="font-size:22px;font-weight:700;color:var(--text-primary);" id="stat-total-size">0 KB</div>
          </div>
        </div>
      </div>

      <!-- Search & Filter Bar -->
      <div style="display:flex;gap:12px;margin-bottom:20px;align-items:center;">
        <div style="position:relative;flex:1;">
          <input type="text" class="input" id="search-memory-input" placeholder="Cari memori berdasarkan nama atau ID sesi..." style="padding-left:38px;">
          <div style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--text-muted);">${icons.search}</div>
        </div>
      </div>

      <!-- Memory Grid -->
      <div id="memory-grid" class="grid grid-3" style="gap:16px;">
        <div style="text-align:center;padding:50px;color:var(--text-muted);grid-column:1 / -1;">
          <div class="loading-dots" style="justify-content:center;margin-bottom:12px;"><span></span><span></span><span></span></div>
          Memuat memori percakapan...
        </div>
      </div>
    </div>

    <!-- Rename Modal -->
    <div id="rename-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);z-index:300;align-items:center;justify-content:center;padding:20px;">
      <div class="card" style="width:100%;max-width:420px;padding:24px;">
        <h3 style="font-weight:700;font-size:18px;margin-bottom:8px;">Ganti Nama Memori</h3>
        <p style="color:var(--text-muted);font-size:13px;margin-bottom:16px;">Berikan label khusus untuk sesi memori ini.</p>
        <input type="text" class="input" id="rename-input" placeholder="Nama baru..." style="margin-bottom:20px;">
        <div style="display:flex;gap:12px;justify-content:flex-end;">
          <button class="btn btn-secondary" id="rename-cancel">Batal</button>
          <button class="btn btn-primary" id="rename-confirm">Simpan Perubahan</button>
        </div>
      </div>
    </div>

    <!-- Inspect Modal -->
    <div id="inspect-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(6px);z-index:300;align-items:center;justify-content:center;padding:20px;">
      <div class="card" style="width:100%;max-width:800px;height:85vh;display:flex;flex-direction:column;padding:0;overflow:hidden;border:1px solid var(--border-strong);">
        <div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;background:var(--bg-surface-raised);">
          <div>
            <h3 style="font-weight:700;font-size:16px;" id="inspect-title">Detail Memori</h3>
            <span style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono);" id="inspect-id"></span>
          </div>
          <button class="btn-icon" id="inspect-close">${icons.close}</button>
        </div>
        <div style="flex:1;overflow-y:auto;padding:20px;background:var(--bg-surface);" id="inspect-content">
          <div style="text-align:center;padding:40px;color:var(--text-muted);">Memuat riwayat memori...</div>
        </div>
        <div style="padding:12px 20px;border-top:1px solid var(--border);background:var(--bg-surface-raised);display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:12px;color:var(--text-muted);" id="inspect-footer-info"></span>
          <button class="btn btn-secondary btn-sm" id="inspect-export-btn">${icons.copy} Export JSON</button>
        </div>
      </div>
    </div>
  `
  
  const gridEl = el.querySelector('#memory-grid')
  const renameModal = el.querySelector('#rename-modal')
  const inspectModal = el.querySelector('#inspect-modal')
  const searchInput = el.querySelector('#search-memory-input')
  
  let memories = []
  let renameTarget = null
  let inspectTarget = null
  
  async function loadMemories() {
    gridEl.innerHTML = `<div style="text-align:center;padding:50px;color:var(--text-muted);grid-column:1 / -1;"><div class="loading-dots" style="justify-content:center;margin-bottom:12px;"><span></span><span></span><span></span></div>Memuat memori percakapan...</div>`
    try {
      const response = await memoryApi.list()
      if (response.success) {
        memories = response.memories || []
        updateStats()
        renderMemories()
      }
    } catch (error) {
      showToast('Gagal memuat daftar memori', 'error')
      gridEl.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);grid-column:1 / -1;">Gagal memuat data memori.</div>`
    }
  }

  function updateStats() {
    const totalSessions = memories.length
    const totalMsgs = memories.reduce((acc, m) => acc + (m.messageCount || 0), 0)
    const totalBytesVal = memories.reduce((acc, m) => acc + (m.size || 0), 0)
    
    el.querySelector('#stat-total-sessions').textContent = totalSessions
    el.querySelector('#stat-total-messages').textContent = totalMsgs
    el.querySelector('#stat-total-size').textContent = formatBytes(totalBytesVal)
  }
  
  function renderMemories() {
    const query = searchInput.value.toLowerCase().trim()
    const filtered = memories.filter(m => 
      (m.name || '').toLowerCase().includes(query) || (m.id || '').toLowerCase().includes(query)
    )

    if (filtered.length === 0) {
      gridEl.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);grid-column:1 / -1;">${query ? 'Tidak ada memori yang cocok dengan pencarian' : 'Belum ada sesi memori tersimpan.'}</div>`
      return
    }
    
    gridEl.innerHTML = filtered.map(m => `
      <div class="card" style="padding:18px;display:flex;flex-direction:column;justify-content:space-between;gap:16px;">
        <div>
          <div style="display:flex;align-items:start;gap:12px;margin-bottom:10px;">
            <div style="width:38px;height:38px;background:rgba(79,216,196,0.1);color:var(--accent-cyan);border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
              ${icons.memory}
            </div>
            <div style="min-width:0;flex:1;">
              <h3 style="font-weight:600;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-primary);">${escapeHtml(m.name || 'Sesi Memori')}</h3>
              <p style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono);margin-top:2px;">ID: ${m.id.substring(0, 18)}...</p>
            </div>
          </div>
          <div style="display:flex;gap:12px;font-size:12px;color:var(--text-secondary);background:var(--bg-surface-raised);padding:8px 12px;border-radius:8px;border:1px solid var(--border);">
            <span>💬 ${m.messageCount || 0} pesan</span>
            <span>·</span>
            <span>💾 ${formatBytes(m.size)}</span>
          </div>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-secondary btn-sm inspect-btn" data-id="${m.id}" style="flex:1;">${icons.search} Inspeksi</button>
          <button class="btn btn-secondary btn-sm rename-btn" data-id="${m.id}" title="Edit Nama">${icons.edit}</button>
          <button class="btn btn-danger btn-sm delete-btn" data-id="${m.id}" title="Hapus Memori">${icons.trash}</button>
        </div>
      </div>
    `).join('')
    
    gridEl.querySelectorAll('.inspect-btn').forEach(btn => {
      btn.addEventListener('click', () => openInspectModal(btn.dataset.id))
    })

    gridEl.querySelectorAll('.rename-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        renameTarget = btn.dataset.id
        const mem = memories.find(m => m.id === renameTarget)
        el.querySelector('#rename-input').value = mem?.name || ''
        renameModal.style.display = 'flex'
      })
    })

    gridEl.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Hapus sesi memori ini secara permanen?')) return
        try {
          await memoryApi.delete(btn.dataset.id)
          showToast('Sesi memori berhasil dihapus')
          loadMemories()
        } catch (error) {
          showToast('Gagal menghapus memori', 'error')
        }
      })
    })
  }

  async function openInspectModal(id) {
    inspectTarget = id
    const mem = memories.find(m => m.id === id)
    el.querySelector('#inspect-title').textContent = mem?.name || 'Detail Memori'
    el.querySelector('#inspect-id').textContent = `ID: ${id}`
    el.querySelector('#inspect-content').innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);"><div class="loading-dots" style="justify-content:center;margin-bottom:12px;"><span></span><span></span><span></span></div>Mengambil data memori...</div>`
    inspectModal.style.display = 'flex'

    try {
      const res = await memoryApi.get(id)
      if (res.success && Array.isArray(res.history)) {
        renderInspectContent(res.history)
      } else {
        el.querySelector('#inspect-content').innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);">Riwayat memori kosong.</div>`
      }
    } catch (err) {
      el.querySelector('#inspect-content').innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);">Gagal mengambil riwayat memori.</div>`
    }
  }

  function renderInspectContent(history) {
    const contentEl = el.querySelector('#inspect-content')
    el.querySelector('#inspect-footer-info').textContent = `${history.length} percakapan tersimpan`

    if (history.length === 0) {
      contentEl.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);">Belum ada percakapan dalam memori ini.</div>`
      return
    }

    contentEl.innerHTML = history.map(item => {
      const isUser = item.role === 'user'
      return `
        <div style="margin-bottom:16px;display:flex;gap:12px;align-items:start;">
          <div style="width:32px;height:32px;border-radius:8px;background:${isUser ? 'rgba(79,216,196,0.15)' : 'rgba(163,113,247,0.15)'};color:${isUser ? 'var(--accent-cyan)' : 'var(--accent-purple)'};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            ${isUser ? icons.user : icons.bot}
          </div>
          <div style="flex:1;background:var(--bg-surface-raised);padding:12px 16px;border-radius:10px;border:1px solid var(--border);">
            <div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:4px;display:flex;justify-content:space-between;">
              <span>${isUser ? 'User' : 'EMORA Agent'}</span>
              <span>${item.timestamp ? formatTime(item.timestamp) : ''}</span>
            </div>
            <div style="font-size:13px;line-height:1.5;color:var(--text-primary);">
              ${isUser ? escapeHtml(item.content) : renderMarkdown(item.content)}
            </div>
          </div>
        </div>
      `
    }).join('')
  }
  
  // Event Listeners
  searchInput.addEventListener('input', renderMemories)
  el.querySelector('#refresh-memory-btn').addEventListener('click', loadMemories)
  
  el.querySelector('#create-memory-btn').addEventListener('click', async () => {
    const name = prompt('Masukkan nama sesi memori baru:')
    if (!name || !name.trim()) return
    try {
      await memoryApi.create(name.trim())
      showToast('Sesi memori baru berhasil dibuat')
      loadMemories()
    } catch (error) {
      showToast('Gagal membuat memori', 'error')
    }
  })
  
  el.querySelector('#rename-cancel').addEventListener('click', () => { renameModal.style.display = 'none'; renameTarget = null })
  
  el.querySelector('#rename-confirm').addEventListener('click', async () => {
    if (!renameTarget) return
    const newName = el.querySelector('#rename-input').value.trim()
    if (!newName) return
    try {
      await memoryApi.rename(renameTarget, newName)
      showToast('Nama memori berhasil diperbarui')
      renameModal.style.display = 'none'
      renameTarget = null
      loadMemories()
    } catch (error) {
      showToast('Gagal mengedit nama memori', 'error')
    }
  })

  el.querySelector('#inspect-close').addEventListener('click', () => { inspectModal.style.display = 'none'; inspectTarget = null })
  
  el.querySelector('#inspect-export-btn').addEventListener('click', async () => {
    if (!inspectTarget) return
    try {
      const res = await memoryApi.get(inspectTarget)
      const blob = new Blob([JSON.stringify(res, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `memory_${inspectTarget}.json`
      a.click()
      showToast('JSON memori berhasil diekspor')
    } catch (e) {
      showToast('Gagal mengekspor JSON memori', 'error')
    }
  })
  
  renameModal.addEventListener('click', (e) => { if (e.target === renameModal) { renameModal.style.display = 'none'; renameTarget = null } })
  inspectModal.addEventListener('click', (e) => { if (e.target === inspectModal) { inspectModal.style.display = 'none'; inspectTarget = null } })
  
  loadMemories()
  return el
}
