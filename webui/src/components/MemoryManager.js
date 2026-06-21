import { icons } from '../utils/icons.js'
import { memoryApi } from '../api.js'
import { showToast, formatBytes } from '../utils/helpers.js'

export function MemoryManager() {
  const el = document.createElement('div')
  el.className = 'fade-in'
  el.style.padding = '24px'
  
  el.innerHTML = `
    <div style="max-width:1000px;">
      <h2 style="font-size:24px;font-weight:700;margin-bottom:8px;">Memory Manager</h2>
      <p style="color:var(--text-muted);margin-bottom:24px;">Manage conversation memories and sessions</p>
      <div style="display:flex;gap:12px;margin-bottom:24px;">
        <input type="text" class="input" id="new-memory-name" placeholder="New memory name..." style="flex:1;">
        <button class="btn btn-primary" id="create-memory-btn">${icons.plus} Create</button>
      </div>
      <div id="memory-grid" class="grid grid-3">
        <div style="text-align:center;padding:40px;color:var(--text-muted);grid-column:1 / -1;">Loading memories...</div>
      </div>
    </div>
    <div id="rename-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:200;align-items:center;justify-content:center;">
      <div class="card" style="width:400px;">
        <h3 style="font-weight:600;margin-bottom:16px;">Rename Memory</h3>
        <input type="text" class="input" id="rename-input" placeholder="New name..." style="margin-bottom:16px;">
        <div style="display:flex;gap:12px;">
          <button class="btn btn-secondary" style="flex:1;" id="rename-cancel">Cancel</button>
          <button class="btn btn-primary" style="flex:1;" id="rename-confirm">Save</button>
        </div>
      </div>
    </div>
  `
  
  const gridEl = el.querySelector('#memory-grid')
  const modal = el.querySelector('#rename-modal')
  let memories = []
  let renameTarget = null
  
  async function loadMemories() {
    try {
      const response = await memoryApi.list()
      if (response.success) { memories = response.memories; renderMemories() }
    } catch (error) { showToast('Failed to load memories', 'error') }
  }
  
  function renderMemories() {
    if (memories.length === 0) {
      gridEl.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);grid-column:1 / -1;">No memories found</div>`
      return
    }
    
    gridEl.innerHTML = memories.map(m => `
      <div class="card" style="position:relative;">
        <div style="display:flex;align-items:start;gap:12px;">
          <div style="width:40px;height:40px;background:var(--bg-tertiary);border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${icons.memory}</div>
          <div style="min-width:0;">
            <h3 style="font-weight:600;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${m.name}</h3>
            <p style="font-size:12px;color:var(--text-muted);margin-top:4px;">${formatBytes(m.size)}</p>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:16px;opacity:0;transition:opacity 0.2s;" class="memory-actions">
          <button class="btn btn-secondary btn-sm rename-btn" data-id="${m.id}" style="flex:1;">${icons.edit} Rename</button>
          <button class="btn btn-danger btn-sm delete-btn" data-id="${m.id}" style="flex:1;">${icons.trash} Delete</button>
        </div>
      </div>
    `).join('')
    
    gridEl.querySelectorAll('.card').forEach(card => {
      card.addEventListener('mouseenter', () => card.querySelector('.memory-actions').style.opacity = '1')
      card.addEventListener('mouseleave', () => card.querySelector('.memory-actions').style.opacity = '0')
    })
    
    gridEl.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this memory?')) return
        try { await memoryApi.delete(btn.dataset.id); showToast('Memory deleted'); loadMemories() }
        catch (error) { showToast('Failed to delete memory', 'error') }
      })
    })
    
    gridEl.querySelectorAll('.rename-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        renameTarget = btn.dataset.id
        const memory = memories.find(m => m.id === renameTarget)
        el.querySelector('#rename-input').value = memory.name
        modal.style.display = 'flex'
      })
    })
  }
  
  el.querySelector('#create-memory-btn').addEventListener('click', async () => {
    const name = el.querySelector('#new-memory-name').value.trim()
    if (!name) return
    try { await memoryApi.create(name); showToast('Memory created'); el.querySelector('#new-memory-name').value = ''; loadMemories() }
    catch (error) { showToast('Failed to create memory', 'error') }
  })
  
  el.querySelector('#rename-cancel').addEventListener('click', () => { modal.style.display = 'none'; renameTarget = null })
  
  el.querySelector('#rename-confirm').addEventListener('click', async () => {
    if (!renameTarget) return
    const newName = el.querySelector('#rename-input').value.trim()
    if (!newName) return
    try { await memoryApi.rename(renameTarget, newName); showToast('Memory renamed'); modal.style.display = 'none'; renameTarget = null; loadMemories() }
    catch (error) { showToast('Failed to rename memory', 'error') }
  })
  
  modal.addEventListener('click', (e) => { if (e.target === modal) { modal.style.display = 'none'; renameTarget = null } })
  
  loadMemories()
  return el
}
