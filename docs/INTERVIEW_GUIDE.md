# Interview defense guide

## 45-second project summary

> I worked on Buildora, a React and Node.js browser IDE that converts natural-language instructions into editable React apps. The Express backend streams output from Gemini through a REST SSE adapter without exposing the API key. I wrote a recursive XML-like parser with streaming support to turn its responses into file operations, which update a virtual filesystem. Then WebContainers installs dependencies, runs Vite directly in the browser, and sends the live preview back to the UI. I also worked on CodeMirror editing, local persistence, ZIP export, a Zap-only interface, and unit tests.

**Use your own words after you have run and understood it.** You should be able to point to the actual file in the repo for every item you mention.

## Three-minute walkthrough

1. **Problem** — Starting a new React project requires scaffolding, package installs, file creation and switching between an editor and terminal. The idea was to shorten the *idea-to-working-prototype* loop.
2. **Architecture** — React browser interface + Express API backend + Gemini REST adapter + custom parser + VFS + WebContainers. Draw the flow from the README diagram.
3. **Live Zap test** — Run locally with a private Gemini key. Ask Zap for a small restaurant site, show the generated files and preview, then edit a CSS rule and verify live updates. If Google is overloaded, explain the 503 retry behavior without claiming success.
4. **Hardest piece** — Parsing incremental LLM output. Demonstrate why a closing `</file>` marker might arrive split across 3 network chunks, and how the parser waits before applying the action. Show `tests/parser.test.js` testing chunk size 1.
5. **Engineering decisions** — API key only on server, controlled prompt size, path traversal checks, WebContainers cross-origin isolation, local persistence.
6. **Limitations** — Explain that raw `</file>` inside generated source is a protocol edge case, and that this MVP doesn't include cloud workspaces or deployment.

## Likely technical questions

**Q: Why not call Gemini directly from the React app?**

A: A frontend bundle is visible to the user, so a private API key must live on the backend. The Express server checks inputs and forwards text chunks to the UI.

**Q: What's the recursive XML parser?**

A: `parseXmlTree` traverses a parent artifact and recursively processes children. It treats the `file` tag as a leaf with raw code, while `StreamingArtifactParser` accumulates deltas and calls the parser only when a complete tag is present. It gives structured `{type, path, content}` actions.

**Q: What if one HTTP chunk ends with `<fi`?**

A: We hold that partial chunk in a buffer instead of trying to parse it. The next chunk fills in the tag. The tests use one-character chunks to catch boundary bugs.

**Q: What is a virtual filesystem here?**

A: A map of filenames to source text stored in React state. A helper converts it to the recursive directory structure WebContainer needs to mount files. It is independent of my operating system's real filesystem.

**Q: What runs the preview?**

A: WebContainer boots a Node-compatible process in a supported browser, mounts the files, calls `npm install`, launches the Vite dev server, then emits a server-ready URL for the iframe. `fs.writeFile` plus Vite HMR provides live updates.

**Q: Why can't you open it with file:// ?**

A: WebContainers needs SharedArrayBuffer/cross-origin isolation. The development server includes COOP/COEP headers; opening a file directly does not serve those headers.

**Q: What is Zap?**

A: Zap is the name of the generation experience inside Buildora. It calls Google's Gemini API through a private Express backend. The backend validates the request, streams the response, and the frontend parses and applies completed file changes. There is no demo-template fallback.

**Q: What security checks are included?**

A: Server-side input caps, a request limiter, private backend API key, generated-path validation that rejects `..` and `.env`, and isolated browser runtime requirements. It is **not** a security audit of arbitrary packages or generated code.

**Q: What breaks if Gemini's answer is incomplete?**

A: `finish()` throws on a truncated artifact. Buildora collects the proposed changes and commits them only after the stream finishes and the files validate, so the previous app is preserved if generation fails.

**Q: Why React state rather than a database?**

A: For a single-user local MVP, an object map and localStorage reduce complexity and make the data flow easy to test. Cloud collaboration would need stronger persistence and conflict resolution.

**Q: What would you improve with another month?**

A: Use schema-validated tool outputs instead of raw XML delimiters, add a versioned filesystem with undo/rollback, add a proper terminal input stream, include auth and durable rate limiting, and write end-to-end browser tests.

## Practice tasks before claiming ownership

- Implement a third action type such as `rename` and add chunk-boundary tests.
- Explain exactly what happens if you change `src/styles.css` after the preview is ready.
- Use the terminal logs to diagnose a deliberately broken `import` statement.
- Demonstrate `safePath('src/../.env') === false` and explain why the check belongs on both boundaries.
- Recreate a small piece (e.g. the file tree) without copying code.

## Accurate resume wording after YOU test it

**AI-Powered Web IDE | React, Node.js, Gemini API, WebContainers**

- Developed a prompt-to-React IDE that streams LLM-generated file operations into an editable virtual filesystem and in-browser live preview.
- Implemented an incremental XML-style parser, guarded file operations, CodeMirror editing, and WebContainer-based Vite execution.
- Added Zap-only generation, local project persistence, ZIP export and unit tests.

If you haven't tested the Gemini API with your own key, say **"Integrated the Gemini streaming REST adapter; live generation requires a configured API key"** rather than claiming you've observed successful live responses. Do not claim you wrote code yourself that you cannot explain.
