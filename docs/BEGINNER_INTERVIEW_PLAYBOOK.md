# Buildora — beginner interview playbook

Use this alongside the real repository. **The goal is understanding, not memorizing a story.**

## What Buildora solves

Making even a small React web app normally means setting up source files, installing dependencies, writing components, running the application, and debugging. Buildora aims to shorten the **idea-to-prototype** loop: a user describes an app in plain English, Zap generates file changes, and the user edits and previews the result in the browser.

**Scope:** educational MVP. It is not a production competitor to Bolt.new, does not train its own AI model, does not deploy generated websites for customers, and does not provide cloud accounts or shared workspaces. Public demo generation is anonymous and has strict per-browser, per-network, and shared daily limits.

## Say this in 40–60 seconds (adapt to your own words)

> Buildora is an AI-assisted React IDE. You describe the website you want, and the frontend sends your request to a Node/Express backend. The backend validates it and calls the Gemini API using a private server-side key. It streams the model's structured response to the browser. A custom parser converts that into file operations; React stores the files and CodeMirror allows edits. When you click Run app, WebContainers starts a Node-compatible environment in the browser, installs dependencies, runs Vite, and displays the preview. This is an MVP for making a quick, editable prototype, not an online code-hosting platform.

If you did not personally implement a component, say you studied/modified/tested it rather than claiming authorship. Show the code confidently.

## Trace one prompt across seven files

| Step | File | What to point out |
| --- | --- | --- |
| 1. Input | `src/App.jsx` | `prompt` is React state; `generate()` handles the request |
| 2. HTTP | `src/lib/api.js` | `fetch('/api/generate')`, POST JSON, read NDJSON chunks |
| 3. Backend | `server/index.js` | Validate prompt/files, check Turnstile and demo quotas, stream response |
| 4. Model | `server/gemini.js` | Call Gemini's streaming REST endpoint using server-side `GEMINI_API_KEY`; parse SSE |
| 5. Parsing | `shared/artifact-parser.js` | Buffer incomplete tags, output file/delete/message actions |
| 6. Workspace | `src/App.jsx`, `shared/filesystem.js` | Validate and apply complete changes to `files`, autosave to browser localStorage |
| 7. Preview | `src/lib/useWebContainer.js` | Mount files, npm install, Vite startup, iframe preview and live changes |

**Explain the difference:** SSE is the model-to-backend streaming format. The backend forwards simplified **NDJSON** (one JSON event per line) to the browser. The parser receives streamed text, **not** one fully complete React app each time.

## Five concepts explained simply

**1. React state:** A variable that updates the interface when it changes. `files` is an object of filename → source code; `prompt` holds the text typed by the user.

**2. API route:** `/api/generate` is a function exposed over HTTP. React doesn't contact Gemini with a key. It asks the backend, which owns the private key.

**3. Streaming:** Instead of waiting for the whole answer, pieces arrive gradually. The frontend can display progress, but incomplete file operations are not committed.

**4. Parser and VFS:** The AI outputs text describing file operations. The parser identifies the path/content; the virtual filesystem is an ordinary JavaScript object storing these files. It is not the laptop's filesystem.

**5. WebContainers:** An in-browser Node-compatible runtime, separate from the Express backend. It runs the *generated app* using npm and Vite. The hosted Render server runs Buildora itself.

## Three essential snippets to understand

**Frontend → backend**

```js
fetch('/api/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt, files })
});
```

On Render, the real client sends a short-lived Turnstile token after the visitor clicks Build. The backend verifies it with Cloudflare; the Gemini API key stays only on the server.

**Virtual files**

```js
const files = {
  'src/App.jsx': 'export default function App() { return <h1>Hello</h1> }',
  'src/styles.css': 'h1 { color: blue; }'
};
```

**Applying a generated file change**

```js
const updated = { ...files };
updated['src/App.jsx'] = newCode;
```

The real code also parses, validates, and waits until generation completes before applying changes.

## A real demo checklist (do not skip)

- [ ] Open Render service; latest deployed commit is green/Live
- [ ] Open `https://buildora-ide-demo.onrender.com/api/health`; `zapAvailable` is `true` and no server secret appears in the response
- [ ] Check `GEMINI_MODEL` is an active model accessible to your key (e.g. `gemini-3.8-flash`, if your key supports it)
- [ ] Open Buildora in desktop Chrome or Edge and click Build now; complete the bot check if it appears
- [ ] Prompt: "Build a simple counter with + and - buttons"
- [ ] See generated/updated files, then click **Run app**
- [ ] Confirm the app preview responds to clicks
- [ ] Change a CSS property and verify the running preview updates
- [ ] Export source ZIP
- [ ] If any step fails, note the exact error and don't claim the end-to-end flow worked

**Safety:** Keep the Gemini key on Express, use server-verified Turnstile, and enforce small server-side demo quotas. These counters live in process memory and reset when Render restarts, so they are suitable for a small demo only. Use Google's free Gemini tier if you cannot pay; app quotas are not a billing guarantee. Sustained access should add sign-in and durable per-account limits.

## Ten questions interviewers can ask

**Q1. What problem does Buildora solve?** Faster creation of an editable React prototype from a natural-language request.

**Q2. Is Zap your own trained LLM?** No. Zap is a name for the AI-generation flow powered by Google's Gemini API.

**Q3. Why Express?** It validates input, keeps the Gemini key private, verifies Turnstile, enforces shared server-side quotas, and streams the model output.

**Q4. Why not put the API key in React?** Anyone can inspect frontend source/bundles and obtain it.

**Q5. What is a virtual filesystem?** A plain object that maps file paths to contents before mounting them in a runtime.

**Q6. Why not directly render Gemini's text?** Text may represent multiple files, partial chunks, or malformed operations. Parsing and path checks let us apply structured changes.

**Q7. What if Gemini stops halfway?** Pending changes aren't committed; the last working file set is preserved. The UI reports an error.

**Q8. What are WebContainers?** A Node-compatible runtime inside a supported browser; generated React apps run there, not in the Express API process.

**Q9. How does a CSS edit reach the preview?** React updates `files`; `wc.sync` writes changed paths to WebContainer's filesystem; Vite HMR refreshes the app.

**Q10. What are your limitations?** Single-browser localStorage, no account/cloud sync, not hardened for arbitrary untrusted packages, and anonymous IP/browser quotas instead of per-account limits. Sign-in is the next step for sustained public access.

## If interviewer goes deeper

**Why an XML-like protocol?** It separates message/file/delete actions and can carry raw multiline JSX. Its weakness: a literal `</file>` in generated source can confuse the delimiter parser. A stronger future approach is schema-validated structured output.

**What does `FALSE` or exact matching have to do with Buildora?** Nothing directly: that's an Excel lookup concept, not used by this project.

**What would you improve first?** Reliable E2E browser tests, sign-in with per-account quotas, more robust structured output, undo/versions, and cloud persistence.

## Your study exercise

Explain these three questions without reading: *What is Buildora? Why does it need a backend? How are generated files shown as a running website?* Then open the relevant file and locate the function for each answer.

For a deeper guide, see `docs/ARCHITECTURE.md` and `docs/INTERVIEW_GUIDE.md`.
