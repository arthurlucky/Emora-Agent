import { icons } from '../utils/icons.js'
import { cronApi } from '../api.js'
import { showToast, formatRelative } from '../utils/helpers.js'
import { escapeHtml } from '../dom.js'

export function SchedulerDashboard() {
  const el = document.createElement('div')
  el.className = 'fade-in'
  el.style.cssText = 'padding:24px;max-width:1100px;margin:0 auto;width:100%;'

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px;">
      <div>
        <h2 style="font-size:24px;font-weight:700;color:var(--text-primary);">Scheduler & Automations</h2>
        <p style="color:var(--text-muted);font-size:13px;margin-top:2px;">Manajemen task cron otomatis untuk background jobs (Telegram, WhatsApp, dsb).</p>
      </div>
      <button class="btn btn-primary" id="btn-add-job">${icons.plus} Tambah Job Baru</button>
    </div>

    <div class="card" style="padding:0;overflow:hidden;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;text-align:left;">
        <thead style="background:var(--bg-surface-raised);border-bottom:1px solid var(--border);">
          <tr>
            <th style="padding:12px 16px;color:var(--text-secondary);font-weight:600;">Status</th>
            <th style="padding:12px 16px;color:var(--text-secondary);font-weight:600;">Nama Job</th>
            <th style="padding:12px 16px;color:var(--text-secondary);font-weight:600;">Jadwal (Cron)</th>
            <th style="padding:12px 16px;color:var(--text-secondary);font-weight:600;">Platform</th>
            <th style="padding:12px 16px;color:var(--text-secondary);font-weight:600;">Run Count</th>
            <th style="padding:12px 16px;color:var(--text-secondary);font-weight:600;">Aksi</th>
          </tr>
        </thead>
        <tbody id="cron-list-body">
          <tr><td colspan="6" style="padding:30px;text-align:center;color:var(--text-muted);">Memuat data cron...</td></tr>
        </tbody>
      </table>
    </div>

    <!-- Modal Form Job -->
    <div id="cron-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);z-index:1000;align-items:center;justify-content:center;padding:20px;">
      <div class="card" style="width:100%;max-width:500px;background:var(--bg-base);border:1px solid var(--border-strong);">
        <h3 style="margin-bottom:16px;font-size:18px;">Tambah / Edit Cron Job</h3>
        
        <div style="margin-bottom:12px;">
          <label style="display:block;margin-bottom:6px;font-size:12px;color:var(--text-secondary);">Nama Job (Unik)</label>
          <input type="text" id="cron-name" class="chat-input-field" placeholder="Misal: cek-cuaca-pagi">
        </div>
        <div style="margin-bottom:12px;">
          <label style="display:block;margin-bottom:6px;font-size:12px;color:var(--text-secondary);">Jadwal (Cron format 5 stars, e.g. '0 7 * * *')</label>
          <input type="text" id="cron-schedule" class="chat-input-field" placeholder="* * * * *">
        </div>
        <div style="margin-bottom:12px;">
          <label style="display:block;margin-bottom:6px;font-size:12px;color:var(--text-secondary);">Platform (Gateway)</label>
          <select id="cron-platform" class="chat-input-field" style="padding:10px;">
            <option value="telegram">Telegram</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="discord">Discord</option>
            <option value="slack">Slack</option>
            <option value="matrix">Matrix</option>
          </select>
        </div>
        <div style="margin-bottom:12px;">
          <label style="display:block;margin-bottom:6px;font-size:12px;color:var(--text-secondary);">Chat ID Target</label>
          <input type="text" id="cron-chatid" class="chat-input-field" placeholder="Chat ID bot ke user/grup">
        </div>
        <div style="margin-bottom:16px;">
          <label style="display:block;margin-bottom:6px;font-size:12px;color:var(--text-secondary);">Prompt / Instruksi</label>
          <textarea id="cron-prompt" class="chat-input-field" placeholder="Cek cuaca di Jakarta hari ini" rows="3"></textarea>
        </div>

        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:20px;">
          <button class="btn btn-secondary" id="cron-cancel-btn">Batal</button>
          <button class="btn btn-primary" id="cron-save-btn">Simpan Job</button>
        </div>
      </div>
    </div>
  `

  const tbody = el.querySelector('#cron-list-body')
  const modal = el.querySelector('#cron-modal')
  let currentJobs = []

  async function loadJobs() {
    try {
      const res = await cronApi.list()
      if (res.success) {
        currentJobs = res.jobs || []
        renderJobs()
      }
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="6" style="padding:20px;text-align:center;color:var(--accent-red);">Gagal memuat: ${e.message}</td></tr>`
    }
  }

  function renderJobs() {
    if (currentJobs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="padding:30px;text-align:center;color:var(--text-muted);">Tidak ada job cron yang dijadwalkan.</td></tr>'
      return
    }

    tbody.innerHTML = currentJobs.map((job, idx) => {
      const statusBadge = job.enabled 
        ? `<span style="color:var(--accent-green);background:rgba(95,217,122,0.1);padding:4px 8px;border-radius:4px;font-size:11px;">Aktif</span>` 
        : `<span style="color:var(--text-muted);background:rgba(255,255,255,0.05);padding:4px 8px;border-radius:4px;font-size:11px;">Nonaktif</span>`
      
      const lastRunStr = job.lastRun ? `\n(Terakhir: ${formatRelative(job.lastRun)})` : ''

      return `
        <tr style="border-bottom:1px solid var(--border);">
          <td style="padding:12px 16px;">${statusBadge}</td>
          <td style="padding:12px 16px;font-weight:600;">${escapeHtml(job.name)}</td>
          <td style="padding:12px 16px;font-family:var(--font-mono);color:var(--accent-cyan);">${escapeHtml(job.schedule)}</td>
          <td style="padding:12px 16px;text-transform:capitalize;">${escapeHtml(job.platform)}</td>
          <td style="padding:12px 16px;color:var(--text-secondary);">${job.runCount || 0} ${lastRunStr}</td>
          <td style="padding:12px 16px;">
            <button class="btn btn-secondary btn-sm toggle-btn" data-idx="${idx}" style="margin-right:6px;">
              ${job.enabled ? 'Disable' : 'Enable'}
            </button>
            <button class="btn btn-secondary btn-sm delete-btn" data-idx="${idx}" style="color:var(--accent-red);">Hapus</button>
          </td>
        </tr>
      `
    }).join('')

    tbody.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const job = currentJobs[e.target.dataset.idx]
        job.enabled = !job.enabled
        try {
          await cronApi.save(job)
          loadJobs()
          showToast(`Job ${job.name} ${job.enabled ? 'diaktifkan' : 'dinonaktifkan'}`)
        } catch (err) { showToast('Gagal update job', 'error') }
      })
    })

    tbody.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const job = currentJobs[e.target.dataset.idx]
        if (!confirm(`Hapus job '${job.name}'?`)) return
        try {
          await cronApi.delete(job.name)
          loadJobs()
          showToast('Job dihapus')
        } catch (err) { showToast('Gagal hapus job', 'error') }
      })
    })
  }

  // Form Logic
  el.querySelector('#btn-add-job').addEventListener('click', () => {
    el.querySelector('#cron-name').value = ''
    el.querySelector('#cron-schedule').value = '0 7 * * *'
    el.querySelector('#cron-prompt').value = ''
    el.querySelector('#cron-chatid').value = ''
    modal.style.display = 'flex'
  })

  el.querySelector('#cron-cancel-btn').addEventListener('click', () => {
    modal.style.display = 'none'
  })

  el.querySelector('#cron-save-btn').addEventListener('click', async () => {
    const name = el.querySelector('#cron-name').value.trim()
    const schedule = el.querySelector('#cron-schedule').value.trim()
    const prompt = el.querySelector('#cron-prompt').value.trim()
    const platform = el.querySelector('#cron-platform').value
    const chatId = el.querySelector('#cron-chatid').value.trim()

    if (!name || !schedule || !prompt || !chatId) {
      return showToast('Isi semua field yang diperlukan', 'error')
    }

    try {
      el.querySelector('#cron-save-btn').textContent = 'Menyimpan...'
      await cronApi.save({ name, schedule, prompt, platform, chatId, enabled: true })
      modal.style.display = 'none'
      loadJobs()
      showToast('Job cron berhasil disimpan')
    } catch (e) {
      showToast(e.message, 'error')
    } finally {
      el.querySelector('#cron-save-btn').textContent = 'Simpan Job'
    }
  })

  loadJobs()
  return el
}
