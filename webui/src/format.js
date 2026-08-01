// webui/src/format.js
// Markdown renderer lengkap untuk chat bubble EMORA.
// Support: code block, inline code, bold, italic, headers,
// list items, blockquote, horizontal rule, link, dan line break.

export function renderMarkdown(text) {
  if (!text) return "";
  let html = String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Fenced code blocks ```lang\n...\n```
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
    const safeLang = lang || 'code';
    if (safeLang.toLowerCase() === 'mermaid') {
      const decodedCode = code.trim().replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      return `<div class="mermaid-container" style="background:var(--bg-surface-raised);padding:10px;border-radius:8px;margin:10px 0;text-align:center;">
        <div class="mermaid">${decodedCode}</div>
      </div>`;
    }
    if (safeLang.toLowerCase() === 'chart') {
      const decodedCode = code.trim().replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      return `<div class="chart-container" style="background:var(--bg-surface-raised);padding:10px;border-radius:8px;margin:10px 0;">
        <canvas class="emora-chart" data-chart='${decodedCode.replace(/'/g, "&#39;").replace(/"/g, "&quot;")}'></canvas>
      </div>`;
    }
    return `<div class="code-block-wrapper">
      <div class="code-header">
        <span class="code-lang">${safeLang}</span>
        <button class="copy-code-btn" onclick="const c=this.closest('.code-block-wrapper').querySelector('code').innerText;if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(c)}this.innerText='Copied!';">Copy</button>
      </div>
      <pre class="code-block"><code>${code.trim()}</code></pre>
    </div>`;
  });

  // Inline code `code`
  html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

  // Bold **text**
  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');

  // Italic *text* (not inside **)
  html = html.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3 class="md-h3">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 class="md-h2">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 class="md-h1">$1</h1>');

  // Horizontal rule ---
  html = html.replace(/^---+$/gm, '<hr class="md-hr">');

  // Blockquote > text
  html = html.replace(/^&gt;\s?(.+)$/gm, '<blockquote class="md-blockquote">$1</blockquote>');

  // Unordered list items: - item or * item
  // Group consecutive list items into a single <ul>
  html = html.replace(/((?:^[-*]\s+.+\n?)+)/gm, (block) => {
    const items = block.trim().split('\n').map(line => {
      const content = line.replace(/^[-*]\s+/, '');
      return `<li>${content}</li>`;
    }).join('');
    return `<ul class="md-list">${items}</ul>`;
  });

  // Numbered list items: 1. item
  html = html.replace(/((?:^\d+\.\s+.+\n?)+)/gm, (block) => {
    const items = block.trim().split('\n').map(line => {
      const content = line.replace(/^\d+\.\s+/, '');
      return `<li>${content}</li>`;
    }).join('');
    return `<ol class="md-list md-list-ol">${items}</ol>`;
  });

  // Links [text](url) - Check for audio files first
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, (match, text, url) => {
    const isAudio = /\.(mp3|wav|ogg|m4a)$/i.test(url);
    if (isAudio) {
      return `<div class="emora-audio-wrapper">
        <div style="font-size:12px;margin-bottom:4px;color:var(--text-secondary);">${text}</div>
        <audio controls class="emora-audio-player" src="${url}"></audio>
      </div>`;
    }
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="md-link">${text} ↗</a>`;
  });

  // Line breaks (only outside block elements)
  html = html.replace(/\n/g, '<br>');

  return html;
}

export function renderWidgets(container) {
  if (window.mermaid) {
    try {
      window.mermaid.init(undefined, container.querySelectorAll('.mermaid'));
    } catch (e) {
      console.error('Mermaid render error:', e);
    }
  }
  
  if (window.Chart) {
    container.querySelectorAll('.emora-chart').forEach(canvas => {
      if (canvas.chartInstance) return;
      try {
        const rawData = canvas.getAttribute('data-chart');
        if (!rawData) return;
        const data = JSON.parse(rawData.replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
        canvas.chartInstance = new window.Chart(canvas, data);
      } catch (e) {
        console.error('Chart.js render error:', e);
        canvas.insertAdjacentHTML('afterend', `<div style="color:red;font-size:12px;">Gagal memuat grafik: ${e.message}</div>`);
      }
    });
  }
}
