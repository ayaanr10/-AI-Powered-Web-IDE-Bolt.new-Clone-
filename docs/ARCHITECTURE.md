# Architecture notes (how the project works)

## Core idea

Buildora has **two kinds of execution**. The **Express API server** runs on your own laptop and holds the private API key. The **generated user's application** runs inside WebContainers in the browser. They are separated because the Gemini secret must never be bundled into the client, and the preview needs a JavaScript/Node runtime that can install and execute a React app.

## Detailed generation flow

1. **User prompt.** React collects an app request and copies current files as context. Zap is the only generation path, and it uses the server-side Gemini adapter.
2. **Backend validates and protects.** Express checks same-origin requests, prompt length, file count, file sizes, and safe paths. Production requests must pass Cloudflare Turnstile server verification, a per-IP security-check limit, a Redis-backed atomic quota check, and a per-browser concurrency lock.
3. **Zap generates artifacts.** `server/prompts.js` instructs the Gemini model to return structured file operations. No fallback template generator exists.
4. **Node streams NDJSON.** The backend emits `start`, many `chunk` events, `done` and error events. This hides Gemini-specific SSE events from the UI.
5. **Incremental parsing.** The browser's `StreamingArtifactParser.push(text)` buffers partial tags. When a full action closes, it uses the recursive parser and produces a typed action. JSX inside `<file>` stays raw text.
6. **Virtual filesystem applies complete results.** The source files are a plain object (`{ 'src/App.jsx': '...' }`). Generated changes are buffered and validated before replacing the current map, so a failed request leaves the previous app unchanged. `localStorage` autosaves the current map. The file browser and CodeMirror read directly from it.
7. **Runtime syncs files.** On Run, WebContainer boots once, mounts the VFS as nested directories, installs dependencies with npm, and starts Vite. After Run, changed files are written with `fs.writeFile` and deleted paths use `fs.rm`. Vite HMR updates the iframe.

## Why use a custom recursive XML parser?

The language model generates a tree of operations (`artifact` → `file` / `message` / `delete`). Recursive descent makes nesting easy to understand; an incremental buffer handles stream boundaries **without assuming HTTP chunk == complete tag**. The protocol keeps code as raw body text so JSX angle brackets aren't mistaken for XML tags. Contrast: JSON is strict about quotes and escaping multiline code; diffs are harder to safely apply. A production-grade version could use structured tool outputs with schemas or length-prefixed file blocks.

## Data structures

The VFS is a JavaScript object keyed by relative POSIX paths. This makes applying file operations and React state updates trivial. At WebContainer mount time `toMountTree(files)` builds the recursive directory structure required by the WebContainers API. Paths are checked to exclude absolute paths, `..`, `.env`, `node_modules` and `.git` segments.

## Why WebContainers?

WebContainers run an actual npm/Vite development process in the user's supported browser instead of rendering code samples as HTML strings. `server-ready` provides a preview URL. This means npm dependencies, React state and dev-server HMR work inside the preview. It requires cross-origin isolation and a compatible browser; it isn't identical to a full VM or a security-audited sandbox.

## Backend security and limits

- **GET `/api/health`** returns readiness, a plain-language message, the public Turnstile site key, and model name. It never returns any server secret.
- **POST `/api/generate`** accepts `{prompt, files, turnstileToken}` and streams newline-delimited JSON. The Gemini key is read only by Express.
- **Client cancel** uses `AbortController`; Express aborts the upstream Gemini fetch when the client connection closes.
- **Gemini adapter** in `server/gemini.js` calls the official REST streaming endpoint using Node.js `fetch`, with the key in the `x-goog-api-key` header. The key comes from `process.env.GEMINI_API_KEY`, and never reaches the React client.
- **Anonymous identity**: Express issues a signed, HttpOnly, Secure, SameSite cookie. It stores no raw IP address; IP quota keys are HMAC hashes of Render's Cloudflare `CF-Connecting-IP` value. Production fails closed if that trusted edge header is missing.
- **Bot check**: React requests a Turnstile token only after a visitor clicks Build. Express validates the token with Cloudflare's Siteverify endpoint, checks the `build` action and request hostname, and fails closed if verification is unavailable.
- **Shared limits**: Redis enforces 12 verification attempts per IP per 10 minutes, 4 builds/IP/hour, 10 builds/IP/UTC day, 5 builds/browser/UTC day, 8 builds globally/hour, and 25 builds globally/UTC day. Redis Lua scripts check and increment limits atomically; a lock prevents concurrent generations from one browser. Every started generation counts, including ones that fail upstream.
- **Runtime bounds**: prompts are at most 2,000 characters, project files keep the existing 80-file/200 KB-per-file/800 KB total limits, model output is capped at 8,192 tokens, and each generation is stopped after three minutes.
- **Fail closed**: production requires `GEMINI_API_KEY`, `REDIS_URL`, a 32-byte `SESSION_SECRET`, and both Turnstile keys. Missing or unavailable controls disable only generation; the editor and WebContainers preview remain usable.
- **Local development**: uses a process-local limiter and skips the Turnstile challenge. Do not expose that local configuration to the internet.

## Design tradeoffs and improvements

| Current MVP decision | Benefit | Future improvement |
| --- | --- | --- |
| Plain object VFS | Simple, transparent | Incremental versioned filesystem |
| localStorage persistence | No login/database | IndexedDB or cloud workspaces |
| Raw XML file bodies | Easy to inspect | Escaped/length-prefixed structured tool outputs |
| Generated changes are committed after successful validation | Failed generations don't overwrite working files | Add undo/rollback and version history |
| Browser WebContainers | No remote VMs | Remote builds for unsupported browsers |
| Anonymous public demo | No owner code or sign-in needed; server enforces per-browser, per-IP and shared limits | Add sign-in and per-account quotas before sustained public use |
| Redis-backed quota store | Limits survive app restarts and are shared across instances | Add monitoring/alerts and choose a persistent Render plan |
| Cloudflare Turnstile | Blocks basic automated abuse; server verifies one-use tokens | Add adaptive risk scoring and account reputation at larger scale |
| Direct source edit -> HMR | Instant feedback | Debounced compiler diagnostics and dependency graph |

## Honest boundaries

This repo supports React/Vite web apps, not every language or framework. It doesn't include multiplayer editing, terminal input, git push inside the UI, cloud workspaces, guaranteed generation correctness, or a production-strength security review. Anonymous quotas are meant for a small demo; account sign-in is the next step for sustained public use. Source generated by an LLM and third-party dependencies must be reviewed before executing.
