<!-- headroom:rtk-instructions -->
# RTK (Rust Token Killer) - Token-Optimized Commands

When running shell commands, **always prefix with `rtk`**. This reduces context
usage by 60-90% with zero behavior change. If rtk has no filter for a command,
it passes through unchanged — so it is always safe to use.

## Key Commands
```bash
# Git (59-80% savings)
rtk git status          rtk git diff            rtk git log

# Files & Search (60-75% savings)
rtk ls <path>           rtk read <file>         rtk grep <pattern>
rtk find <pattern>      rtk diff <file>

# Test (90-99% savings) — shows failures only
rtk pytest tests/       rtk cargo test          rtk test <cmd>

# Build & Lint (80-90% savings) — shows errors only
rtk tsc                 rtk lint                rtk cargo build
rtk prettier --check    rtk mypy                rtk ruff check

# Analysis (70-90% savings)
rtk err <cmd>           rtk log <file>          rtk json <file>
rtk summary <cmd>       rtk deps                rtk env

# GitHub (26-87% savings)
rtk gh pr view <n>      rtk gh run list         rtk gh issue list

# Infrastructure (85% savings)
rtk docker ps           rtk kubectl get         rtk docker logs <c>

# Package managers (70-90% savings)
rtk pip list            rtk pnpm install        rtk npm run <script>
```

## Rules
- In command chains, prefix each segment: `rtk git add . && rtk git commit -m "msg"`
- For debugging, use raw command without rtk prefix
- `rtk proxy <cmd>` runs command without filtering but tracks usage
<!-- /headroom:rtk-instructions -->

---

## Repository notes

- **`rtk` is documented above but NOT installed** (not on PATH; every `rtk ...` call fails with
  `command not found`). Ignore the block above and use raw commands.
- **Loose workspace, not a git repo.** `D:\MyAPP\agent` contains two apps plus a reference
  checkout and a report. There is nothing to `git` here.
- **Three project directories — pick the right one before running npm:**
  - `pi-agent-server/` — backend. Embedded Pi agent exposed as HTTP + SSE on `:8787`. This is the
    real agent. Its `config/providers.json` holds the provider/model/API keys.
  - `pi-agent-web/` — frontend (Vite + React 19 + TS + Tailwind v4). Dev server on `:5173` and
    proxies `/api` → `127.0.0.1:8787`; it has **no Pi SDK dependency**, only the server's REST+SSE.
  - `pi-web-main/` — upstream `agegr/pi-web` checkout kept as the **design reference only**. It is
    a separate Next.js app on `:30141` that embeds the Pi SDK in-process and reads `~/.pi/agent`;
    it does **not** talk to `pi-agent-server`. Do not modify it or start its dev/build unless the
    task is specifically about the reference.
- `pi-embedding-report.md` — background research on embedding Pi (SDK/RPC/print routes). Read-only.
- Run every npm/tool command with the matching `workdir=`; do not run them from this root.
- **Read the per-app instructions before editing:** `pi-agent-server/AGENTS.md`,
  `pi-agent-web/AGENTS.md`.
- **Typical loop:** backend `npm start` (in `pi-agent-server`) → frontend `npm run dev`
  (in `pi-agent-web`). The frontend is the only consumer of the backend API; changing one usually
  means checking the other's contract.
