import { icons } from '../utils/icons.js'
import { store } from '../state.js'
import { projectApi, connectPMStream } from '../api.js'
import { showToast } from '../utils/helpers.js'
import { escapeHtml } from '../dom.js'

export function ProjectDebugger() {
  const el = document.createElement('div')
  el.className = 'fade-in'
  el.style.cssText = 'padding:24px;height:100%;display:flex;flex-direction:column;'
  
  el.innerHTML = `
    <div style="margin-bottom:24px;">
      <h2 style="font-size:24px;font-weight:700;margin-bottom:8px;">Project Manager Debugger</h2>
      <p style="color:var(--text-muted);">Real-time project execution tracking</p>
    </div>
    <div class="grid grid-3" style="flex:1;min-height:0;">
      <div class="card" style="overflow-y:auto;">
        <h3 style="font-weight:600;margin-bottom:16px;">Projects</h3>
        <div id="projects-list" style="display:flex;flex-direction:column;gap:8px;"><div style="color:var(--text-muted);font-size:14px;">Loading...</div></div>
        <div style="margin-top:24px;padding-top:24px;border-top:1px solid var(--border);">
          <h4 style="font-size:14px;font-weight:600;margin-bottom:12px;">Create New Plan</h4>
          <input type="text" class="input" id="new-plan-name" placeholder="Plan name..." style="margin-bottom:12px;">
          <button class="btn btn-primary" id="create-plan-btn" style="width:100%;">${icons.plus} Create Plan</button>
        </div>
      </div>
      <div class="card" style="overflow-y:auto;grid-column:span 2;">
        <div id="plan-view"><div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);">Select a project to view plan</div></div>
      </div>
    </div>
    <div class="log-panel" style="margin-top:16px;flex-shrink:0;">
      <div class="log-header">
        <span class="log-title">Debug Stream</span>
        <div class="log-live"><div class="log-live-dot"></div>LIVE</div>
      </div>
      <div class="log-content" id="debug-logs"><div style="color:var(--text-muted);font-style:italic;">Waiting for logs...</div></div>
    </div>
  `
  
  const projectsList = el.querySelector('#projects-list')
  const planView = el.querySelector('#plan-view')
  const logsContainer = el.querySelector('#debug-logs')
  let currentPlan = null
  
  async function loadProjects() {
    try {
      const response = await projectApi.list()
      if (response.success) renderProjects(response.projects)
    } catch (error) { showToast('Failed to load projects', 'error') }
  }
  
  function renderProjects(projects) {
    if (!projects || projects.length === 0) {
      projectsList.innerHTML = `<div style="color:var(--text-muted);font-size:14px;padding:12px;">Belum ada rencana proyek.</div>`
      return
    }
    projectsList.innerHTML = projects.map(p => {
      const name = typeof p === 'string' ? p : (p.name || p.project_name || 'Project')
      return `
        <button class="project-btn" data-name="${escapeHtml(name)}" style="width:100%;text-align:left;padding:12px 16px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-primary);font-size:14px;cursor:pointer;transition:all 0.2s;font-family:inherit;display:flex;align-items:center;gap:10px;">
          ${icons.project} <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(name)}</span>
        </button>
      `
    }).join('')

    projectsList.querySelectorAll('.project-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        projectsList.querySelectorAll('.project-btn').forEach(b => b.style.borderColor = 'var(--border)')
        btn.style.borderColor = 'var(--accent-cyan)'
        loadPlan(btn.dataset.name)
      })
    })
  }
  
  async function loadPlan(name) {
    planView.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);"><div class="loading-dots" style="justify-content:center;margin-bottom:12px;"><span></span><span></span><span></span></div>Memuat rencana proyek '${escapeHtml(name)}'...</div>`
    try {
      const response = await projectApi.get(name)
      if (response.success) {
        currentPlan = response.project || response.plan
        renderPlan()
      } else {
        showToast('Gagal memuat rencana proyek', 'error')
      }
    } catch (error) { showToast('Gagal memuat rencana proyek', 'error') }
  }
  
  function renderPlan() {
    if (!currentPlan) return
    const completed = currentPlan.tasks.filter(t => t.status === 'DONE').length
    const total = currentPlan.tasks.length
    
    planView.innerHTML = `
      <div style="margin-bottom:20px;">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <h3 style="font-size:18px;font-weight:600;">${currentPlan.project_name}</h3>
          <span class="badge badge-success">${completed}/${total} Tasks</span>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:12px;">
        ${currentPlan.tasks.map(task => {
          const isReady = !task.depends_on || task.depends_on.length === 0 || task.depends_on.every(dep => currentPlan.tasks.find(t => t.id === dep)?.status === 'DONE')
          return `
            <div style="display:flex;align-items:center;gap:12px;padding:16px;border-radius:var(--radius-sm);border:1px solid var(--border);${task.status === 'DONE' ? 'background:var(--accent-light);border-color:var(--accent);' : isReady ? 'background:rgba(245,158,11,0.1);border-color:rgba(245,158,11,0.3);' : 'background:var(--bg-secondary);'}">
              <div style="width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;flex-shrink:0;${task.status === 'DONE' ? 'background:var(--accent);color:white;' : 'background:var(--bg-tertiary);color:var(--text-muted);'}">
                ${task.status === 'DONE' ? icons.check : task.id.replace('task_', '')}
              </div>
              <div style="flex:1;">
                <p style="font-weight:500;font-size:14px;">${task.description}</p>
                ${task.depends_on?.length ? `<p style="font-size:12px;color:var(--text-muted);margin-top:4px;">Depends on: ${task.depends_on.join(', ')}</p>` : ''}
              </div>
            </div>
          `
        }).join('')}
      </div>
    `
  }
  
  el.querySelector('#create-plan-btn').addEventListener('click', async () => {
    const name = el.querySelector('#new-plan-name').value.trim()
    if (!name) return
    const tasks = [
      { id: 'task_1', description: 'Initialize project setup', depends_on: [] },
      { id: 'task_2', description: 'Analyze requirements', depends_on: ['task_1'] },
      { id: 'task_3', description: 'Implement core features', depends_on: ['task_2'] },
      { id: 'task_4', description: 'Testing and validation', depends_on: ['task_3'] }
    ]
    try { await projectApi.create(name, tasks); showToast('Plan created'); el.querySelector('#new-plan-name').value = ''; loadProjects() }
    catch (error) { showToast('Failed to create plan', 'error') }
  })
  
  let disconnectStream = null
  function startStream() {
    disconnectStream = connectPMStream((data) => store.addDebugLog(data))
  }
  
  store.subscribe((key, value) => {
    if (key === 'debugLogs') {
      const logs = value.slice(0, 50)
      logsContainer.innerHTML = logs.map(log => `
        <div class="log-entry">
          <span class="log-time">${new Date(log.timestamp).toLocaleTimeString()}</span>
          <span class="log-level ${getLogLevel(log.type)}">[${log.type}]</span>
          <span class="log-message">${log.message}</span>
        </div>
      `).join('')
      logsContainer.scrollTop = 0
    }
  })
  
  function getLogLevel(type) {
    if (type === 'plan_created' || type === 'task_completed') return 'info'
    if (type === 'task_started') return 'warn'
    if (type === 'task_failed') return 'error'
    return 'debug'
  }
  
  loadProjects()
  startStream()
  
  el.addEventListener('remove', () => { if (disconnectStream) disconnectStream() })
  
  return el
}
