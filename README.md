# Buildora — an AI-powered React IDE

**A beginner-friendly, interview-explainable full-stack project.** Turn a natural-language request into editable, multi-file React applications. The system streams Gemini's output through an XML-like artifact parser, updates a virtual filesystem, and runs the generated app inside the browser using WebContainers.

This is an **original educational project inspired by the category of tools such as Bolt.new**, not a copy of their source or a production-equivalent replacement.

## The new, simpler interface

- **Home page:** describe an app or choose an example.
- **Workspace:** AI chat, editable code, and live preview in clear sections.
- **Advanced controls:** logs, import/export and reset stay available without cluttering the home screen.

Start with the [simple Buildora walkthrough](docs/BUILDORA_SIMPLE_GUIDE.md) before reading the full architecture docs.

## Deploy Buildora (public preview)

**[Deploy to Render](https://render.com/deploy?repo=https://github.com/ayaanr10/-AI-Powered-Web-IDE-Bolt.new-Clone-)**

This link uses the included `render.yaml` Blueprint to create the Buildora web service. **Zap is the only generator.** The interface is public; generation becomes available after the server has the private Gemini key and free Cloudflare Turnstile settings. No paid database or extra hosting service is required.

See [step-by-step Render deployment](docs/DEPLOY_RENDER.md). After Render shows **Live**, open the URL assigned to your service. The public URL is not known until you complete deployment in your Render account.

## What works

- **Natural language → React source files.** Google Gemini API integration, streamed through a **Node/Express backend** so the API key never goes to the browser.
- **Streaming structured output.** Custom recursive XML-like parser that tolerates arbitrary chunk boundaries and recognizes `file`, `delete`, and `message` actions.
- **Editable virtual filesystem.** Folder tree, source editing with syntax highlighting, new/delete files, live HMR sync, local autosave, import/export ZIP.
- **Actual browser runtime.** WebContainers boot Node.js inside the browser, install packages, start Vite, and display the running app in an iframe; terminal shows process output.
- **Zap-only generation.** Every generation request calls the server-side Gemini adapter. No template generation or demo-mode fallback.
- **Demo generation safeguards.** Same-origin checks, server-verified Turnstile, signed anonymous browser IDs, and strict per-network/browser/app limits protect the free demo. The counters are in memory and reset when Render restarts; this is for a small portfolio demo.
- **Tests and documentation.** Node built-in tests for parser boundaries, file-path safety, server validation, and Gemini adapter retries.

**Scope:** A usable educational **MVP**, not all of Bolt.new. This does not include collaboration, account sign-in, cloud workspaces, billing, or an audited sandbox. Public use is anonymous and tightly capped; sustained access should add sign-in and per-account quotas. Preview uses the browser-native WebContainers runtime, not a remotely hosted VM.

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

For **Zap generation**, put your private Google AI Studio API key in your local `.env` file:

```dotenv
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-3.8-flash
PORT=3001
```

The default model name is configurable: use a model ID that your Google AI Studio project can access. An eligible free tier may be available for this model; check the quotas and billing status for your Google AI Studio project before making requests.

Start everything with one command:

```bash
npm run dev
```

Open **http://localhost:5173**. The API runs privately at `127.0.0.1:3001` and is proxied by Vite.

### First local Zap run

1. Run `npm run dev` and open `http://localhost:5173`.
2. The generation badge says **Zap · Ready** when the local server detects the API key. If it says **Unavailable**, check the private `.env` and restart.
3. Describe an app such as "Build a restaurant website with a menu and reservation form" and press **Build now**. The backend calls the Gemini API through **Zap**; it never sends the key to the browser.
4. Check the generated source in **Code**, then click **Run app**. The browser installs dependencies and launches the generated React app in the preview.
5. Edit `src/styles.css` and see live changes, or choose **Export code** to download source files.

### Updating generated apps

Ask Zap for a follow-up change such as "Make the hero section violet". It sends current source files as context, and the parser applies valid changes only after the response completes. Files not mentioned in the response remain unchanged.

**Note:** After switching `.env`, stop and restart `npm run dev`; the front-end model label does not change until the page refreshes.

**Note:** LLM-generated source can contain bugs or missing dependencies. If generated `package.json` changes, click **Restart** (refresh-circle button) to reinstall. Review code before executing any dependencies from untrusted sources. A Gemini API key is not included. Never paste your key in chat, front-end code, or GitHub.

### Update from the earlier Claude version

If you previously downloaded Buildora, extract this Gemini edition to a **new folder** (or back up the old folder first). Do not just paste a new key into the old project: the original backend calls Anthropic, not Google. Your existing workspace is stored locally by the browser under the same localhost origin and may still appear; use the **Reset** action if you want a clean project.

## Architecture

```text
React interface (Vite localhost:5173)
  Chat prompt ─POST /api/generate──────────┐
        ▲                                  │
        │ NDJSON chunks                    ▼
        │                         Express API (port 3001)
        │                           └─ Zap generator (private Gemini REST adapter + key)
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
| `server/index.js` | Express routes, request validation, shared usage limits, NDJSON transport |
| `server/security.js` | Signed anonymous browser cookies, same-origin checks, Turnstile verification |
| `server/usage-store.js` | Bounded in-memory demo quota counters and per-browser generation locks |
| `server/gemini.js` | Provider adapter: Gemini SSE streaming, errors, and aborts |
| `server/prompts.js` | System protocol prompt and bounded workspace context |
| `shared/artifact-parser.js` | Recursive parser + incremental action extraction |
| `shared/filesystem.js` | VFS, path protection, size limits, mount conversion |
| `shared/seed-project.js` | Starter React + Vite project |
| `tests/` | Unit tests with Node's `node:test` |
| `docs/` | Architecture, interview walkthrough, test plan |

## Commands

```bash
npm run dev       # API + Vite dev server
npm run test      # parser, filesystem, server and Gemini adapter tests
npm run build     # production frontend build
npm run check     # tests + build
npm run preview   # Vite frontend preview (API must be running separately)
```

## Browser and hosting caveats

WebContainers require `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless` (or `require-corp`) so the browser exposes `SharedArrayBuffer`. `vite.config.js` sets those development and preview headers. **Open via localhost/HTTPS, never `file://`.** Desktop Chromium is the primary supported environment; third-party cookie restrictions and browser extensions can interfere. When deploying the front end, configure the **same headers** on the hosting service and provide a secure backend for `/api`.

Local and Render demo quotas use process memory. They limit requests while the service is running, and reset on a restart or redeploy. Turnstile provides a free bot check. These safeguards make a small portfolio demo practical, not a high-traffic service or a hard billing cap. Keep your Gemini key on an eligible free-tier project if you cannot pay; Google controls model availability, quotas, and billing. Generated projects still run in the user's browser; this project is not a security-audited sandbox.

## Troubleshooting

| Problem | Try this |
| --- | --- |
| Preview says cross-origin isolation missing | Use Chrome/Edge at `http://localhost:5173`, ensure Vite sets COOP/COEP, disable interfering extensions |
| "Live AI needs GEMINI_API_KEY" | Put the key in `.env` and restart `npm run dev` (never in browser `VITE_*` variables) |
| Public Render generation is unavailable | Follow [Render setup](docs/DEPLOY_RENDER.md) and add both Turnstile keys; the Gemini key must also be present on the server |
| Build limit reached | Per-browser, per-network, and shared app quotas reset daily at UTC midnight or when Render restarts; Gemini may also enforce project-level limits |
| Preview install fails | Open Terminal, verify internet/npm availability and valid dependencies; then Restart |
| Changes don't appear | Confirm runtime status is Ready; Restart after editing `package.json` |
| Imported project has missing images | ZIP imports intentionally support **text-based Vite project files**, not binary assets |
| AI returned incomplete artifact | Retry with a smaller request or ask for fewer files; streaming parser intentionally rejects incomplete output |

## Prepare to demonstrate Buildora

Start with the [Beginner interview playbook](docs/BEGINNER_INTERVIEW_PLAYBOOK.md): follow a prompt from React to Gemini, explain why the parser and virtual filesystem exist, test the deployed Zap flow, and practise common interviewer follow-ups. Do not claim a live Gemini demo has passed until you personally see files generated and previewed.

## Interview and GitHub

Start with the [Windows Gemini setup guide](docs/GEMINI_SETUP_WINDOWS.md), then read [Architecture](docs/ARCHITECTURE.md), [Interview Guide](docs/INTERVIEW_GUIDE.md), [Testing](docs/TEST_PLAN.md), and [GitHub Push Guide](docs/GITHUB_PUSH.md). Do not claim you have personally deployed or production-tested features you haven't actually run.

## Gemini provider design

`server/gemini.js` uses Node's built-in `fetch` against Google's official SSE endpoint. This intentionally avoids an additional SDK dependency, making the streaming protocol easier to explain in interviews. Gemini SSE frames are converted to plain text, then Express sends provider-independent NDJSON to React. The key remains solely in `.env` on the local backend. `tests/gemini.test.js` verifies split SSE frames and errors without making real paid requests.

## Sources used to select APIs

- [WebContainer API](https://webcontainers.io/api) and [COOP/COEP headers](https://webcontainers.io/guides/configuring-headers)
- [Gemini streaming REST API](https://ai.google.dev/api/generate-content) and [Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Cloudflare Turnstile server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- [Render private networking](https://render.com/docs/private-network) and [Key Value](https://render.com/docs/key-value)
- [Google Cloud Gemini API spend caps](https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps)

## License

MIT. See [LICENSE](LICENSE).
