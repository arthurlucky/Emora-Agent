/**
 * formatter.js
 * Utilitas untuk memformat teks agar kompatibel dengan Telegram Markdown.
 * 
 * ✅ FIX #5: Tambah support untuk code blocks, inline code, links, strikethrough
 */

export function formatTelegramMessage(text) {
  if (!text) return text;
  
  let formatted = text;

  // ==========================================
  // HEADINGS (Markdown ke Telegram Bold + Emoji)
  // ==========================================
  formatted = formatted.replace(/^### (.*$)/gim, "🔹 *$1*");
  formatted = formatted.replace(/^## (.*$)/gim, "🔸 *$1*");
  formatted = formatted.replace(/^# (.*$)/gim, "🎯 *$1*");

  // ==========================================
  // BOLD & ITALIC
  // ==========================================
  // **text** → *text* (Telegram bold)
  formatted = formatted.replace(/\*\*(.*?)\*\*/g, "*$1*");
  
  // _text_ atau *text* untuk italic → tetap _text_ (Telegram italic)
  // Tapi hati-hati: jangan timpa bold yang sudah diformat
  formatted = formatted.replace(/(?<!\*)_([^_]+)_(?!\*)/g, "_$1_");

  // ==========================================
  // CODE BLOCKS (``` ... ```)
  // Telegram Markdown support code blocks dengan ```language atau ```
  // ==========================================
  formatted = formatted.replace(/```([\s\S]*?)```/g, (match, code) => {
    // Extract language jika ada (```javascript ... ```)
    const lines = code.split('\n');
    const firstLine = lines[0];
    const isLanguageTag = /^[a-z]+$/.test(firstLine.trim());
    
    if (isLanguageTag && lines.length > 1) {
      // Ada language tag, remove dari code content
      const codeContent = lines.slice(1).join('\n').trim();
      return `\`\`\`${firstLine.trim()}\n${codeContent}\n\`\`\``;
    }
    
    // Tidak ada language tag, return apa adanya (atau tambah ``` jika perlu)
    return `\`\`\`\n${code.trim()}\n\`\`\``;
  });

  // ==========================================
  // INLINE CODE (`text`)
  // Telegram Markdown support `text` untuk monospace
  // ==========================================
  // Pastikan tidak conflict dengan code blocks
  formatted = formatted.replace(/(?<!`)`([^`]+)`(?!`)/g, "`$1`");

  // ==========================================
  // LINKS [text](url) → text (url)
  // Telegram tidak support markdown links, jadi ubah format
  // ==========================================
  formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");

  // ==========================================
  // STRIKETHROUGH (~~text~~ → ~text~)
  // Telegram Markdown v2 support strikethrough dengan ~text~
  // Tapi untuk compatibility, keep ~text~ atau remove entirely
  // ==========================================
  formatted = formatted.replace(/~~([^~]+)~~/g, "~$1~");

  // ==========================================
  // BLOCKQUOTE (> text)
  // ==========================================
  formatted = formatted.replace(/^>\s?(.*$)/gim, "💬 _$1_");

  // ==========================================
  // UNORDERED LIST (- item → • item)
  // ==========================================
  formatted = formatted.replace(/^[\s]*[-*+] (.*$)/gim, "• $1");

  // ==========================================
  // ORDERED LIST (1. item → 1. item) - keep as is
  // ==========================================
  // Telegram support ordered list, so no need to change

  // ==========================================
  // HORIZONTAL RULE (---, ***, ___)
  // ==========================================
  formatted = formatted.replace(/^[-*_]{3,}$/gm, "━━━━━━━━━━━━━━━━━━━━");

  // ==========================================
  // ESCAPE SPECIAL CHARACTERS UNTUK TELEGRAM
  // Note: Ini bersifat opsional, tergantung parse_mode yang digunakan
  // Untuk parse_mode=Markdown, beberapa char tidak perlu di-escape
  // ==========================================
  // Uncomment jika menggunakan MarkdownV2 (lebih strict):
  // formatted = formatted.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, "\\$1");

  return formatted;
}
