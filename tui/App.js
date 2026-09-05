/**
 * tui/App.js
 *
 * Root component Ink. Ditulis pakai React.createElement langsung (bukan
 * JSX) karena EMORA dijalankan langsung lewat `node bin/emora.js` tanpa
 * build step — nulis JSX di sini akan gagal di-parse Node apa adanya.
 *
 * Ink cuma dipakai buat lifecycle (alt-screen, raw stdin, resize, render
 * loop); seluruh tata letak & warna dihitung sebagai string oleh
 * tui/screen.js, mirip pendekatan lipgloss di versi Go-nya.
 */
import React, { useReducer, useRef, useEffect, useMemo } from "react";
import { Box, Text, useInput, useStdout, useApp } from "ink";

import { createInitialState, reducer } from "./state.js";
import { computeScreen } from "./screen.js";
import { createAgentController } from "./ctl.js";
import { handleKey } from "./keys.js";

const h = React.createElement;

export default function App({ sessionId, sessionTitle, provider, llm, tools, initialQuery, initialMode, initialMessages, onQuit, onActivity }) {
  const { stdout } = useStdout();
  const { exit } = useApp();

  const [state, dispatch] = useReducer(
    reducer,
    createInitialState({
      sessionId,
      sessionTitle,
      provider,
      initialMode,
      initialMessages,
      columns: stdout?.columns || 80,
      rows: stdout?.rows || 24,
    })
  );

  const stateRef = useRef(state);
  stateRef.current = state;

  // Track percakapan untuk exit summary (aturan TUI.md #11).
  const hadActivityRef = useRef(false);
  useEffect(() => {
    if (stateRef.current.messages?.length && !hadActivityRef.current) {
      hadActivityRef.current = true;
      onActivity?.();
    }
  }, [stateRef.current.messages?.length]);

  // Load recent activity for the welcome screen
  useEffect(() => {
    import("../core/sessionStore.js").then(({ listSessions }) => {
      listSessions().then(sessions => {
        dispatch({ type: "SET_RECENT_ACTIVITY", sessions: sessions.slice(0, 5) });
      }).catch(() => {});
    }).catch(() => {});
  }, []);

  const llmRef = useRef(llm);

  const controller = useMemo(
    () =>
      createAgentController({
        dispatch,
        getState: () => stateRef.current,
        getLLM: () => llmRef.current,
        tools,
      }),
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Spinner tick buat animasi "sedang berpikir..." — HANYA saat thinking.
  // Dulu interval jalan terus walau idle → re-render 8x/detik + computeScreen
  // penuh tiap tick = CPU terbakar di sesi panjang.
  // BUGFIX (TUI kelap-kelip pas AI merespon): tiap tick = computeScreen()
  // dipanggil ulang PENUH + Ink nge-erase & nulis ulang SELURUH layar (Ink
  // gak diff per-baris buat konten non-Static, jadi render ulang total tiap
  // ada perubahan state). 120ms (~8x/detik) kegedean buat ini — dinaikkan
  // ke 150ms: animasi masih halus di mata, tapi jumlah repaint layar penuh
  // per detik berkurang.
  const statusRef = useRef(state.status);
  statusRef.current = state.status;
  useEffect(() => {
    const id = setInterval(() => {
      if (statusRef.current === "thinking") dispatch({ type: "SPINNER_TICK" });
    }, 150);
    return () => clearInterval(id);
  }, []);

  // Resize terminal — di-debounce dikit. Beberapa terminal ngirim banyak
  // event "resize" beruntun pas window di-drag-resize, dan tiap event di
  // sini sebelumnya langsung dispatch → 1 repaint Ink full-screen per
  // event. Ikut nyumbang kelap-kelip kalau gak ditahan.
  useEffect(() => {
    if (!stdout) return;
    let debounceId = null;
    const onResize = () => {
      clearTimeout(debounceId);
      debounceId = setTimeout(() => {
        dispatch({ type: "SET_TERMINAL_SIZE", columns: stdout.columns, rows: stdout.rows });
      }, 60);
    };
    stdout.on("resize", onResize);
    return () => { clearTimeout(debounceId); stdout.off("resize", onResize); };
  }, [stdout]);

  // Pickup LLM baru kalau wizard baru aja ganti provider (lihat tui/keys.js)
  useEffect(() => {
    if (globalThis.__EMORA_TUI_LLM__) {
      llmRef.current = globalThis.__EMORA_TUI_LLM__;
      globalThis.__EMORA_TUI_LLM__ = null;
    }
  });

  // Kirim initial query (dari `emora "pertanyaan"`) sekali di awal
  const firedInitial = useRef(false);
  useEffect(() => {
    if (initialQuery && !firedInitial.current) {
      firedInitial.current = true;
      controller.submit(initialQuery);
    }
  }, [initialQuery, controller]);

  // BRACKETED PASTE HANDLER
  useEffect(() => {
    let inPaste = false;
    let pasteBuffer = "";
    let pasteCount = 0;

    const originalEmit = process.stdin.emit;
    process.stdin.emit = function (event, ...args) {
      if (event === "data" && args[0]) {
        let chunk = args[0].toString();
        
        if (chunk.includes("\x1b[200~")) {
          inPaste = true;
          const parts = chunk.split("\x1b[200~");
          // Pre-paste data (if any) could be let through, but for safety we ignore it
          chunk = parts[1] || "";
        }
        
        if (inPaste) {
          if (chunk.includes("\x1b[201~")) {
            pasteBuffer += chunk.split("\x1b[201~")[0];
            inPaste = false;
            
            pasteCount++;
            const lines = pasteBuffer.split("\n").length;
            const marker = `[Paste #${pasteCount} +${lines}Lines]`;
            
            dispatch({ type: "PASTE_TEXT", value: pasteBuffer, marker });
            return false;
          } else {
            pasteBuffer += chunk;
            return false;
          }
        } else if (chunk.length > 10 && chunk.includes("\n")) {
          // Fallback heuristic: terminal tidak pakai bracketed paste, 
          // tapi mengirim teks panjang (paste) dalam satu chunk data.
          pasteCount++;
          const lines = chunk.split("\n").length;
          const marker = `[Paste #${pasteCount} +${lines}Lines]`;
          dispatch({ type: "PASTE_TEXT", value: chunk, marker });
          return false;
        }
      }
      return originalEmit.apply(this, [event, ...args]);
    };

    // Aktifkan Bracketed Paste Mode di terminal
    process.stdout.write("\x1b[?2004h");
    return () => {
      process.stdout.write("\x1b[?2004l");
      process.stdin.emit = originalEmit;
    };
  }, []);

  useInput((input, key) => {
    handleKey({ state: stateRef.current, dispatch, controller, input, key });
  });

  useEffect(() => {
    if (state.quit) {
      onQuit?.();
      exit();
    }
  }, [state.quit, exit, onQuit]);

  const screenText = computeScreen(state);
  return h(Box, { flexDirection: "column" }, h(Text, null, screenText));
}
