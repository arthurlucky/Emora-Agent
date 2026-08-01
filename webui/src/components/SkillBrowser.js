import { icons } from '../utils/icons.js'
import { skillApi } from '../api.js'
import { showToast } from '../utils/helpers.js'
import { renderMarkdown } from '../format.js'
import { escapeHtml } from '../dom.js'

export function SkillBrowser() {
  const el = document.createElement('div')
  el.className = 'fade-in'
  el.style.padding = '24px'
  
  el.innerHTML = `
    <div style="max-width:1100px;margin:0 auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px;">
        <div>
          <h2 style="font-size:24px;font-weight:700;color:var(--text-primary);">Skill Browser & Catalog</h2>
          <p style="color:var(--text-muted);font-size:13px;margin-top:2px;">Jelajahi, aktifkan/nonaktifkan, dan periksa panduan alur kerja skill EMORA.</p>
        </div>
        <button class="btn btn-secondary" id="refresh-skills-btn">${icons.refresh} Refresh Skills</button>
      </div>

      <!-- Search Bar -->
      <div style="margin-bottom:20px;position:relative;">
        <input type="text" class="input" id="search-skill-input" placeholder="Cari skill berdasarkan nama atau deskripsi..." style="padding-left:38px;">
        <div style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--text-muted);">${icons.search}</div>
      </div>

      <!-- Skill Grid -->
      <div id="skills-grid" class="grid grid-3" style="gap:16px;">
        <div style="text-align:center;padding:40px;color:var(--text-muted);grid-column:1 / -1;">
          <div class="loading-dots" style="justify-content:center;margin-bottom:12px;"><span></span><span></span><span></span></div>
          Memuat katalog skill...
        </div>
      </div>
    </div>

    <!-- Skill Content Modal -->
    <div id="skill-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(6px);z-index:300;align-items:center;justify-content:center;padding:20px;">
      <div class="card" style="width:100%;max-width:850px;height:85vh;display:flex;flex-direction:column;padding:0;overflow:hidden;border:1px solid var(--border-strong);">
        <div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;background:var(--bg-surface-raised);">
          <div>
            <h3 style="font-weight:700;font-size:16px;color:var(--accent-cyan);" id="skill-modal-title">Skill Detail</h3>
            <span style="font-size:11px;color:var(--text-muted);" id="skill-modal-sub"></span>
          </div>
          <button class="btn-icon" id="skill-modal-close">${icons.close}</button>
        </div>
        <div style="flex:1;overflow-y:auto;padding:24px;background:var(--bg-surface);" id="skill-modal-body">
          <div style="text-align:center;padding:40px;color:var(--text-muted);">Memuat isi skill...</div>
        </div>
      </div>
    </div>
  `

  const gridEl = el.querySelector('#skills-grid')
  const searchInput = el.querySelector('#search-skill-input')
  const modal = el.querySelector('#skill-modal')

  let skills = []

  async function loadSkills() {
    gridEl.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);grid-column:1 / -1;"><div class="loading-dots" style="justify-content:center;margin-bottom:12px;"><span></span><span></span><span></span></div>Memuat katalog skill...</div>`
    try {
      const res = await skillApi.list()
      if (res.success) {
        skills = res.skills || []
        renderSkills()
      }
    } catch (err) {
      showToast('Gagal memuat skill', 'error')
      gridEl.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);grid-column:1 / -1;">Gagal memuat skill.</div>`
    }
  }

  function renderSkills() {
    const query = searchInput.value.toLowerCase().trim()
    const filtered = skills.filter(s =>
      s.name.toLowerCase().includes(query) || (s.description || '').toLowerCase().includes(query)
    )

    if (filtered.length === 0) {
      gridEl.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);grid-column:1 / -1;">${query ? 'Tidak ada skill yang cocok dengan pencarian.' : 'Belum ada skill yang tersimpan.'}</div>`
      return
    }

    gridEl.innerHTML = filtered.map(s => `
      <div class="card" style="padding:18px;display:flex;flex-direction:column;justify-content:space-between;gap:14px;border:1px solid ${s.enabled ? 'var(--border)' : 'rgba(255,255,255,0.06)'};opacity:${s.enabled ? 1 : 0.65};">
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
            <div style="display:flex;align-items:center;gap:10px;">
              <div style="width:36px;height:36px;border-radius:10px;background:rgba(163,113,247,0.12);color:var(--accent-purple);display:flex;align-items:center;justify-content:center;">
                ${icons.puzzle}
              </div>
              <h3 style="font-weight:600;font-size:14px;color:var(--text-primary);">${escapeHtml(s.name)}</h3>
            </div>
            <label class="toggle">
              <input type="checkbox" ${s.enabled ? 'checked' : ''} data-name="${s.name}">
              <span class="toggle-slider"></span>
            </label>
          </div>
          <p style="font-size:12.5px;color:var(--text-secondary);line-height:1.5;margin:0;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;">
            ${escapeHtml(s.description || 'Tidak ada deskripsi.')}
          </p>
        </div>
        <button class="btn btn-secondary btn-sm read-skill-btn" data-name="${s.name}">${icons.file} Baca Dokumentasi</button>
      </div>
    `).join('')

    gridEl.querySelectorAll('.toggle input').forEach(toggle => {
      toggle.addEventListener('change', async (e) => {
        const skillName = e.target.dataset.name
        const enabled = e.target.checked
        try {
          await skillApi.toggle(skillName, enabled)
          showToast(`Skill '${skillName}' ${enabled ? 'diaktifkan' : 'dinonaktifkan'}`)
          loadSkills()
        } catch (err) {
          showToast('Gagal mengubah status skill', 'error')
          e.target.checked = !enabled
        }
      })
    })

    gridEl.querySelectorAll('.read-skill-btn').forEach(btn => {
      btn.addEventListener('click', () => openSkillModal(btn.dataset.name))
    })
  }

  async function openSkillModal(name) {
    el.querySelector('#skill-modal-title').textContent = `Skill: ${name}`
    el.querySelector('#skill-modal-sub').textContent = 'Panduan & Prosedur Workflow'
    el.querySelector('#skill-modal-body').innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);"><div class="loading-dots" style="justify-content:center;margin-bottom:12px;"><span></span><span></span><span></span></div>Mengambil instruksi skill...</div>`
    modal.style.display = 'flex'

    try {
      const res = await skillApi.get(name)
      if (res.success && res.content) {
        el.querySelector('#skill-modal-body').innerHTML = renderMarkdown(res.content)
      } else {
        el.querySelector('#skill-modal-body').innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);">Skill ini belum memiliki dokumentasi SKILL.md.</div>`
      }
    } catch (err) {
      el.querySelector('#skill-modal-body').innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);">Gagal memuat isi skill.</div>`
    }
  }

  searchInput.addEventListener('input', renderSkills)
  el.querySelector('#refresh-skills-btn').addEventListener('click', loadSkills)
  el.querySelector('#skill-modal-close').addEventListener('click', () => modal.style.display = 'none')
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none' })

  loadSkills()
  return el
}
