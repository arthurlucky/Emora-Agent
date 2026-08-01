/**
 * gateway/discord/presenter.js
 *
 * Helper presentasi untuk gateway Discord: format progress tool-call,
 * potong pesan panjang (limit 2000 karakter Discord), dan alur tombol
 * approve/deny buat approval gate.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

const DISCORD_LIMIT = 1900; // sisakan buffer dari limit keras 2000

export function splitMessage(text, limit = DISCORD_LIMIT) {
  if (text.length <= limit) return [text];

  const chunks = [];
  let remaining = text;
  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf("\n", limit);
    if (cut < limit * 0.5) cut = limit; // gak nemu newline yang bagus, potong paksa
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\n/, "");
  }
  if (remaining.length) chunks.push(remaining);
  return chunks;
}

export function formatToolLine(name, args, autoApproved) {
  const argsPreview = JSON.stringify(args || {});
  const short = argsPreview.length > 120 ? argsPreview.slice(0, 117) + "..." : argsPreview;
  const badge = autoApproved ? " _(auto-approved)_" : "";
  return `▸ \`${name}\`${badge} ${short}`;
}

export function buildApprovalRow(nonce) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`emora_approve:${nonce}`).setLabel("✔ Approve").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`emora_deny:${nonce}`).setLabel("✘ Deny").setStyle(ButtonStyle.Danger),
  );
}

export function approvalContent(toolName, args) {
  const argsJson = JSON.stringify(args || {}, null, 2);
  const trimmed = argsJson.length > 1200 ? argsJson.slice(0, 1200) + "\n…" : argsJson;
  return `⚠️ **EMORA minta izin jalankan tool:** \`${toolName}\`\n\`\`\`json\n${trimmed}\n\`\`\`\nApprove?`;
}

export function formatStatusText(status) {
  return `**${status.platform}** — ${status.running ? "🟢 aktif" : "🔴 mati"}\n${status.info || ""}`;
}
