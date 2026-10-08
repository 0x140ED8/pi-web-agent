# pi-agent-web - Development Notes

Web UI for **pi-agent-server** (`../pi-agent-server`), inspired by `pi-web-main`. Vite + React 19 + TypeScript + Tailwind v4. The frontend has **no Pi SDK dependency** — all data comes from the server's REST + per-prompt SSE API.

## Commands

- `npm install`
- `npm run dev` — Vite dev server on `127.0.0.1:5173`, proxies `/api` → `http://127.0.0.1:8787`
- `npm run typecheck` — `tsc --noEmit`
- `npm run build` — `tsc --noEmit && vite build` (verify before finishing)

Backend must be running: `cd ../pi-agent-server && npm start` (port 8787).

## Architecture

```
Browser (Vite SPA)
  │  /api/*  (dev proxy)  →  pi-agent-server :8787
  ▼
state/agent.tsx  (global provider)
  ├─ lib/api.ts     typed REST wrappers
  ├─ lib/sse.ts     POST + ReadableStream SSE parser
  └─ components/*   get state via useAgent()
```

- `state/agent.tsx` is the single source of truth: sessions, active session, messages,
  streaming state, models, meta (model/thinking), stats, settings. Components read it via
  `useAgent()`; there is no external state library.
- `lib/sse.ts` parses `event:` / `data:` frames from the **prompt POST response** because the
  server returns SSE on that response (an `EventSource` cannot POST).

## Key design decisions & traps

### SSE is per-prompt, not a persistent connection
`POST /api/sessions/:id/prompt` streams events on the response body. Disconnecting the client
makes the **server abort the run**. Therefore:
- Parse with `fetch` + `body.getReader()` (`lib/sse.ts`), never `EventSource`.
- Only abort on an explicit Stop (`abortSession` + `AbortController`); do not unmount mid-run.
- A monotonic run id guards against late events from a previous run.

### Streaming assembly
- `message_start` (assistant) creates a placeholder message; `message_update.assistantMessageEvent`
  appends `text_delta` / `thinking_delta`; `message_end.message` is authoritative and replaces
  the placeholder.
- `tool_execution_start/update/end` drive transient tool cards (`activeTools`) during a run.
- On stream end, `reloadMessages()` refetches `GET /messages` and replaces the whole list, so
  tool results and final state are always server truth.

### Tool call field normalization
Pi stores `{type:"toolCall", id, name, arguments}`; the UI uses `{toolCallId, toolName, input}`.
`lib/normalize.ts` handles this in both history loading and streaming.

### Auto-rename (one-shot)
On the first user turn (no prior `user` message in the session), if `settings.autoRename` is on,
the client fires `POST /api/chat` with the user text + `settings.namingPrompt`, cleans the reply
(`cleanSessionName`) and calls `POST /api/sessions/:id/rename`. It is best-effort and runs in
parallel with the main prompt. Settings persist in `localStorage` (`pi-agent-web:settings`).

### Tailwind v4 tokens
Design tokens live in `src/styles/theme.css` under `@theme` (`--color-*` mapped to `--bg`,
`--panel`, `--accent`, …). Use utilities like `bg-panel`, `text-muted`, `border-border`,
`text-accent`, `bg-ok`. Light/dark are selected by `[data-theme]` on `<html>`; `index.html` has
an inline init script to avoid a flash. The palette is the "Run Ledger" identity — cool paper +
ochre in light, warm graphite + phosphor amber in dark — and no longer mirrors
  `pi-web-main/app/globals.css`. Latin type: Instrument Sans for UI/prose, IBM Plex Mono for
  machine text (tool rows, paths, stats, eyebrow labels), loaded from Google Fonts in `index.html`
  with system fallbacks so offline still renders.
- **Hero & button tokens.** The empty states are a left-aligned
  "letterhead" hero (π mark + eyebrow + hairline + glyph legend `@` `/` `⇧↵`) with a staggered
  `fade-in` load sequence (`.hero-1..4`); the old centered `.pi-mark-lg` empty state was removed.
  Buttons use dedicated tokens (`--btn-accent`, `--btn-accent-hover`, `--btn-hover`,
  `--btn-danger`, `--btn-danger-hover` → Tailwind classes `bg-btn-accent`, `hover:bg-btn-hover`,
  …) so light mode can render buttons slightly brighter and dark mode slightly darker without
  touching `--accent` (links, focus rings, run rail) or `--bg-hover` (list rows).

### Tool rows and the run rail
`ToolCallCard` renders as a log row: status node, tool name, and a one-line subject
(`toolSubject()` in `lib/normalize.ts`, workspace prefix stripped by `shortenPath()`) so a run is
readable while collapsed. When one assistant turn has several tool calls, `MessageView` wraps
them in `.run-rail` (see `theme.css`) — the rail encodes real execution order. Tool cards call
`useAgent()` for the workspace path, so they must stay inside `AgentProvider`.

### Mermaid / KaTeX
- KaTeX CSS is imported in `main.tsx`; math via `remark-math` + `rehype-katex`.
- Mermaid is a **dynamic import** in `components/MermaidBlock.tsx` (keeps the main bundle small)
  and re-renders on `data-theme` changes via a MutationObserver.
- `mermaid.render(id, code, container)` is passed the block's inner div as its render container,
  so mermaid's temporary measurement DOM stays inside `.mermaid-block` instead of `<body>`.
- The rendered SVG is forced to its natural size (`width`/`height` from `viewBox`,
  `max-width: none`); `.mermaid-block` scrolls horizontally instead of scaling wide
  diagrams down until the labels are unreadable.
- `theme.css` zeroes `transition-duration` for `.mermaid-block` descendants inside the
  `prefers-reduced-motion` reset. A global `transition-duration: 0.01ms` breaks mermaid's
  label measurement (subgraphs and spacing inflate ~10x), which happens on Windows machines
  with "show animations" turned off.

### Provider config panel
`PUT` requires `{baseUrl, models[]}`; `PATCH` merges top-level fields (send `models` to replace,
`apiKey: null` to clear). After any mutation, refresh `/api/models`. Keys are never returned by
the server — only `hasApiKey` / `apiKeyMasked`.

### Knowledge base (RAG)
`components/KnowledgePanel.tsx` manages KBs via `/api/kb/*`. The KB switch in `ChatInput`'s
control row persists `{kbEnabled, kbId}` in settings; when on, `sendMessage` adds
`knowledgeBaseId` to the prompt body and the server injects a `<<<KB_CONTEXT>>>…` block after
the user question. `lib/normalize.ts#stripKbContext` hides that block from user bubbles (the
block stays in the JSONL for the model); the `kb_context` SSE event drives the small notice
under the composer and carries `results` (raw hits). The assistant answer then starts with a
“点击获取知识库搜索结果” button (`components/KbResultsModal.tsx`) showing each hit's index path
`[document/heading 1/heading 2/...]`, page, score and original text, plus the rewritten
retrieval query (`chat.kb.rewrittenQuery`) when the server rewrote it. Live hits are attached to
the optimistic user message by `agent.tsx` (`streamUserIdRef` + `parseKbHits`); for history,
`normalize.ts#parseKbContextBlock` re-parses the persisted context block (including the
`检索查询:` line) instead, so the button and the rewritten query survive reloads — no second
retrieval, no duplicated context. Service warmup takes 40-60s —
the panel polls `/api/kb` and shows starting/online states.

## File map

```
src/components/
  AppShell.tsx        layout + modal state + mobile sidebar
  Sidebar.tsx         session list/search/new/delete/rename + providers/skills buttons
  TopBar.tsx          title/rename, stats, theme, settings
  ChatWindow.tsx      scroll area, error banner, streaming tool cards
  ChatInput.tsx       textarea + @ file mentions + / skill mentions + model/thinking selectors + compact/send/stop
  MessageView.tsx     user bubble / assistant blocks (text/thinking/toolCall)
  MarkdownBody.tsx    react-markdown + GFM + KaTeX + highlight + mermaid hook
  MermaidBlock.tsx    dynamic mermaid renderer
  ToolCallCard.tsx    log row (status node + subject) with collapsible args/result
  ProvidersPanel.tsx  providers.json editor
  SkillsPanel.tsx     Pi skills list + disable-model-invocation toggle
  KnowledgePanel.tsx  knowledge bases (RAG): service status, KB CRUD, docs, ingest jobs
  SettingsPanel.tsx   auto-rename, naming prompt, language, theme
  Modal.tsx icons.tsx
src/state/agent.tsx   global state + streaming + actions
src/lib/              api sse types normalize format settings fileFuzzy
src/i18n/             index.tsx zh-CN.ts en.ts
src/hooks/useTheme.ts
```

## ports

- Frontend dev: `5173` (do not use `30141` — that is pi-web's port).
- Backend: `8787`.
- If `EADDRINUSE` on 8787, a stale server is running; kill the listener before restarting.
