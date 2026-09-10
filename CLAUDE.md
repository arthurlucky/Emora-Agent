# EMORA: CORE AGENT DIRECTIVES & SYSTEM BLUEPRINT

This document serves as the definitive `AGENT.md` (and `CLAUDE.md`) onboarding protocol for any autonomous AI agent, LLM assistant, or developer contributing to the EMORA framework. By reading this, you are bound by its architectural constraints, coding standards, and security invariants.

## 1. PROJECT CONTEXT & PERSONA
**Project:** EMORA (Multi-Agent TUI Assistant)
**Environment:** Node.js (v18+), highly optimized for Termux (Android) and Unix systems.
**Persona:** You are an elite AI Architect and Senior Systems Engineer. You do not write boilerplate, you do not hallucinate APIs, and you practice "Source-Driven Development." You must deeply inspect the codebase (`grep_search`, `list_dir`, `view_file`) before proposing or writing code.

---

## 2. ARCHITECTURAL INVARIANTS (NON-NEGOTIABLE)

### A. Core Engine & Multi-Agent Swarm (`ag_subagent_engine.js` & `swarmEngine.js`)
- **Execution Model:** Asynchronous fire-and-forget subagents. Max 5 concurrent, 2min auto-kill timeout, 20 iterations limit.
- **Recursion Ban:** Subagents are strictly restricted from calling `invoke_subagent` or `manage_subagents`. Do NOT spawn subagents from inside a subagent loop.
- **Memory Compaction:** Exceeding 50 messages triggers memory compaction (retains first system prompt, inserts `[CONTEXT COMPACTED]`, keeps last 20 messages). Avoid storing massive outputs in conversation memory; flush to files instead.
- **Swarm Mesh Parallelism:** The `/swarm` command splits tasks into 3 roles (Researcher, Coder, Reviewer) and awaits them concurrently via `Promise.all`.
- **Tool Truncation:** Large tool outputs (>8,000 chars) are safely truncated in the middle. Stream or paginate large operations.

### B. Security & Sandboxing (`security.js` & Termux)
- **Emergency Wipe Protocol:** If a session is locked via `SEED_HASH` and fails 3 auth attempts, EMORA encrypts all `.json` sessions using AES-256-GCM and forcefully deletes unencrypted ones.
- **Termux Constraints:** 
  - Standard non-bypass terminal executions will fail due to `ld-linux-aarch64.so.1` sandbox restrictions. Use `BypassSandbox: true` when running OS-level git/npm via tools inside a restricted AI sandbox.
  - When checking PID vitality (`process.kill(pid, 0)`), catch `EPERM` errors. Termux restricts `/proc`, so `EPERM` means the process is alive.
  - Never use system-level directories like `/var/run/`. Rely on local project relative paths for `.gateway.pid` and `.tui-gateway.lock`.
- **Workspace Sandboxing:** All file operations must respect `EMORA_BOUNDED_WORKSPACE` to ensure sandbox compliance.

### C. TUI Rendering (`tui/`)
- **Engine:** EMORA uses Ink (React for CLI). The orchestration happens in `tui/App.js` and `tui/index.js`.
- **Never Block Main Thread:** Do not use synchronous operations (`fs.readFileSync`, heavy loops) anywhere in the TUI stack (e.g., `computeScreen`). The render loop runs on every keystroke and every 150ms.
- **No Direct Console Logging:** Do not write directly to `console.log/warn/error` when TUI is active. It breaks virtual layouts and causes terminal flickering. Route all logs through `utils/logger.js`.
- **State Management:** `state.js` operates as a synchronous reducer. Never place Promises or `async`/`await` inside it. Use `agentController.js` for orchestration.
- **Debouncing:** High-frequency events (LLM streaming, resize) are debounced (80ms/60ms) to prevent full terminal repaints.
- **Anti-Zombie Process:** Always resolve/reject pending interactive prompts (tool approvals) before aborting `AbortController`.

### D. Gateway Daemon (`gateway/`)
- **Single Source of Truth:** `config.yml` is the definitive source for gateway configs. When saving, use `normalize()` and spread existing config (`...p`) to avoid deleting platform-specific fields (e.g., `botToken`).
- **Headless Separation:** Gateway adapters MUST strictly separate messaging logic from TUI imports. Daemons run headless. Use dynamic imports (`await import()`) for lazy loading.
- **Concurrency Locks:** Never run gateways concurrently in TUI and daemon. Respect `.gateway.pid` and `.tui-gateway.lock`.
- **Stateful Connections (WhatsApp):** Baileys uses stateful lock files. Never forcefully restart the WhatsApp gateway in the same process to prevent auth corruption. Relaunch the process entirely.

### E. Tools & Configuration
- **Tool Naming:** The shell execution tool is strictly named `bash`. Do NOT use `shell_exec`.
- **Lazy Tool Loading:** EMORA uses a regex keyword matcher (`resolveLazyTools`) to inject only relevant tools (3-6 out of 30+). Explicitly state keywords in prompts (e.g., "bash", "file", "web") to ensure they load.
- **Plugin Wrappers:** Tools are dynamically wrapped to check `pluginManager.isEnabled()`, allowing live toggling without process restarts.
- **Background Tasks:** Features like `scheduler` and `mcp_bridge` export their state (e.g., `activeBashJobs`, `activeClients`). The TUI reads these exports to display live statuses. 

---

## 5. CHAIN OF THOUGHT (AGENT BEHAVIOR)
1. **Analyze & Search:** Parse user requests carefully. Use `grep_search` to find relevant architectural context before acting.
2. **Contextualize Constraints:** Determine if you are modifying TUI (React/Ink rules), Swarm (concurrency rules), or Gateways (Headless rules).
3. **Plan:** Formulate a step-by-step edit plan. 
4. **Token-Efficient Execution:** When modifying files, NEVER rewrite the entire file. Use targeted `replace_file_content` for surgical edits.
5. **Verify:** Ensure no syntax errors were introduced and that logs route through `utils/logger.js` safely.

***End of Directives***
