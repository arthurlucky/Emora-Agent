/**
 * tui/screen.js
 *
 * Compose seluruh frame terminal jadi satu string per-render (mirip
 * lipgloss.JoinVertical di versi Go). Ink cuma dipakai buat lifecycle +
 * input capture; semua tata letak & warna dihitung di sini sebagai string
 * biasa, konsisten dengan gaya chalk yang sudah dipakai di main.js lama &
 * cli/select.js.
 */
import { C, ICONS, hr, truncate, padVisible, stripAnsi, spinnerFrame, wrapPlain } from "./styles.js";
import { renderMarkdown } from "./markdown.js";

const MIN_WIDTH = 40;
const MIN_HEIGHT = 12;

function clampSize(state) {
  const columns = Math.max(MIN_WIDTH, state.terminalSize.columns || 80);
  const rows = Math.max(MIN_HEIGHT, state.terminalSize.rows || 24);
  return { columns, rows };
}

// ── Header ───────────────────────────────────────────────────────────────────
function renderHeader(state, width) {
  const brand = C.primaryBold(" EMORA ");
  const brandLen = 7;
  const rightBudget = Math.max(8, Math.floor(width * 0.35));
  const providerText = `${state.provider?.name || "-"}/${state.provider?.model || "-"}`;
  const right = C.faint(truncate(providerText, rightBudget));
  const rightLen = stripAnsi(right).length;

  const leftBudget = Math.max(6, width - brandLen - 2 - rightLen - 1);
  const title = C.text(truncate(state.sessionTitle || "Sesi baru", leftBudget));
  const left = brand + C.faint("· ") + title;

  const leftLen = stripAnsi(left).length;
  const gap = Math.max(1, width - leftLen - rightLen);

  return [left + " ".repeat(gap) + right, hr(width)];
}

// ── Status bar ───────────────────────────────────────────────────────────────
function renderStatusBar(state, width) {
  const modeTag = state.mode === "safe" ? C.yellow("safe") : C.green("autonomous");
  const agentTag = C.purple(state.agentMode);
  const streamTag = state.streamEnabled ? C.green("stream:on") : C.faint("stream:off");

  const segments = [
    `${C.faint("mode:")}${modeTag}`,
    `${C.faint("agent:")}${agentTag}`,
    streamTag,
  ];

  let statusWord = "";
  if (state.status === "thinking") statusWord = C.yellow(`${spinnerFrame(state.spinnerTick)} berpikir…`);
  else if (state.status === "approval_pending") statusWord = C.red("menunggu approval");
  else if (state.status === "ask_user_pending") statusWord = C.purple("menunggu jawaban");
  const right = statusWord || C.faint("/help bantuan · Ctrl+C keluar");
  const rightLen = stripAnsi(right).length;

  // Buang segmen kiri satu-satu dari yang paling gak krusial kalau kesempitan,
  // daripada motong string yang udah ada kode ANSI-nya (bisa korup).
  while (segments.length > 1 && (stripAnsi(segments.join("  ")).length + rightLen + 3) > width) {
    segments.pop();
  }
  const left = segments.join("  ");
  const leftLen = stripAnsi(left).length;
  const gap = Math.max(1, width - leftLen - rightLen);

  if (leftLen + rightLen + 1 > width) return left; // ekstrem sempit, cukup tampilkan kiri
  return left + " ".repeat(gap) + right;
}

// ── Input box ────────────────────────────────────────────────────────────────
function renderInputLine(state, width) {
  const availW = Math.max(10, width - 2); // sisakan ruang buat "❯ "
  const { input, cursorPos } = state;

  let windowStart = 0;
  if (input.length > availW) {
    windowStart = Math.max(0, Math.min(cursorPos - Math.floor(availW / 2), input.length - availW));
  }
  const windowEnd = Math.min(input.length, windowStart + availW);
  const visible = input.slice(windowStart, windowEnd);
  const relCursor = cursorPos - windowStart;

  let styled;
  if (relCursor >= visible.length) {
    styled = visible + C.inverse(" ");
  } else if (relCursor < 0) {
    styled = C.inverse(" ") + visible;
  } else {
    styled = visible.slice(0, relCursor) + C.inverse(visible[relCursor] || " ") + visible.slice(relCursor + 1);
  }

  const leftMark = windowStart > 0 ? C.faint("…") : " ";
  const rightMark = windowEnd < input.length ? C.faint("…") : "";

  const prefix = state.status === "idle" ? C.primaryBold("❯ ") : C.faint("❯ ");
  return prefix + leftMark + styled + rightMark;
}

function renderSuggestions(state, width) {
  if (!state.suggestions?.length) return [];
  const out = [];
  const maxShown = 6;
  const list = state.suggestions.slice(0, maxShown);
  for (let i = 0; i < list.length; i++) {
    const isSel = i === state.suggestionIndex;
    const text = truncate(list[i], width - 4);
    out.push((isSel ? C.primary("  ❯ ") : "    ") + (isSel ? C.primaryBold(text) : C.dim(text)));
  }
  if (state.suggestions.length > maxShown) {
    out.push(C.faint(`    …dan ${state.suggestions.length - maxShown} lainnya`));
  }
  return out;
}

// ── Chat transcript ──────────────────────────────────────────────────────────
function renderMessageBlock(msg, width) {
  const lines = [];
  if (msg.role === "user") {
    lines.push(C.primaryBold(`${ICONS.user} Kamu`));
    for (const l of wrapPlain(msg.content, width - 2)) lines.push("  " + C.text(l));
  } else {
    lines.push(C.purple(`${ICONS.agent} Emora`));
    for (const l of renderMarkdown(msg.content, width - 2)) lines.push("  " + l);
  }
  lines.push("");
  return lines;
}

function renderChatBody(state, width, height) {
  const lines = [];
  for (const msg of state.messages) lines.push(...renderMessageBlock(msg, width));

  if (state.status === "thinking") {
    lines.push(C.purple(`${ICONS.agent} Emora`));
    lines.push("  " + C.yellow(`${spinnerFrame(state.spinnerTick)} sedang berpikir...`));
    for (const l of state.progressLines.slice(-8)) lines.push("  " + C.faint(l));
    lines.push("");
  }

  if (!lines.length) {
    for (const l of wrapPlain("Belum ada percakapan. Ketik pesan atau '/help' buat lihat perintah.", width - 2)) {
      lines.push(C.faint("  " + l));
    }
  }

  // Clip ke tinggi yang tersedia, dari bawah (paling baru), digeser scrollOffset.
  const total = lines.length;
  const endIdx = Math.max(0, total - state.scrollOffset);
  const startIdx = Math.max(0, endIdx - height);
  const visible = lines.slice(startIdx, endIdx);

  while (visible.length < height) visible.push("");

  if (state.scrollOffset > 0) {
    visible[0] = C.faint(`↑ scroll (${state.scrollOffset}) `) + visible[0];
  }
  return visible;
}

// ── Overlays ─────────────────────────────────────────────────────────────────
function renderApprovalOverlay(state, width) {
  const { toolName, args } = state.approval;
  const argsPreview = truncate(JSON.stringify(args || {}), Math.max(10, width - 4));
  const lines = [
    hr(width),
    C.red.bold(`${ICONS.warn} Approval dibutuhkan: `) + C.text(toolName),
    C.faint("  " + argsPreview),
    C.dim(truncate("  [y] approve   [n] deny   [a] selalu izinkan tool ini turn ini", width)),
  ];
  return lines;
}

function renderAskUserOverlay(state, width) {
  const { question } = state.askUser;
  const lines = [hr(width), C.purple.bold(`${ICONS.info} Emora bertanya:`)];
  for (const l of wrapPlain(question, width - 2)) lines.push(C.text("  " + l));
  lines.push(C.dim(truncate("  Ketik jawaban lalu Enter.", width)));
  return lines;
}

// ── Alternate full-screen views ─────────────────────────────────────────────
function renderHistoryView(state, width, height) {
  const out = [C.primaryBold(" Riwayat Sesi "), hr(width)];
  const { sessions, index } = state.history;
  if (!sessions.length) {
    out.push(C.faint("  Belum ada sesi tersimpan."));
  } else {
    const visibleCount = Math.min(sessions.length, height - 6);
    const start = Math.max(0, Math.min(index - Math.floor(visibleCount / 2), sessions.length - visibleCount));
    for (let i = start; i < start + visibleCount && i < sessions.length; i++) {
      const s = sessions[i];
      const isSel = i === index;
      const marker = isSel ? C.primary("❯ ") : "  ";
      const title = truncate(s.title || "(tanpa judul)", width - 30);
      const date = new Date(s.updatedAt || s.createdAt || Date.now()).toLocaleString("id-ID");
      out.push(marker + (isSel ? C.primaryBold(title) : C.text(title)) + "  " + C.faint(date));
    }
  }
  out.push("");
  out.push(C.dim(truncate("  ↑↓ pilih · Enter buka · d hapus · r rename · Esc kembali", width)));
  return padScreen(out, width, height);
}

function renderSkillsView(state, width, height) {
  const out = [C.primaryBold(" Skills Manager "), hr(width)];
  const { list, index } = state.skills;
  if (!list.length) {
    out.push(C.faint("  Belum ada skill. Skill dibuat otomatis lewat percakapan (skill_factory)."));
  } else {
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      const isSel = i === index;
      const marker = isSel ? C.primary("❯ ") : "  ";
      const status = s.enabled ? C.green("[on] ") : C.faint("[off]");
      const name = truncate(s.name, width - 40);
      out.push(marker + status + " " + (isSel ? C.primaryBold(name) : C.text(name)));
      if (isSel) out.push("      " + C.faint(truncate(s.description, width - 10)));
    }
  }
  out.push("");
  out.push(C.dim(truncate("  ↑↓ pilih · Space toggle on/off · Esc kembali", width)));
  return padScreen(out, width, height);
}

function renderWizardView(state, width, height) {
  const out = [C.primaryBold(" Setup Provider "), hr(width)];
  const w = state.wizard;

  if (w.step === "provider") {
    out.push(C.text("Pilih provider AI:"));
    out.push("");
    for (let i = 0; i < w.choices.length; i++) {
      const isSel = i === w.optionIndex;
      const c = w.choices[i];
      out.push((isSel ? C.primary("❯ ") : "  ") + (isSel ? C.primaryBold(c.label) : C.text(c.label)) + C.faint(`  (${c.hint})`));
    }
  } else if (w.step === "apiKey") {
    out.push(C.text(`Masukkan API key untuk ${w.provider}:`));
    if (w.keyUrl) out.push(C.faint(`Dapatkan di: ${w.keyUrl}`));
    out.push("");
    out.push(C.primary("❯ ") + "*".repeat(w.textBuffer.length) + C.inverse(" "));
  } else if (w.step === "url") {
    out.push(C.text(w.provider === "ollama" ? "URL Ollama (kosongkan buat default):" : "Base URL endpoint:"));
    out.push("");
    out.push(C.primary("❯ ") + w.textBuffer + C.inverse(" "));
  } else if (w.step === "model") {
    out.push(C.text("Pilih model:"));
    out.push("");
    for (let i = 0; i < w.choices.length; i++) {
      const isSel = i === w.optionIndex;
      const c = w.choices[i];
      out.push((isSel ? C.primary("❯ ") : "  ") + (isSel ? C.primaryBold(c.label) : C.text(c.label)));
    }
    if (w.choices[w.optionIndex]?.value === "__custom__") {
      out.push("");
      out.push(C.primary("  model: ") + w.textBuffer + C.inverse(" "));
    }
  } else if (w.step === "confirm") {
    out.push(C.text("Ringkasan:"));
    out.push("");
    out.push("  " + C.faint("Provider: ") + C.text(w.provider));
    if (w.apiKey) out.push("  " + C.faint("API key:  ") + C.text("*".repeat(Math.min(w.apiKey.length, 20))));
    if (w.url) out.push("  " + C.faint("URL:      ") + C.text(w.url));
    out.push("  " + C.faint("Model:    ") + C.text(w.model));
    out.push("");
    out.push(C.green("Enter untuk simpan & pakai sekarang."));
  }

  out.push("");
  out.push(C.dim(truncate("  ↑↓ pilih · Enter lanjut · Esc batal/kembali", width)));
  return padScreen(out, width, height);
}

function renderGatewayStatusView(state, width, height) {
  const out = [C.primaryBold(" Gateway Status "), hr(width)];
  const platforms = Object.entries(state.gatewayStatus?.platforms || {});
  if (!platforms.length) {
    out.push(C.faint("  Belum ada platform dikonfigurasi. Jalankan 'emora gateway setup'."));
  } else {
    for (const [name, s] of platforms) {
      const dot = s.running ? C.green("●") : C.faint("○");
      const info = truncate(s.info || "", Math.max(10, width - name.length - 6));
      out.push(`  ${dot} ${C.bold(name)}  ${C.faint(info)}`);
    }
  }
  out.push("");
  out.push(C.dim("  Esc kembali"));
  return padScreen(out, width, height);
}

function renderTasksView(state, width, height) {
  const out = [C.primaryBold(" Background Tasks "), hr(width)];
  const list = state.tasks?.list || [];
  if (!list.length) {
    out.push(C.faint("  Gak ada background task yang lagi jalan."));
  } else {
    for (const t of list) out.push(`  ${ICONS.tool} ${C.text(t.name)}  ${C.faint(t.status || "")}`);
  }
  out.push("");
  out.push(C.dim("  Esc kembali"));
  return padScreen(out, width, height);
}

function padScreen(lines, width, height) {
  const out = lines.slice(0, height);
  while (out.length < height) out.push("");
  return out;
}

// ── Main entry point ─────────────────────────────────────────────────────────
export function computeScreen(state) {
  const { columns, rows } = clampSize(state);

  if (state.view === "history") return renderHistoryView(state, columns, rows).join("\n");
  if (state.view === "skills") return renderSkillsView(state, columns, rows).join("\n");
  if (state.view === "wizard") return renderWizardView(state, columns, rows).join("\n");
  if (state.view === "gatewayStatus") return renderGatewayStatusView(state, columns, rows).join("\n");
  if (state.view === "tasks") return renderTasksView(state, columns, rows).join("\n");

  // ── Default: chat view ──────────────────────────────────────────────────
  const header = renderHeader(state, columns);
  const suggestions = renderSuggestions(state, columns);

  let overlay = [];
  if (state.approval) overlay = renderApprovalOverlay(state, columns);
  else if (state.askUser) overlay = renderAskUserOverlay(state, columns);

  const noticeLine = state.error
    ? C.red(`${ICONS.fail} ${state.error}`)
    : state.notice
    ? C.faint(`${ICONS.info} ${state.notice}`)
    : "";

  const inputLine = renderInputLine(state, columns);
  const statusBar = renderStatusBar(state, columns);
  const essentialFooter = [inputLine, statusBar]; // ini gak boleh ke-drop
  const optionalFooter = [...overlay, ...(noticeLine ? [noticeLine] : []), ...suggestions];

  const minBodyHeight = 1;
  const maxFooterHeight = Math.max(essentialFooter.length, rows - header.length - minBodyHeight);
  let optional = optionalFooter;
  // Kalau overlay/notice/suggestion kepanjangan buat layar sekecil ini,
  // buang dari YANG PALING GAK PENTING dulu (baris atas overlay), supaya
  // input box & status bar (paling bawah) selalu tetap kelihatan.
  while (optional.length + essentialFooter.length > maxFooterHeight && optional.length > 0) {
    optional = optional.slice(1);
  }
  const footerLines = [...optional, ...essentialFooter];

  const bodyHeight = Math.max(minBodyHeight, rows - header.length - footerLines.length);
  const body = renderChatBody(state, columns, bodyHeight);

  return [...header, ...body, ...footerLines].join("\n");
}
