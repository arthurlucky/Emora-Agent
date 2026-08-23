import { icons } from '../utils/icons.js'
import { systemApi } from '../api.js'
import { showToast, formatBytes } from '../utils/helpers.js'

export function SystemMonitor() {
  const el = document.createElement('div')
  el.className = 'fade-in'
  el.style.cssText = 'padding:24px;max-width:1100px;margin:0 auto;width:100%;'

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px;">
      <div>
        <h2 style="font-size:24px;font-weight:700;color:var(--text-primary);">System Metrics & Resource Monitor</h2>
        <p style="color:var(--text-muted);font-size:13px;margin-top:2px;">Visualisasi grafik penggunaan CPU & Memori RAM perangkat Termux/OS real-time.</p>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <span class="pulse-dot"></span>
        <span style="font-size:12px;color:var(--text-secondary);font-family:var(--font-mono);">LIVE POLLING (2s)</span>
      </div>
    </div>

    <!-- Metrics Cards Grid -->
    <div class="grid grid-3" style="margin-bottom:24px;gap:16px;">
      <div class="card" style="padding:20px;display:flex;align-items:center;gap:16px;">
        <div style="width:48px;height:48px;border-radius:12px;background:rgba(79,216,196,0.12);color:var(--accent-cyan);display:flex;align-items:center;justify-content:center;">
          ${icons.zap}
        </div>
        <div>
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);font-weight:600;">System Load Avg</div>
          <div style="font-size:24px;font-weight:700;color:var(--text-primary);" id="metric-load">0.00</div>
          <div style="font-size:11px;color:var(--text-muted);" id="metric-cpus">0 CPU Cores</div>
        </div>
      </div>

      <div class="card" style="padding:20px;display:flex;align-items:center;gap:16px;">
        <div style="width:48px;height:48px;border-radius:12px;background:rgba(163,113,247,0.12);color:var(--accent-purple);display:flex;align-items:center;justify-content:center;">
          ${icons.save}
        </div>
        <div>
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);font-weight:600;">Penggunaan RAM</div>
          <div style="font-size:24px;font-weight:700;color:var(--text-primary);" id="metric-mem-percent">0%</div>
          <div style="font-size:11px;color:var(--text-muted);" id="metric-mem-sub">0 MB / 0 MB</div>
        </div>
      </div>

      <div class="card" style="padding:20px;display:flex;align-items:center;gap:16px;">
        <div style="width:48px;height:48px;border-radius:12px;background:rgba(95,217,122,0.12);color:var(--accent-green);display:flex;align-items:center;justify-content:center;">
          ${icons.refresh}
        </div>
        <div>
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);font-weight:600;">System Uptime</div>
          <div style="font-size:24px;font-weight:700;color:var(--text-primary);" id="metric-uptime">0j 0m</div>
          <div style="font-size:11px;color:var(--text-muted);" id="metric-platform">Platform: Termux</div>
        </div>
      </div>
    </div>

    <!-- Chart Panel -->
    <div class="card" style="padding:24px;margin-bottom:24px;">
      <h3 style="font-size:16px;font-weight:700;margin-bottom:16px;color:var(--text-primary);">Grafik Riwayat RAM (%)</h3>
      <div style="height:180px;position:relative;width:100%;" id="chart-container">
        <svg id="ram-chart" style="width:100%;height:100%;overflow:visible;"></svg>
      </div>
    </div>
  `

  const loadEl = el.querySelector('#metric-load')
  const cpusEl = el.querySelector('#metric-cpus')
  const memPercentEl = el.querySelector('#metric-mem-percent')
  const memSubEl = el.querySelector('#metric-mem-sub')
  const uptimeEl = el.querySelector('#metric-uptime')
  const platformEl = el.querySelector('#metric-platform')
  const svgEl = el.querySelector('#ram-chart')

  const historyPoints = []
  let timerId = null

  async function fetchMetrics() {
    try {
      const data = await systemApi.getMetrics()
      if (data.success) {
        loadEl.textContent = data.loadAvg
        cpusEl.textContent = `${data.cpusCount} CPU Cores (${data.arch})`
        memPercentEl.textContent = `${data.memory.percent}%`
        memSubEl.textContent = `${formatBytes(data.memory.used)} / ${formatBytes(data.memory.total)}`
        
        const hrs = Math.floor(data.uptime / 3600)
        const mins = Math.floor((data.uptime % 3600) / 60)
        uptimeEl.textContent = `${hrs}j ${mins}m`
        platformEl.textContent = `OS: ${data.platform}`

        historyPoints.push(data.memory.percent)
        if (historyPoints.length > 25) historyPoints.shift()
        renderSvgChart()
      }
    } catch (e) {}
  }

  function renderSvgChart() {
    if (historyPoints.length < 2) return
    const width = svgEl.clientWidth || 800
    const height = 180
    const maxVal = 100

    const points = historyPoints.map((val, idx) => {
      const x = (idx / (historyPoints.length - 1)) * width
      const y = height - (val / maxVal) * height
      return `${x},${y}`
    }).join(' ')

    svgEl.innerHTML = `
      <polyline fill="none" stroke="var(--accent-cyan)" stroke-width="3" points="${points}" />
      ${historyPoints.map((val, idx) => {
        const x = (idx / (historyPoints.length - 1)) * width
        const y = height - (val / maxVal) * height
        return `<circle cx="${x}" cy="${y}" r="4" fill="var(--accent-purple)" />`
      }).join('')}
    `
  }

  fetchMetrics()
  timerId = setInterval(fetchMetrics, 2000)

  el._cleanup = () => { if (timerId) clearInterval(timerId) }
  el.addEventListener('remove', () => { if (timerId) clearInterval(timerId) })
  return el
}
