# PromptForge — an AI-powered React IDE

**A real, interview-explainable full-stack project.** Turn a natural-language request into editable, multi-file React applications. The system streams Gemini's output through an XML-like artifact parser, updates a virtual filesystem, and runs the generated app inside the browser using WebContainers.

This is an **original educational project inspired by the category of tools such as Bolt.new**, not a copy of their source or a production-equivalent replacement.

## What works

- **Natural language → React source files.** Google Gemini API integration, streamed through a **Node/Express backend** so the API key never goes to the browser.
- **Streaming structured output.** Custom recursive XML-like parser that tolerates arbitrary chunk boundaries and recognizes `file`, `delete`, and `message` actions.
- **Editable virtual filesystem.** Folder tree, source editing with syntax highlighting, new/delete files, live HMR sync, local autosave, import/export ZIP.
- **Actual browser runtime.** WebContainers boot Node.js inside the browser, install packages, start Vite, and display the running app in an iframe; terminal shows process output.
- **Demo mode with no account or key.** Deterministic templates (task manager + responsive landing page) exercise the **same streaming/parser/filesystem path** as Gemini.
- **Tests and documentation.** Node built-in tests for parser boundaries, file-path safety, mount structure and demo projects.

**Scope:** A usable local **MVP**, not all of Bolt.new. This does not include collaboration, authentication, production deployment, command-running AI agents, cloud persistence, billing, or an audited sandbox. Preview uses the browser-native WebContainers runtime, not a remotely hosted VM.

## Quick start

**Requirements:** Node.js 20.19+ (22+ recommended), npm, and **desktop Chrome/Edge**. Internet access is needed for first-time dependency installation and WebContainer npm packages.

```bash
npm install
```

Then copy the environment template:

```bash
# macOS/Linux
cp .env.example .env
# Windows PowerShell
# Copy-Item .env.example .env
```

For **demo mode**, leave `GEMINI_API_KEY` blank. For **real Gemini generation**, paste your own Google AI Studio API key in `.env`:

```dotenv
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-2.5-flash
PORT=3001
```

The default model name is configurable: use a model ID that your Google AI Studio project can access. An eligible free tier may be available for this model; check the quotas and billing status for your Google AI Studio project before making requests.

Start everything with one command:

```bash
npm run dev
```

Open **http://localhost:5173**. The API runs privately at `127.0.0.1:3001` and is proxied by Vite.

### First demo (no key)

1. Leave the mode on **Demo · no API key**.
2. Click **Task manager** or type "make a task manager" and press Enter.
3. Watch the source files appear/update in **Explorer**.
4. Click **Run project** in the preview pane. The browser installs dependencies and launches Vite. The first run requires network access and may take some time.
5. Toggle a task in the preview, then change a CSS color in `src/styles.css` and watch Vite HMR update the running app.
6. Click **Export code** to download a standalone Vite source project.

### Live AI generation

Put `GEMINI_API_KEY` in `.env`, **restart the backend** (`npm run dev`), select **Gemini · Live AI**, and request an app. The backend sends the current (bounded) workspace files to Gemini as context and streams structured changes back. You can ask follow-up prompts such as "Make the hero section violet"; files not mentioned in the response are preserved.

**Note:** After switching `.env`, stop and restart `npm run dev`; the front-end model label does not change until the page refreshes.

**Note:** LLM-generated source can contain bugs or missing dependencies. If generated `package.json` changes, click **Restart** (refresh-circle button) to reinstall. Review code before executing any dependencies from untrusted sources. A Gemini API key is not included. Never paste your key in chat, front-end code, or GitHub.

### Update from the earlier Claude version

If you previously downloaded PromptForge, extract this Gemini edition to a **new folder** (or back up the old folder first). Do not just paste a new key into the old project: the original backend calls Anthropic, not Google. Your existing workspace is stored locally by the browser under the same localhost origin and may still appear; use the **Reset** action if you want a clean project.

## Architecture

```text
React interface (Vite localhost:5173)
  Chat prompt ─POST /api/generate──────────┐
        ▲                                  │
        │ NDJSON chunks                    ▼
        │                         Express API (port 3001)
        │                           ├─ Demo generator (no key)
        │                           └─ Gemini streaming REST adapter (Gemini + key)
        ▼
StreamingArtifactParser  →  file/delete/message actions
        │
        ▼
Virtual filesystem object  →  localStorage
        ├── CodeMirror source editor
        ├── ZIP import/export
        └── WebContainer.fs.mount / writeFile / rm
                          │
                          ▼
              WebContainer npm install
                          │
                          ▼
               Vite server-ready event
                          │
                          ▼
               Live iframe + terminal
```

**Protocol example** (the code inside a `<file>` is raw, not escaped XML):

```xml
<artifact title="Counter">
  <message>Added a working counter.</message>
  <file path="src/App.jsx">
import React, { useState } from 'react';
export default function App() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}
  </file>
</artifact>
```

Parser notes: The outer artifact can nest child tags. `parseXmlTree` is **recursive descent**; `StreamingArtifactParser` buffers incomplete network chunks and calls it on complete actions. `<file>` bodies are handled as raw text, preserving JSX `<div>` tags. The protocol intentionally reserves literal `</file>` as a closing delimiter; production code would use a formally escaped or length-prefixed transport to eliminate that edge case. The parser validates paths and enforces file-size limits.

## Repository map

| Path | Responsibility |
| --- | --- |
| `src/App.jsx` | Workspace UI: chat, explorer, editor, preview, import/export |
| `src/lib/useWebContainer.js` | WebContainer boot, install, start, file sync, terminal logs |
| `src/lib/api.js` | Streaming newline-delimited JSON fetch client |
| `src/lib/archive.js` | ZIP import/export (client-side) |
| `server/index.js` | Express routes, request validation, rate limiting, NDJSON transport |
| `server/gemini.js` | Provider adapter: Gemini SSE streaming, errors, and aborts |
| `server/prompts.js` | System protocol prompt and bounded workspace context |
| `server/demo.js` | Fully editable demo apps using the same protocol |
| `shared/artifact-parser.js` | Recursive parser + incremental action extraction |
| `shared/filesystem.js` | VFS, path protection, size limits, mount conversion |
| `shared/seed-project.js` | Starter React + Vite project |
| `tests/` | Unit tests with Node's `node:test` |
| `docs/` | Architecture, interview walkthrough, test plan |

## Commands

```bash
npm run dev       # API + Vite dev server
npm run test      # parser, filesystem, demo and Gemini adapter tests
npm run build     # production frontend build
npm run check     # tests + build
npm run preview   # Vite frontend preview (API must be running separately)
```

## Browser and hosting caveats

WebContainers require `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless` (or `require-corp`) so the browser exposes `SharedArrayBuffer`. `vite.config.js` sets those development and preview headers. **Open via localhost/HTTPS, never `file://`.** Desktop Chromium is the primary supported environment; third-party cookie restrictions and browser extensions can interfere. When deploying the front end, configure the **same headers** on the hosting service and provide a secure backend for `/api`.

Local API requests are not user-authenticated; the server binds to loopback and uses a simple in-memory rate limiter. Do not publish this MVP as an unrestricted public AI API without authentication, durable rate limits, further sandbox security assessment, and billing protections.

## Troubleshooting

| Problem | Try this |
| --- | --- |
| Preview says cross-origin isolation missing | Use Chrome/Edge at `http://localhost:5173`, ensure Vite sets COOP/COEP, disable interfering extensions |
| "Live AI needs GEMINI_API_KEY" | Put the key in `.env` and restart `npm run dev` (never in browser `VITE_*` variables) |
| Preview install fails | Open Terminal, verify internet/npm availability and valid dependencies; then Restart |
| Changes don't appear | Confirm runtime status is Ready; Restart after editing `package.json` |
| Imported project has missing images | ZIP imports intentionally support **text-based Vite project files**, not binary assets |
| AI returned incomplete artifact | Retry with a smaller request or ask for fewer files; streaming parser intentionally rejects incomplete output |

## Interview and GitHub

Start with the [Windows Gemini setup guide](docs/GEMINI_SETUP_WINDOWS.md), then read [Architecture](docs/ARCHITECTURE.md), [Interview Guide](docs/INTERVIEW_GUIDE.md), [Testing](docs/TEST_PLAN.md), and [GitHub Push Guide](docs/GITHUB_PUSH.md). Do not claim you have personally deployed or production-tested features you haven't actually run.

## Gemini provider design

`server/gemini.js` uses Node's built-in `fetch` against Google's official SSE endpoint. This intentionally avoids an additional SDK dependency, making the streaming protocol easier to explain in interviews. Gemini SSE frames are converted to plain text, then Express sends provider-independent NDJSON to React. The key remains solely in `.env` on the local backend. `tests/gemini.test.js` verifies split SSE frames and errors without making real paid requests.

## Sources used to select APIs

- [WebContainer API](https://webcontainers.io/api) and [COOP/COEP headers](https://webcontainers.io/guides/configuring-headers)
- [Gemini streaming REST API](https://ai.google.dev/api/generate-content) and [Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Gemini streaming REST API](https://ai.google.dev/api/generate-content) and [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)

## License

MIT. See [LICENSE](LICENSE).
