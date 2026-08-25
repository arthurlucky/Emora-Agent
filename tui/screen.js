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
import { getSkin, rpgHeader, rpgWelcome } from "./theme-rpg.js";

const MIN_WIDTH = 40;
const MIN_HEIGHT = 12;

function clampSize(state) {
  const columns = Math.max(MIN_WIDTH, state.terminalSize.columns || 80);
  const rows = Math.max(MIN_HEIGHT, state.terminalSize.rows || 24);
  return { columns, rows };
}

// ── Header ───────────────────────────────────────────────────────────────────
// Ala Hermes: satu baris tenang — brand + judul kiri, provider + mode kanan.
function renderHeader(state, width) {
  const brand = C.primaryBold("◆ EMORA");
  const title = C.dim(truncate(state.sessionTitle || "Sesi baru", Math.max(8, Math.floor(width * 0.4))));
  const left = `${brand} ${C.faint("·")} ${title}`;

  const modeTag = state.mode === "safe" ? C.yellow("safe") : state.mode === "plan" ? C.purple("plan") : C.green("auto");
  const providerText = `${state.provider?.model || "-"}`;
  const right = C.faint(`${truncate(providerText, 24)} ${C.dim("[" + modeTag + C.dim("]"))}`);
  const rightLen = stripAnsi(right).length;

  const leftLen = stripAnsi(left).length;
  const gap = Math.max(1, width - leftLen - rightLen);

  const line = getSkin() === "rpg" ? rpgHeader(left + " ".repeat(gap) + right) : left + " ".repeat(gap) + right;
  return [line, hr(width)];
}

// ── Status bar ───────────────────────────────────────────────────────────────
// Ala Hermes: model │ ctx │ timer — info padat satu baris.
function renderStatusBar(state, width) {
  const modelName = truncate(state.provider?.model || "-", 20);
  let left = `${C.primary("⚕")} ${C.dim(modelName)}`;

  // Timer turn aktif (detik sejak submit).
  if (state.status === "thinking" && state.turnStartedAt) {
    const secs = Math.floor((Date.now() - state.turnStartedAt) / 1000);
    left += C.faint(` │ ⏲ ${secs}s`);
  }

  const right = C.faint("/help · ctrl+c keluar");
  const rightLen = stripAnsi(right).length;
  const leftLen = stripAnsi(left).length;
  const gap = Math.max(1, width - leftLen - rightLen);

  return [left + " ".repeat(gap) + right, hr(width)];
}

// ── Welcome screen ───────────────────────────────────────────────────────────
// Ala TUI.md Contoh 2, SAMA PERSIS: kiri "Welcome back!" + logo + model·info·cwd,
// kanan Tips + separator + Recent activity.
function renderWelcome(state, width) {
  const userName = (process.env.USER || process.env.USERNAME || "").trim();
  const greeting = userName ? `Welcome back ${userName}!` : "Welcome back!";
  const logoLines = [
    "",
    centerPlain(greeting, 26),
    "",
    "        ▄████▄        ",
    "       ███  ███       ",
    "       ████████       ",
    "       ██ ▀▀ ██       ",
    "        ▀▄  ▄▀        ",
    "",
    C.dim(centerPlain(truncate(`${state.provider?.model || "-"} · Emora`, 25), 26)),
    C.faint(centerPlain(truncate(process.cwd(), 25), 26)),
    "",
    "",
  ];
  const cwdNote = process.cwd().startsWith("/data/data/com.termux/files/home") && process.cwd() === "/data/data/com.termux/files/home"
    ? ["", C.faint(" Note: You have launched emora in your home directory")]
    : [];
  const tipsLines = [
    "",
    C.bold("Tips for getting started"),
    C.dim(" Ask Emora to create a new app or clone a repository"),
    ...cwdNote,
    "",
    C.faint("─".repeat(Math.min(46, Math.floor(width * 0.45)))),
    "",
    C.bold("Recent activity"),
    C.faint(" No recent activity"),
    "",
    "",
    "",
  ];

  // Border box 2 kolom — persis pola TUI.md: ┌─ label ─┬───┐
  const leftW = 28;
  const rows = Math.max(logoLines.length, tipsLines.length);
  const out = [borderTop2(width, ` Emora v${globalThis.__EMORA_VERSION || "3.0"} `, leftW)];
  for (let i = 0; i < rows; i++) {
    const lRaw = logoLines[i] || "";
    const rRaw = (tipsLines[i] || "").slice(0, Math.max(10, width - leftW - 7));
    const rPad = " ".repeat(Math.max(0, width - leftW - 7 - stripAnsi(rRaw).length));
    out.push(
      C.border("│ ") + lRaw + " ".repeat(Math.max(1, leftW - stripAnsi(lRaw).length)) +
      C.border("│ ") + rRaw + rPad + C.border("│")
    );
  }
  const mid = leftW + 2;
  out.push(
    C.border("└" + "─".repeat(mid)) + C.border("┴") +
    C.border("─".repeat(Math.max(0, width - mid - 4))) + C.border("┘")
  );
  return out;
}

function centerPlain(text, w) {
  const visible = stripAnsi(String(text)).length;
  const pad = Math.max(0, w - visible);
  return " ".repeat(Math.floor(pad / 2)) + text;
}

/** Border top dua-kolom: ┌─ label ─┬─────┐ */
function borderTop2(width, label = "", leftW = 28) {
  const labelPart = C.primaryBold(label);
  const labelLen = stripAnsi(labelPart).length;
  const leftInner = leftW - 1;
  const rightInner = Math.max(4, width - leftW - 6);
  return (
    C.border("┌─") + labelPart + " ".repeat(Math.max(1, leftInner - labelLen - 1)) +
    C.border("┬") + C.border("─".repeat(rightInner)) + C.border("┐")
  );
}

// ── Input area ───────────────────────────────────────────────────────────────
// Ala TUI.md Contoh 2: pesan diapit dua garis horizontal penuh, prefix "> ",
// footer "? for shortcuts". Status info dipindah ke baris atas input.
function renderInputArea(state, width) {
  const availW = Math.max(10, width - 4); // "> " kiri + cursor
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
  const leftMark = windowStart > 0 ? C.faint("…") : "";
  const rightMark = windowEnd < input.length ? C.faint("…") : "";

  // Status ringkas kanan pada garis atas (model · mode · timer).
  const modelName = truncate(state.provider?.model || "-", 18);
  const modeTag = state.mode === "safe" ? "safe" : state.mode === "plan" ? "plan" : "auto";
  let rightInfo = `${modelName} · ${modeTag}`;
  if (state.status === "thinking" && state.turnStartedAt) {
    rightInfo += ` · ${Math.floor((Date.now() - state.turnStartedAt) / 1000)}s`;
  }
  const padTop = Math.max(1, width - stripAnsi(rightInfo).length - 1);

  return [
    hr(width),
    C.faint(rightInfo) + " ".repeat(padTop),
    C.primaryBold("> ") + leftMark + styled + rightMark,
    hr(width),
    C.dim("? for shortcuts"),
  ];
}

// ── Border helpers (gaya kotak ala Claude Code) ─────────────────────────────
// Baris input & status dibungkus border rounded; konten chat tetap bebas.
function borderTop(width, label = "") {
  const labelPart = label ? C.primaryBold(` ${label} `) : "";
  const labelLen = stripAnsi(labelPart).length;
  return C.border("╭" + "─".repeat(2)) + labelPart + C.border("─".repeat(Math.max(0, width - 4 - labelLen))) + C.border("╮");
}
function borderBottom(width) {
  return C.border("╰" + "─".repeat(Math.max(0, width - 3))) + C.border("╯");
}
function borderLine(content, width) {
  const visible = stripAnsi(content).length;
  const pad = Math.max(0, width - 3 - visible);
  return C.border("│ ") + content + " ".repeat(pad) + C.border("│");
}

/** Input box berbingkai: [top, line, bottom]. */
function renderInputBox(state, width) {
  return [
    borderTop(width),
    borderLine(renderInputLine(state, width - 4), width),
    borderBottom(width),
  ];
}

/** Status bar berbingkai tipis (tanpa box penuh): garis atas + isi. */
function renderStatusBox(state, width) {
  const [line] = renderStatusBar(state, width - 4); // sisakan ruang border
  return [borderLine(line, width)];
}

function renderSuggestions(state, width) {
  if (!state.suggestions?.length) return [];
  const out = [];
  const maxShown = 6;
  const total = state.suggestions.length;
  const idx = state.suggestionIndex;

  // BUG LAMA: dulu selalu nampilin 6 item PERTAMA (`slice(0, maxShown)`)
  // gak peduli suggestionIndex-nya udah maju ke mana. Begitu user pencet
  // panah bawah lewat item ke-6, suggestionIndex tetap nambah di reducer,
  // tapi karena window render-nya statis, item terpilih itu gak pernah
  // masuk daftar yang ditampilkan -> highlight-nya "hilang"/kelihatan
  // macet di item terakhir yang sempat ke-render (dilaporkan macet di
  // "/stream"). Fix: window slice-nya sekarang IKUT bergeser (scroll)
  // supaya index yang lagi dipilih selalu ada di dalam area yang tampil,
  // baik pas scroll ke bawah maupun balik ke atas.
  const maxWindowStart = Math.max(0, total - maxShown);
  let windowStart = Math.max(0, idx - maxShown + 1);
  windowStart = Math.min(windowStart, maxWindowStart);

  const list = state.suggestions.slice(windowStart, windowStart + maxShown);
  for (let i = 0; i < list.length; i++) {
    const globalIdx = windowStart + i;
    const isSel = globalIdx === idx;
    const text = truncate(list[i], width - 4);
    out.push((isSel ? C.primary("  ❯ ") : "    ") + (isSel ? C.primaryBold(text) : C.dim(text)));
  }

  const hiddenAbove = windowStart;
  const hiddenBelow = total - (windowStart + list.length);
  if (hiddenAbove > 0 || hiddenBelow > 0) {
    const bits = [];
    if (hiddenAbove > 0) bits.push(`↑${hiddenAbove} di atas`);
    if (hiddenBelow > 0) bits.push(`↓${hiddenBelow} di bawah`);
    out.push(C.faint(`    …${bits.join("  ")}`));
  }
  return out;
}

// ── Chat transcript ──────────────────────────────────────────────────────────
// Memoize renderMarkdown per (content, width) — highlight syntax mahal,
// dulu semua pesan lama dirender ulang tiap frame (26ms/render @100 pesan).
const _mdCache = new Map();
function renderMessageBlock(msg, width) {
  const lines = [];
  if (msg.role === "user") {
    // Ala TUI.md Contoh 2: pesan user polos tanpa header blok.
    for (const l of wrapPlain(msg.content, width - 4)) lines.push("   " + C.text(l));
  } else {
    // Ala Contoh 1: tiap blok respons diawali bullet ● ungu, teks lanjutan menjorok.
    const key = `${msg.content.length}:${width}`;
    let bodyLines = _mdCache.get(key);
    if (!bodyLines) {
      bodyLines = renderMarkdown(msg.content, width - 6);
      if (_mdCache.size > 500) _mdCache.clear(); // ponytail: clear-all, LRU kalau memory jadi masalah
      _mdCache.set(key, bodyLines);
    }
    bodyLines.forEach((l, i) => lines.push((i === 0 ? C.purple("● ") : "  ") + " " + l));
  }
  lines.push("");
  return lines;
}

function renderChatBody(state, width, height) {
  const lines = [];
  for (const msg of state.messages) lines.push(...renderMessageBlock(msg, width));

  if (state.status === "thinking") {
    lines.push(C.purple("● ") + C.yellow(`${spinnerFrame(state.spinnerTick)} sedang berpikir...`));
    for (const entry of state.progressLines.slice(-8)) {
      // Entry bisa string lama atau objek {line, name, result}.
      if (typeof entry === "string") { lines.push("  " + entry); continue; }
      lines.push("  " + entry.line);
      if (entry.result) {
        const dur = entry.result.durationMs ? C.faint(` · ${Math.round(entry.result.durationMs / 100) / 10}s`) : "";
        lines.push("  " + C.dim("│ ") + C.green("✓ selesai") + dur);
      }
    }
    lines.push("");
  }

  if (!lines.length) {
    lines.push(...(getSkin() === "rpg" ? rpgWelcome(state, width) : renderWelcome(state, width)));
  }

  // Clip ke tinggi yang tersedia, dari bawah (paling baru), digeser scrollOffset.
  const total = lines.length;
  const endIdx = Math.max(0, total - state.scrollOffset);
  const startIdx = Math.max(0, endIdx - height);
  const visible = lines.slice(startIdx, endIdx);

  while (visible.length < height) visible.push("");

  if (state.scrollOffset > 0) {
    // Sisipkan baris indikator, JANGAN timpa baris pertama (dulu konten hilang).
    visible.unshift(C.faint(`↑ scroll (${state.scrollOffset})`));
    visible.pop();
  }
  return visible;
}

// ── Overlays ─────────────────────────────────────────────────────────────────
function renderApprovalOverlay(state, width) {
  const { toolName, args } = state.approval;
  const argsPreview = truncate(JSON.stringify(args || {}), Math.max(10, width - 4));

  // Preview file (write/patch) ala TUI.md: nomor baris di panel bawah.
  const preview = [];
  const filePath = args?.path || args?.file_path || args?.rel_path;
  if (filePath && ["write_file", "patch", "edit"].includes(toolName)) {
    const contentStr = String(args.content ?? args.new_string ?? "");
    if (contentStr) {
      preview.push(hr(width));
      preview.push(C.text(` ${ICONS.tool} ${truncate(String(filePath), width - 12)}`));
      const maxLines = 9;
      contentStr.split("\n").slice(0, maxLines).forEach((l, i) => {
        preview.push(C.faint(String(i + 1).padStart(3) + " ") + C.dim(truncate(" " + l, width - 8)));
      });
      if (contentStr.split("\n").length > maxLines) preview.push(C.faint("   …"));
    }
  }

  return [
    hr(width),
    C.red.bold(`${ICONS.warn} Perlu izin: `) + C.bold(toolName),
    C.faint("  " + argsPreview),
    ...preview,
    "",
    C.primary("❯ 1. Yes") + C.dim("      setujui sekali ini"),
    "  " + C.text("2. Yes, selalu") + C.dim("  izinkan tool ini turn ini"),
    "  " + C.text("3. No") + C.dim("        tolak"),
    C.dim(truncate("  [1/Enter] yes · [2] selalu · [3/n] no", width)),
  ];
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
      const status = s.toggleable === false ? C.faint("[plg]") : (s.enabled ? C.green("[on] ") : C.faint("[off]"));
      const name = truncate(s.name, width - 40);
      out.push(marker + status + " " + (isSel ? C.primaryBold(name) : C.text(name)) + (s.source && s.source !== "builtin" ? C.faint(`  (${s.source})`) : ""));
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

  const inputLine = renderInputArea(state, columns);
  // Notice fitur ala Contoh 2 ("* Voice mode is now available · /voice to enable").
  const featureNotice = state.featureNotice ? ["", C.dim(`* ${state.featureNotice}`)] : [];
  const essentialFooter = [...inputLine]; // ini gak boleh ke-drop
  const optionalFooter = [...overlay, ...(noticeLine ? [noticeLine] : []), ...suggestions, ...featureNotice];

  const minBodyHeight = 1;
  const maxFooterHeight = Math.max(essentialFooter.length, rows - header.length - minBodyHeight);
  let optional = optionalFooter;
  // Kalau overlay/notice/suggestion kepanjangan buat layar sekecil ini,
  // buang dari YANG PALING GAK PENTING dulu (baris atas overlay), supaya
  // input box (paling bawah) selalu tetap kelihatan.
  while (optional.length + essentialFooter.length > maxFooterHeight && optional.length > 0) {
    optional = optional.slice(1);
  }
  const footerLines = [...optional, ...essentialFooter];

  const bodyHeight = Math.max(minBodyHeight, rows - header.length - footerLines.length);
  const body = renderChatBody(state, columns, bodyHeight);

  return [...header, ...body, ...footerLines].join("\n");
}
