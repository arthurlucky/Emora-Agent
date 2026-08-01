import { icons } from '../utils/icons.js'
import { libraryApi } from '../api.js'
import { showToast, formatBytes, copyToClipboard } from '../utils/helpers.js'
import { renderMarkdown } from '../format.js'
import { escapeHtml } from '../dom.js'

export function LibraryBrowser() {
  const el = document.createElement('div')
  el.className = 'fade-in'
  el.style.padding = '24px'

  el.innerHTML = `
    <div style="max-width:1100px;margin:0 auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px;">
        <div>
          <h2 style="font-size:24px;font-weight:700;color:var(--text-primary);">Knowledge Library Browser</h2>
          <p style="color:var(--text-muted);font-size:13px;margin-top:2px;">Basis pengetahuan faktual kurasi offline EMORA berdasarkan topik dan subtopik.</p>
        </div>
        <button class="btn btn-secondary" id="refresh-lib-btn">${icons.refresh} Refresh Library</button>
      </div>

      <!-- Content Layout -->
      <div style="display:grid;grid-template-columns:300px 1fr;gap:20px;" id="lib-layout">
        <!-- Sidebar Topics -->
        <div class="card" style="padding:16px;height:calc(100vh - 180px);overflow-y:auto;">
          <h3 style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);margin-bottom:12px;">Kategori Topik</h3>
          <div id="topics-list" style="display:flex;flex-direction:column;gap:8px;">
            <div style="color:var(--text-muted);font-size:13px;">Memuat topik...</div>
          </div>
        </div>

        <!-- Documents View -->
        <div class="card" style="padding:20px;height:calc(100vh - 180px);display:flex;flex-direction:column;overflow:hidden;">
          <div style="padding-bottom:14px;border-bottom:1px solid var(--border);margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;" id="topic-header">
            <div>
              <h3 style="font-size:16px;font-weight:700;color:var(--text-primary);" id="selected-topic-title">Pilih Topik</h3>
              <p style="font-size:12px;color:var(--text-muted);" id="selected-topic-sub">Pilih salah satu subtopik/file di sebelah kiri</p>
            </div>
          </div>
          <div style="flex:1;overflow-y:auto;" id="document-viewer">
            <div style="text-align:center;padding:60px;color:var(--text-muted);">
              ${icons.globe}
              <p style="margin-top:12px;font-size:14px;">Silakan pilih dokumen dari panel sebelah kiri untuk membaca isinya.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  `

  const topicsListEl = el.querySelector('#topics-list')
  const docViewerEl = el.querySelector('#document-viewer')
  const selectedTitleEl = el.querySelector('#selected-topic-title')
  const selectedSubEl = el.querySelector('#selected-topic-sub')

  let libraryData = []

  async function loadLibrary() {
    topicsListEl.innerHTML = `<div style="color:var(--text-muted);font-size:13px;">Memuat topik...</div>`
    try {
      const res = await libraryApi.list()
      if (res.success) {
        libraryData = res.topics || []
        renderTopics()
      }
    } catch (err) {
      showToast('Gagal memuat perpustakaan pengetahuan', 'error')
    }
  }

  function renderTopics() {
    if (libraryData.length === 0) {
      topicsListEl.innerHTML = `<div style="color:var(--text-muted);font-size:13px;padding:12px;">Library belum memiliki dokumen.</div>`
      return
    }

    topicsListEl.innerHTML = libraryData.map(topic => `
      <div class="topic-group" style="margin-bottom:8px;">
        <div style="font-size:13px;font-weight:700;color:var(--accent-cyan);padding:6px 8px;display:flex;align-items:center;gap:6px;">
          ${icons.file} ${escapeHtml(topic.name)}
        </div>
        <div style="padding-left:12px;display:flex;flex-direction:column;gap:4px;margin-top:4px;">
          ${topic.subtopics.map(sub => `
            <div style="font-size:12px;font-weight:600;color:var(--text-secondary);padding:4px 6px;">${escapeHtml(sub.name)}</div>
            ${sub.files.map(f => `
              <button class="nav-item file-item-btn" data-path="${f.relPath}" style="padding:6px 10px;font-size:12px;text-align:left;border-radius:6px;width:100%;display:flex;align-items:center;justify-content:space-between;">
                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(f.name)}</span>
                <span style="font-size:10px;color:var(--text-muted);font-family:var(--font-mono);">${formatBytes(f.size)}</span>
              </button>
            `).join('')}
          `).join('')}
        </div>
      </div>
    `).join('')

    topicsListEl.querySelectorAll('.file-item-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        topicsListEl.querySelectorAll('.file-item-btn').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        openFile(btn.dataset.path)
      })
    })
  }

  async function openFile(relPath) {
    selectedTitleEl.textContent = relPath.split('/').pop()
    selectedSubEl.textContent = `Jalur: ${relPath}`
    docViewerEl.innerHTML = `<div style="text-align:center;padding:50px;color:var(--text-muted);"><div class="loading-dots" style="justify-content:center;margin-bottom:12px;"><span></span><span></span><span></span></div>Membaca file...</div>`

    try {
      const res = await libraryApi.readFile(relPath)
      if (res.success && res.content) {
        docViewerEl.innerHTML = `
          <div style="display:flex;justify-content:flex-end;margin-bottom:12px;">
            <button class="btn btn-secondary btn-sm" id="copy-doc-btn">${icons.copy} Copy Isi Dokumentasi</button>
          </div>
          <div style="font-size:13.5px;line-height:1.6;color:var(--text-primary);white-space:pre-wrap;font-family:var(--font-mono);background:var(--bg-surface-raised);padding:16px;border-radius:10px;border:1px solid var(--border);">
            ${escapeHtml(res.content)}
          </div>
        `
        docViewerEl.querySelector('#copy-doc-btn').addEventListener('click', () => {
          copyToClipboard(res.content)
          showToast('Isi dokumen berhasil disalin')
        })
      }
    } catch (err) {
      docViewerEl.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);">Gagal membaca isi file.</div>`
    }
  }

  el.querySelector('#refresh-lib-btn').addEventListener('click', loadLibrary)

  loadLibrary()
  return el
}
