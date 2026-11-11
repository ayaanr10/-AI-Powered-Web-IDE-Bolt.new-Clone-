# Architecture notes (how the project works)

## Core idea

PromptForge has **two kinds of execution**. The **Express API server** runs on your own laptop and holds the private API key. The **generated user's application** runs inside WebContainers in the browser. They are separated because the Gemini secret must never be bundled into the client, and the preview needs a JavaScript/Node runtime that can install and execute a React app.

## Detailed generation flow

1. **User prompt.** React collects the request and copies the current file map as context. The default demo mode works offline from the AI provider (although dependencies still need internet to install).
2. **Backend validates.** Express checks text length, mode, file count, file sizes and paths. A simple IP-based limiter protects the local endpoint from accidental excessive use.
3. **Gemini or demo produces artifacts.** `server/prompts.js` instructs Gemini to output a small XML-like grammar. The demo generator returns equivalent artifacts without a paid API call.
4. **Node streams NDJSON.** The backend emits `start`, many `chunk` events, `done` and error events. This hides Gemini-specific SSE events from the UI.
5. **Incremental parsing.** The browser's `StreamingArtifactParser.push(text)` buffers partial tags. When a full action closes, it uses the recursive parser and produces a typed action. JSX inside `<file>` stays raw text.
6. **Virtual filesystem applies actions.** The source files are a plain object (`{ 'src/App.jsx': '...' }`). A file action replaces one file; a delete action removes it. Other files stay intact. `localStorage` autosaves the current map. The file browser and CodeMirror read directly from it.
7. **Runtime syncs files.** On Run, WebContainer boots once, mounts the VFS as nested directories, installs dependencies with npm, and starts Vite. After Run, changed files are written with `fs.writeFile` and deleted paths use `fs.rm`. Vite HMR updates the iframe.

## Why use a custom recursive XML parser?

The language model generates a tree of operations (`artifact` → `file` / `message` / `delete`). Recursive descent makes nesting easy to understand; an incremental buffer handles stream boundaries **without assuming HTTP chunk == complete tag**. The protocol keeps code as raw body text so JSX angle brackets aren't mistaken for XML tags. Contrast: JSON is strict about quotes and escaping multiline code; diffs are harder to safely apply. A production-grade version could use structured tool outputs with schemas or length-prefixed file blocks.

## Data structures

The VFS is a JavaScript object keyed by relative POSIX paths. This makes applying file operations and React state updates trivial. At WebContainer mount time `toMountTree(files)` builds the recursive directory structure required by the WebContainers API. Paths are checked to exclude absolute paths, `..`, `.env`, `node_modules` and `.git` segments.

## Why WebContainers?

WebContainers run an actual npm/Vite development process in the user's supported browser instead of rendering code samples as HTML strings. `server-ready` provides a preview URL. This means npm dependencies, React state and dev-server HMR work inside the preview. It requires cross-origin isolation and a compatible browser; it isn't identical to a full VM or a security-audited sandbox.

## Backend details

- **GET `/api/health`** returns `{ok, liveAvailable, model}` (no key value).
- **POST `/api/generate`** accepts `{prompt, files, mode}` and returns newline-delimited JSON. `mode` can be `demo` or `live`.
- **Client cancel** uses `AbortController`; Express aborts the upstream Gemini fetch when the client connection closes.
- **Gemini adapter** in `server/gemini.js` calls the official REST streaming endpoint using Node.js `fetch`, with the key in the `x-goog-api-key` header. The key comes from `process.env.GEMINI_API_KEY`, and never reaches the React client.
- **Limits**: at most 80 files, 200 KB per file, 800 KB total source text, 2,000 characters per prompt, 12 requests per IP per five minutes (demo and live share this simple limiter).

## Design tradeoffs and improvements

| Current MVP decision | Benefit | Future improvement |
| --- | --- | --- |
| Plain object VFS | Simple, transparent | Incremental versioned filesystem |
| localStorage persistence | No login/database | IndexedDB or cloud workspaces |
| Raw XML file bodies | Easy to inspect | Escaped/length-prefixed structured tool outputs |
| Gemini output is applied after a full file action | Avoids writing partial source | Transactional preview/rollback |
| Demo generator uses fixed templates | Easy offline-for-AI demonstration | More fixtures and snapshot tests |
| Browser WebContainers | No remote VMs | Remote builds for unsupported browsers |
| Single user / local Express | Simple security boundary | Auth, distributed throttling, audit logs |
| Direct source edit -> HMR | Instant feedback | Debounced compiler diagnostics and dependency graph |

## Honest boundaries

This repo supports React/Vite web apps, not every language or framework. It doesn't include multiplayer editing, terminal input, git push inside the UI, cloud hosting, guaranteed generation correctness, or a production-strength security review. Source generated by an LLM and third-party dependencies must be reviewed before executing.
