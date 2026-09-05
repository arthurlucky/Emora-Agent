import React, { useState, useEffect, useRef } from "react";
import { render, Box, Text, useInput, useStdout, useApp } from "ink";
import axios from "axios";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { loadIndex, readEntry } from "../library/index.js";

const h = React.createElement;

// ── Web Browser TUI ──────────────────────────────────────────────────────────
function WebBrowserApp() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("search_input"); // 'search_input' | 'search_results' | 'browse'
  const [searchResults, setSearchResults] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  
  const [url, setUrl] = useState("");
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("EMORA Search Engine");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [scroll, setScroll] = useState(0);
  const rows = stdout?.rows || 24;
  const contentHeight = rows - 6;

  const performSearch = async (q) => {
    setLoading(true);
    setError(null);
    setMode("search_results");
    setSelectedIndex(0);
    setTitle(`Mencari: ${q}...`);
    
    try {
      const apiKey = process.env.TAVILY_API_KEY;
      if (!apiKey) {
        throw new Error("TAVILY_API_KEY belum di-set di file .env");
      }

      const { data } = await axios.post(
        "https://api.tavily.com/search",
        {
          query: q,
          search_depth: "advanced",
          max_results: 10,
          include_answer: false,
          include_raw_content: false
        },
        {
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          }
        }
      );
      
      const results = (data.results || []).map(r => ({
        title: r.title,
        url: r.url,
        snippet: r.content
      }));
      
      setSearchResults(results);
      setTitle(`Hasil Pencarian: ${q}`);
    } catch (err) {
      setError(`Gagal mencari: ${err.message}`);
      setTitle("Search Error");
    } finally {
      setLoading(false);
    }
  };

  const fetchWeb = async (targetUrl) => {
    let finalUrl = targetUrl;
    if (!finalUrl.startsWith("http")) finalUrl = "https://" + finalUrl;
    setLoading(true);
    setError(null);
    setMode("browse");
    setScroll(0);
    setTitle(`Loading ${finalUrl}...`);
    setContent("");
    
    try {
      const { data } = await axios.get(finalUrl, { timeout: 15000 });
      let text = data;
      if (/<html|<body|<div/i.test(data)) {
        text = data
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, "\n")
          .replace(/&nbsp;/g, " ")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
      }
      
      const titleMatch = data.match(/<title>([^<]+)<\/title>/i);
      const pageTitle = titleMatch ? titleMatch[1].trim() : finalUrl;
      
      setContent(text);
      setTitle(pageTitle);
      setUrl(finalUrl);
    } catch (err) {
      setError(`Gagal memuat: ${err.message}`);
      setTitle("Error");
    } finally {
      setLoading(false);
    }
  };

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      return;
    }
    if (key.escape) {
      if (mode === "browse") setMode("search_results");
      else if (mode === "search_results") setMode("search_input");
      else exit();
      return;
    }
    
    if (mode === "search_input") {
      if (key.return) {
        if (query.trim()) performSearch(query.trim());
      } else if (key.backspace || key.delete) {
        setQuery(query.slice(0, -1));
      } else if (input) {
        setQuery(query + input);
      }
    } else if (mode === "search_results") {
      if (key.upArrow) {
        setSelectedIndex(Math.max(0, selectedIndex - 1));
      } else if (key.downArrow) {
        setSelectedIndex(Math.min(searchResults.length - 1, selectedIndex + 1));
      } else if (key.return) {
        const sel = searchResults[selectedIndex];
        if (sel && sel.url) fetchWeb(sel.url);
      }
    } else if (mode === "browse") {
      if (key.upArrow) {
        setScroll(Math.max(0, scroll - 3));
      } else if (key.downArrow) {
        setScroll(scroll + 3);
      } else if (input.toLowerCase() === "a" && url && content) {
        exit();
        console.clear();
        console.log(`\nMenjalankan: emora kl install ${url}\n`);
        spawn("node", ["bin/emora.js", "kl", "install", url], { stdio: "inherit" });
      }
    }
  });

  const listHeight = rows - 6;
  
  // Calculate list view window
  let startIdx = 0;
  if (selectedIndex >= listHeight) {
    startIdx = selectedIndex - listHeight + 1;
  }
  const visibleResults = searchResults.slice(startIdx, startIdx + listHeight);

  const lines = content.split("\n");
  const visibleLines = lines.slice(scroll, scroll + contentHeight);

  return h(Box, { flexDirection: "column", height: rows, width: "100%" },
    h(Box, { backgroundColor: "blue", paddingX: 1 }, 
      h(Text, { color: "white", bold: true }, `🌐 ${title}`)
    ),
    h(Box, { paddingX: 1, marginY: 1, flexDirection: "column", flexGrow: 1, overflowY: "hidden" },
      mode === "search_input" 
        ? h(Text, null, "Cari di Internet: ", h(Text, { color: "cyan" }, query), h(Text, { inverse: true }, " "))
        : loading 
          ? h(Text, { color: "yellow" }, "Memuat...")
          : error 
            ? h(Text, { color: "red" }, error)
            : mode === "search_results"
              ? searchResults.length === 0
                ? h(Text, { color: "gray" }, "Tidak ada hasil pencarian.")
                : visibleResults.map((r, i) => {
                    const actualIndex = startIdx + i;
                    const isSelected = actualIndex === selectedIndex;
                    return h(Box, { key: actualIndex, flexDirection: "column", marginBottom: 1 },
                      h(Text, { color: isSelected ? "green" : "cyan", inverse: isSelected, bold: true }, 
                        `${actualIndex + 1}. ${r.title}`
                      ),
                      h(Text, { color: "gray", wrap: "truncate" }, r.snippet || r.url)
                    );
                  })
              : h(Text, null, visibleLines.join("\n"))
    ),
    h(Box, { backgroundColor: "gray", paddingX: 1, justifyContent: "space-between" },
      mode === "search_input"
        ? h(Text, { color: "white" }, "[Enter] Cari  [Esc] Keluar")
        : mode === "search_results"
          ? h(Text, { color: "white" }, "[Up/Down] Pilih  [Enter] Buka  [Esc] Cari Baru")
          : h(Text, { color: "white" }, "[Up/Down] Scroll  [A] Add to Library  [Esc] Kembali ke Hasil")
    )
  );
}

// ── Local Browser TUI ────────────────────────────────────────────────────────
function LocalBrowserApp() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [entries, setEntries] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [viewing, setViewing] = useState(null); // null | entry
  const [content, setContent] = useState("");
  const [scroll, setScroll] = useState(0);
  
  const rows = stdout?.rows || 24;
  const listHeight = rows - 4;

  useEffect(() => {
    try {
      const idx = loadIndex();
      setEntries(idx.entries || []);
    } catch (e) {
      // Ignored
    }
  }, []);

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      return;
    }
    
    if (viewing) {
      if (key.escape) {
        setViewing(null);
      } else if (key.upArrow) {
        setScroll(Math.max(0, scroll - 3));
      } else if (key.downArrow) {
        setScroll(scroll + 3);
      }
    } else {
      if (key.escape) {
        exit();
      } else if (key.upArrow) {
        setSelectedIndex(Math.max(0, selectedIndex - 1));
      } else if (key.downArrow) {
        setSelectedIndex(Math.min(entries.length - 1, selectedIndex + 1));
      } else if (key.return) {
        const sel = entries[selectedIndex];
        if (sel) {
          try {
            const txt = readEntry(sel.absPath);
            setContent(txt);
            setViewing(sel);
            setScroll(0);
          } catch (e) {
            // Ignored
          }
        }
      }
    }
  });

  // Calculate view window for list
  let startIdx = 0;
  if (selectedIndex >= listHeight) {
    startIdx = selectedIndex - listHeight + 1;
  }
  const visibleEntries = entries.slice(startIdx, startIdx + listHeight);

  return h(Box, { flexDirection: "column", height: rows, width: "100%" },
    h(Box, { backgroundColor: "green", paddingX: 1 }, 
      h(Text, { color: "white", bold: true }, `📚 EMORA Knowledge Library Browser`)
    ),
    h(Box, { paddingX: 1, marginY: 1, flexDirection: "column", flexGrow: 1, overflowY: "hidden" },
      viewing ? (
        h(Text, null, content.split("\n").slice(scroll, scroll + listHeight).join("\n"))
      ) : entries.length === 0 ? (
        h(Text, { color: "gray" }, "Library kosong atau belum di-index. Gunakan emora kl install <url>.")
      ) : (
        visibleEntries.map((e, i) => {
          const actualIndex = startIdx + i;
          const isSelected = actualIndex === selectedIndex;
          return h(Text, { key: actualIndex, color: isSelected ? "green" : "white", inverse: isSelected }, 
            `📄 ${e.topic}/${e.subtopic} - ${e.filename}`
          );
        })
      )
    ),
    h(Box, { backgroundColor: "gray", paddingX: 1 },
      viewing
        ? h(Text, { color: "white" }, `[Up/Down] Scroll  [Esc] Kembali  |  Melihat: ${viewing.filename}`)
        : h(Text, { color: "white" }, "[Up/Down] Pilih  [Enter] Baca  [Esc] Keluar")
    )
  );
}

export function cmdKlBrowseWeb() {
  console.clear();
  render(h(WebBrowserApp));
}

export function cmdKlBrowseLocal() {
  console.clear();
  render(h(LocalBrowserApp));
}
