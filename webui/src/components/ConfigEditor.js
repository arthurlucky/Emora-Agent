import { icons } from '../utils/icons.js'
import { configApi } from '../api.js'
import { showToast } from '../utils/helpers.js'

export function ConfigEditor() {
  const el = document.createElement('div')
  el.className = 'fade-in'
  el.style.padding = '24px'
  
  el.innerHTML = `
    <div style="max-width:1200px;">
      <h2 style="font-size:24px;font-weight:700;margin-bottom:8px;">Configuration</h2>
      <p style="color:var(--text-muted);margin-bottom:24px;">Edit AGENT.md and SOUL.md prompts</p>
      <div class="grid grid-2">
        <div class="card">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
            <div style="display:flex;align-items:center;gap:12px;">
              <div style="width:36px;height:36px;background:var(--bg-tertiary);border-radius:8px;display:flex;align-items:center;justify-content:center;">${icons.bot}</div>
              <div><h3 style="font-weight:600;">AGENT.md</h3><p style="font-size:12px;color:var(--text-muted);">Core agent behavior</p></div>
            </div>
            <span class="badge badge-success">Markdown</span>
          </div>
          <textarea class="input" id="agent-md" placeholder="# Agent Configuration..."></textarea>
        </div>
        <div class="card">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
            <div style="display:flex;align-items:center;gap:12px;">
              <div style="width:36px;height:36px;background:var(--bg-tertiary);border-radius:8px;display:flex;align-items:center;justify-content:center;">${icons.bot}</div>
              <div><h3 style="font-weight:600;">SOUL.md</h3><p style="font-size:12px;color:var(--text-muted);">Personality & soul</p></div>
            </div>
            <span class="badge badge-success">Markdown</span>
          </div>
          <textarea class="input" id="soul-md" placeholder="# Soul Configuration..."></textarea>
        </div>
      </div>
      <button class="btn btn-primary" id="save-config" style="margin-top:24px;width:100%;padding:14px;">${icons.save} Save Configuration</button>
      <div id="save-status" style="text-align:center;margin-top:12px;font-size:13px;color:var(--text-muted);opacity:0;transition:opacity 0.3s;"></div>
    </div>
  `
  
  const agentInput = el.querySelector('#agent-md')
  const soulInput = el.querySelector('#soul-md')
  const statusEl = el.querySelector('#save-status')
  
  async function loadConfig() {
    try {
      const response = await configApi.get()
      if (response.success) { agentInput.value = response.agent; soulInput.value = response.soul }
    } catch (error) { showToast('Failed to load configuration', 'error') }
  }
  
  el.querySelector('#save-config').addEventListener('click', async () => {
    try {
      await configApi.save(agentInput.value, soulInput.value)
      showToast('Configuration saved successfully')
      statusEl.textContent = 'Last saved: ' + new Date().toLocaleTimeString()
      statusEl.style.opacity = '1'
    } catch (error) { showToast('Failed to save configuration', 'error') }
  })
  
  loadConfig()
  return el
}
