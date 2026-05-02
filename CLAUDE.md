# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Minimal local-first web console for [Codex](https://www.npmjs.com/package/codex-web-console). SvelteKit app that talks to a single local `codex app-server` via JSON-RPC over stdin/stdout. Published as an npm package with a CLI entry point (`npx codex-web-console`).

## Commands

```sh
bun install          # install dependencies
bun run dev          # dev server at 127.0.0.1:5173
bun run build        # production build
bun run check        # type-check (svelte-kit sync + svelte-check)
bun run preview      # preview production build
```

No test suite is configured. CI runs `bun run check` and `bun run build`.

## Architecture

### Server-side Codex bridge (`src/lib/server/codex.ts`)

The `CodexClient` singleton is the core of the app. It spawns `codex app-server` as a child process and communicates via newline-delimited JSON-RPC. All thread, turn, approval, and model operations go through this client. It maintains an in-memory event bus that downstream API routes consume for SSE and polling.

### Auth (`src/lib/server/auth.ts`)

Single-token auth. Token is read from `CODEX_WEB_CONSOLE_TOKEN` env var, or `~/.codex-web-console/config.json`. In dev mode, a fallback token `codex-web-console` is used if none is configured. Auth state is stored in a signed cookie (`cwc_auth`).

### API routes (`src/routes/api/`)

All API endpoints require authentication via `locals.authenticated` (set in `hooks.server.ts`).

| Route | Purpose |
|---|---|
| `api/events` | SSE stream (or `?transport=poll` long-poll) of `ConsoleEvent`s from the Codex bridge |
| `api/threads` | GET: list threads; POST: create thread (with cwd, prompt, permission mode, model selection) |
| `api/threads/[threadId]` | GET: read thread detail; DELETE: delete thread |
| `api/threads/[threadId]/messages` | POST: send follow-up message to existing thread |
| `api/threads/[threadId]/interrupt` | POST: interrupt active turn |
| `api/approvals/[requestId]` | POST: approve/deny approval requests |
| `api/models` | GET: list models; POST: fetch models from custom OpenAI-compatible provider |
| `api/file/[name]` | Serve local files referenced in markdown (rewritten by `render-markdown.ts`) |
| `api/fs` | Directory browser for workspace selection |

### Frontend (`src/routes/+page.svelte`)

Single-page app. The page component manages all client state: thread list, selected thread, timeline, SSE connection, approval handling, and model/workspace selection. Components in `src/lib/components/`:

- `LoginView` – token login/setup form
- `ThreadList` – sidebar thread list
- `Timeline` – turn/entry timeline with markdown rendering
- `WorkspaceBrowser` – local directory picker

### Key types (`src/lib/types.ts`)

`ConsoleEvent` is the union type for all SSE events. `TimelineEntry` / `TimelineTurn` represent the conversation structure. `ApprovalRequest` models pending approvals (commands, file changes, permissions).

## Svelte 5 Conventions

This project uses **Svelte 5 runes mode** (forced via `svelte.config.js`). Use `$state()`, `$derived()`, `$effect()`, and `$props()` — not the legacy `export let` / `$:` syntax.

## Runtime Requirements

- Bun >= 1.2 must be in PATH
- `codex` CLI must be in PATH (the app spawns `codex app-server`)
