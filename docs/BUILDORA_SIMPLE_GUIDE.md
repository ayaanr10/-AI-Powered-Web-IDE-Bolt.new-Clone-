# Buildora — simple interview walkthrough

## What is Buildora?

Buildora is an educational AI-powered web IDE. A user describes an app in English, Buildora creates or edits React files, and the user can inspect the code and run a live preview. It is an MVP, not a complete replacement for Bolt.new.

## The two screens

1. **Home:** one prompt box, three example ideas, and a Zap availability badge. There is no mode selector.
2. **Workspace:** a file sidebar on the left, a prompt box at the top, and two white panels for editable code and live preview. The Activity dropdown reveals AI responses. Import, export, logs, and reset stay secondary controls.

The home/workspace switch is one ordinary React state variable in `src/App.jsx`:

```jsx
const [screen, setScreen] = useState('home');
```

When a user generates an app, `generate()` changes that state to `workspace`. The backend and preview features are reused, not duplicated.

## Explain the request flow in six steps

1. **Input:** User types an idea into the React UI in `src/App.jsx`.
2. **API request:** `generateStream()` in `src/lib/api.js` POSTs the prompt to the Express server.
3. **Generation:** Zap asks Gemini to generate source-file changes through the Express server. The Gemini API key stays on the server, not in React.
4. **Parsing:** `StreamingArtifactParser` converts streamed text into file actions (for example, create or update `src/App.jsx`).
5. **Files:** React state holds the editable files, and browser localStorage saves the workspace on the same browser.
6. **Preview:** `useWebContainer()` starts a browser-based Node.js runtime, installs dependencies, launches Vite, and shows the app in an iframe.

## A short interview answer

"Buildora is a React and Node.js project that converts natural-language instructions into editable web apps. The frontend sends a prompt to an Express endpoint. The backend streams a response from Gemini through the Zap generator. A parser converts the response into file changes. React stores these files, CodeMirror lets users edit them, and WebContainers run the generated Vite application inside the browser. I kept the UI simple with two React states: a home page and a workspace."

## What is intentionally simple?

- Plain React components and `useState`, not a global state-management library.
- One white-and-blue CSS stylesheet, not a UI framework or design system.
- The UI redesign changes presentation without replacing generation, storage, or the runtime.
- A clear, manual **Run app** button so users understand when the preview starts.
- No fake Share, Deploy, Components, or Templates buttons: visible actions actually perform a function.

## Important honesty points

- **Zap** is Buildora's only AI-generation option. It uses the private server-side Gemini integration.
- Zap requires a supported model and a working API key; if the server is unavailable, the UI explains why generation is disabled.
- **WebContainers** run in compatible browsers with cross-origin isolation; not every browser supports them.
- The project stores files in browser localStorage, not a cloud database.
- It is designed for learning and local use; production hosting would require stronger authentication, security, storage, and billing controls.

## How to test on your computer

```bash
npm install
npm run dev
```

Visit `http://localhost:5173` using Chrome or Edge.

1. Add a private Gemini API key to the local `.env`, restart the server, and confirm Zap shows **Ready**.
2. Click **Restaurant website**, or describe a custom app, to ask Zap to generate the code.
3. Click **Run app** and check the preview.
4. Edit a file in CodeMirror; see whether the preview updates.
5. Export the project.
6. Try an AI follow-up such as changing the theme, and check the files update.

For code-only checks:

```bash
npm run check
```

See `docs/ARCHITECTURE.md` for deeper explanations when you're ready.
