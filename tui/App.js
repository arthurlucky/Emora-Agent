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

export default function App({ sessionId, sessionTitle, provider, llm, tools, initialQuery, initialMode, onQuit, onActivity }) {
  const { stdout } = useStdout();
  const { exit } = useApp();

  const [state, dispatch] = useReducer(
    reducer,
    createInitialState({
      sessionId,
      sessionTitle,
      provider,
      initialMode,
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
