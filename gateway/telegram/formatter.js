/**
 * formatter.js
 * Utilitas untuk memformat teks agar kompatibel dengan Telegram Markdown.
 */

export function formatTelegramMessage(text) {
  if (!text) return text;
  let formatted = text;
  formatted = formatted.replace(/^### (.*$)/gim, "🔹 *$1*");
  formatted = formatted.replace(/^## (.*$)/gim, "🔸 *$1*");
  formatted = formatted.replace(/^# (.*$)/gim, "🎯 *$1*");
  formatted = formatted.replace(/\*\*(.*?)\*\*/g, "*$1*");
  formatted = formatted.replace(/^>\s?(.*$)/gim, "💬 _$1_");
  formatted = formatted.replace(/^- (.*$)/gim, "• $1");
  return formatted;
}
