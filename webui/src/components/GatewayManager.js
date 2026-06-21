import { icons } from '../utils/icons.js'
import { gatewayApi } from '../api.js'
import { showToast } from '../utils/helpers.js'

export function GatewayManager() {
  const el = document.createElement('div')
  el.className = 'fade-in'
  el.style.padding = '24px'
  
  el.innerHTML = `
    <div style="max-width:800px;">
      <h2 style="font-size:24px;font-weight:700;margin-bottom:8px;">Gateway Manager</h2>
      <p style="color:var(--text-muted);margin-bottom:24px;">Enable and configure communication gateways</p>
      <div id="gateway-list" style="display:flex;flex-direction:column;gap:16px;">
        <div style="text-align:center;padding:40px;color:var(--text-muted);">Loading gateways...</div>
      </div>
      <button class="btn btn-primary" id="save-gateways" style="margin-top:24px;width:100%;">${icons.save} Save Configuration</button>
    </div>
  `
  
  const listEl = el.querySelector('#gateway-list')
  let gatewayData = []
  
  async function loadGateways() {
    try {
      const response = await gatewayApi.list()
      if (response.success) { gatewayData = response.gateways; renderGateways() }
    } catch (error) { showToast('Failed to load gateways', 'error') }
  }
  
  function renderGateways() {
    listEl.innerHTML = gatewayData.map((gw, index) => `
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:${gw.enabled ? '16px' : '0'};">
          <div style="display:flex;align-items:center;gap:16px;">
            <div style="width:48px;height:48px;background:var(--bg-tertiary);border-radius:12px;display:flex;align-items:center;justify-content:center;">
              ${gw.id === 'telegram' || gw.id === 'whatsapp' ? icons.chat : icons.gateway}
            </div>
            <div>
              <h3 style="font-weight:600;">${gw.name}</h3>
              <p style="font-size:12px;color:var(--text-muted);text-transform:uppercase;">${gw.id}</p>
            </div>
          </div>
          <label class="toggle">
            <input type="checkbox" ${gw.enabled ? 'checked' : ''} data-index="${index}">
            <span class="toggle-slider"></span>
          </label>
        </div>
        ${gw.enabled ? `<div style="border-top:1px solid var(--border);padding-top:16px;">
          ${Object.entries(gw.config).map(([key, value]) => `
            <div style="display:grid;grid-template-columns:120px 1fr;gap:12px;align-items:center;margin-bottom:12px;">
              <label style="font-size:13px;color:var(--text-secondary);text-transform:capitalize;">${key.replace(/([A-Z])/g, ' $1').trim()}</label>
              <input type="text" class="input" value="${value}" data-gw="${index}" data-key="${key}" placeholder="Enter ${key}...">
            </div>
          `).join('')}
        </div>` : ''}
      </div>
    `).join('')
    
    listEl.querySelectorAll('.toggle input').forEach(toggle => {
      toggle.addEventListener('change', (e) => {
        gatewayData[parseInt(e.target.dataset.index)].enabled = e.target.checked
        renderGateways()
      })
    })
    
    listEl.querySelectorAll('input[data-gw]').forEach(input => {
      input.addEventListener('input', (e) => {
        gatewayData[parseInt(e.target.dataset.gw)].config[e.target.dataset.key] = e.target.value
      })
    })
  }
  
  el.querySelector('#save-gateways').addEventListener('click', async () => {
    try { await gatewayApi.update(gatewayData); showToast('Gateway configuration saved') }
    catch (error) { showToast('Failed to save gateways', 'error') }
  })
  
  loadGateways()
  return el
}
