/**
 * formatter.js
 * Konversi format Markdown ke format teks WhatsApp.
 *
 * WhatsApp mendukung:
 *  - *teks*   → bold
 *  - _teks_   → italic
 *  - ~teks~   → strikethrough
 *  - `teks`   → monospace (inline)
 *  - ```teks``` → monospace (block)
 */

export function formatWhatsAppMessage(text) {
  if (!text) return text;
  let formatted = text;

  // Heading → bold dengan emoji
  formatted = formatted.replace(/^### (.*$)/gim, "🔹 *$1*");
  formatted = formatted.replace(/^## (.*$)/gim, "🔸 *$1*");
  formatted = formatted.replace(/^# (.*$)/gim, "🎯 *$1*");

  // **bold** → *bold*
  formatted = formatted.replace(/\*\*(.*?)\*\*/g, "*$1*");

  // Blockquote
  formatted = formatted.replace(/^>\s?(.*$)/gim, "💬 _$1_");

  // List
  formatted = formatted.replace(/^- (.*$)/gim, "• $1");

  return formatted;
}
