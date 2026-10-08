# pi-agent-server

Embedded Pi (pi-coding-agent) coding agent exposed as an HTTP service. Node + TypeScript, run with tsx (no build step). Zero web framework — Node `http` + SSE.

## Commands (run from this directory)

- `npm install`
- `npm start` — run server (`tsx src/server.ts`)
- `npm run dev` — watch mode (`tsx watch`), restarts on change
- `npm run typecheck` — the **only** verification (`tsc --noEmit`); no test or lint script exists

## Architecture

- Entry `src/server.ts` (HTTP + SSE + routes) → `src/agent-manager.ts` (multi-session + model switch) → Pi SDK `createAgentSession`.
- `src/providers.ts` reads/writes provider config; `src/config.ts` loads server config + resolves paths.
- Auxiliary routes: `POST /api/chat` (one-shot, tool-less, in-memory; used for session auto-naming) and `POST /api/sessions/:id/rename` `{name}` (persisted as `session_info`). Both go through `AgentManager.oneShot()` / `.renameSession()`.
- `GET /api/files` (`src/files.ts`) walks `workspaceDir` for the web UI's @ mention index; `GET/PATCH /api/skills` (`src/skills.ts`) lists discovered skills and toggles `disable-model-invocation` in a SKILL.md frontmatter. Toggling reloads idle open sessions so the change applies live.
- Knowledge base / RAG (`src/knowledge.ts`): proxies the external retrieval service in `D:\MyAPP\rag` (FastAPI :8100, config `rag` in server.json). KB registry at `data/knowledge-bases/registry.json`; the service serves one KB at a time — `ensureActive` merges a KB's absolute paths + settings into the RAG service config via `POST /api/config`. `ensureService` auto-spawns `main.py serve` (uvicorn refuses connections during the 40-60s startup warmup). Routes under `/api/kb/*`; `POST /api/sessions/:id/prompt` accepts `knowledgeBaseId` and prepends a `<<<KB_CONTEXT>>>…<<<END_KB_CONTEXT>>>` block **after** the user question (question-first keeps the session-list preview readable; both server and web strip the marker block when displaying). The block also carries the rewritten retrieval query (`检索查询: …`, omitted when the rewrite was skipped) so the web UI can still show it after a session reload. The `kb_context` SSE event carries the summary **plus `results`: the full raw hits** (text/source/heading_path/page/score) so the web UI can render them on demand. Built-in skill `rag-knowledge-base` lives in `data/agent/skills/` (gitignored — recreated if deleted).
- Provider/model/API-key config lives in `config/providers.json` (Pi `models.json` format). **Keys are not env vars.**

## Conventions & gotchas

- **Config-driven providers**: `PUT/PATCH/DELETE /api/providers/:id` mutate `config/providers.json`, then call `modelRuntime.refresh({ allowNetwork: false })` to hot-reload. Editing the file by hand has **no effect** until it is reloaded — restart, or apply the change via the API.
- **Real API key** is in `config/providers.json` (DeepSeek). Never print/echo the file; mask keys (`sk-…`).
- ESM under `"moduleResolution": "NodeNext"`: relative imports in `src/**/*.ts` must use `.js` extensions (`./config.js`).
- The SDK's public entry does **not** re-export `Model`/`ThinkingLevel`/`@earendil-works/pi-ai` types, and `@earendil-works/pi-ai` is not a direct dependency (only nested under pi-coding-agent). Don't import it; derive types e.g. `type PiModel = NonNullable<AgentSession["model"]>`.
- DeepSeek is a built-in provider in Pi's catalog, so models in `config/providers.json` **merge** with built-in DeepSeek models (v4-*) rather than replacing them.
- `data/` is generated (sessions `*.jsonl`, `auth.json`, `models-store.json`); gitignored, safe to delete (destroys session history).
- Default port `8787`. `EADDRINUSE` means a stale server is running — find and kill the listener first.
- `ModelRuntime.create()` is offline by default; it only reaches the network when `allowModelNetwork: true` is passed.
- Session persistence crosses restart: `GET /api/sessions/:id` reopens a JSONL session from `data/sessions/`.

## Testing (manual)

No test framework. Start the server and exercise via HTTP. Sending UTF-8 (Chinese) via PowerShell/`curl` mangles the body unless you send bytes: `[Text.Encoding]::UTF8.GetBytes($json)` passed as `-Body`. That is a client-side limitation, not a server bug.

See `README.md` and `项目文档.md` for the full API reference.