import { icons } from '../utils/icons.js'
import { terminalApi } from '../api.js'
import { showToast } from '../utils/helpers.js'
import { escapeHtml } from '../dom.js'

export function TerminalConsole() {
  const el = document.createElement('div')
  el.className = 'fade-in'
  el.style.cssText = 'padding:24px;height:100%;display:flex;flex-direction:column;max-width:1100px;margin:0 auto;width:100%;'

  el.innerHTML = `
    <div style="margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
      <div>
        <h2 style="font-size:24px;font-weight:700;color:var(--text-primary);">Web Terminal Console</h2>
        <p style="color:var(--text-muted);font-size:13px;margin-top:2px;">Eksekusi perintah shell langsung di lingkungan Termux/OS.</p>
      </div>
      <button class="btn btn-secondary" id="clear-term-btn">${icons.trash} Bersihkan Konsol</button>
    </div>

    <!-- Terminal Box -->
    <div class="card" style="flex:1;min-height:400px;display:flex;flex-direction:column;background:#080b0e;border:1px solid var(--border-strong);overflow:hidden;box-shadow:0 12px 36px rgba(0,0,0,0.6);">
      <!-- Terminal Header -->
      <div style="background:#11161d;padding:10px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="width:12px;height:12px;border-radius:50%;background:#e5566b;display:inline-block;"></span>
          <span style="width:12px;height:12px;border-radius:50%;background:#e8b339;display:inline-block;"></span>
          <span style="width:12px;height:12px;border-radius:50%;background:#5fd97a;display:inline-block;"></span>
          <span style="font-size:12px;color:var(--text-secondary);font-family:var(--font-mono);margin-left:10px;">emora@termux:~</span>
        </div>
        <span style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono);">BASH CLI</span>
      </div>

      <!-- Terminal Output Screen -->
      <div id="term-output" style="flex:1;overflow-y:auto;padding:16px;font-family:var(--font-mono);font-size:13px;line-height:1.5;color:#e6edf3;white-space:pre-wrap;word-break:break-word;">
        <div style="color:var(--accent-cyan);">EMORA Interactive Terminal Console v1.0.0</div>
        <div style="color:var(--text-muted);margin-bottom:16px;">Ketik perintah bash seperti 'ls', 'pwd', 'uptime', 'node -v', 'git status', dsb.</div>
      </div>

      <!-- Terminal Input Line -->
      <div style="background:#0d1218;padding:12px 16px;border-top:1px solid var(--border);display:flex;align-items:center;gap:10px;">
        <span style="color:var(--accent-cyan);font-weight:700;font-family:var(--font-mono);">$</span>
        <input type="text" id="term-input" placeholder="Ketik perintah shell di sini..." style="flex:1;background:transparent;border:none;outline:none;color:var(--text-primary);font-family:var(--font-mono);font-size:14px;" autocomplete="off" spellcheck="false">
        <button class="btn btn-primary btn-sm" id="term-run-btn">${icons.send} Run</button>
      </div>
    </div>
  `

  const outputEl = el.querySelector('#term-output')
  const inputEl = el.querySelector('#term-input')
  const runBtn = el.querySelector('#term-run-btn')
  const clearBtn = el.querySelector('#clear-term-btn')

  async function executeCmd() {
    const cmd = inputEl.value.trim()
    if (!cmd) return

    appendLog(`$ ${cmd}`, 'cmd')
    inputEl.value = ''

    try {
      const res = await terminalApi.exec(cmd)
      if (res.stdout) appendLog(res.stdout, 'stdout')
      if (res.stderr) appendLog(res.stderr, 'stderr')
      if (res.exitCode !== 0) appendLog(`Exit Code: ${res.exitCode}`, 'error')
    } catch (err) {
      appendLog(`[ERROR] Gagal mengeksekusi perintah: ${err.message}`, 'error')
    }
  }

  function appendLog(text, type = 'stdout') {
    const line = document.createElement('div')
    line.style.margin = '4px 0'
    if (type === 'cmd') line.style.color = 'var(--accent-cyan)'
    else if (type === 'stderr' || type === 'error') line.style.color = '#e5566b'
    else line.style.color = '#e6edf3'
    line.textContent = text
    outputEl.appendChild(line)
    outputEl.scrollTop = outputEl.scrollHeight
  }

  runBtn.addEventListener('click', executeCmd)
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); executeCmd() }
  })

  clearBtn.addEventListener('click', () => {
    outputEl.innerHTML = `<div style="color:var(--accent-cyan);">EMORA Interactive Terminal Console v1.0.0</div><div style="color:var(--text-muted);margin-bottom:16px;">Ketik perintah bash seperti 'ls', 'pwd', 'uptime', 'node -v', 'git status', dsb.</div>`
  })

  return el
}
