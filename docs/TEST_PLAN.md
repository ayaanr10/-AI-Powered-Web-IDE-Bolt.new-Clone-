# Test plan and validation status

## Unit tests (available without installing packages)

Run: `node --test tests/*.test.js`

Tests cover:

- Recursive XML tree and source-code raw text preservation
- 1-, 2-, 7-, 26-, 99-character streaming boundaries
- Multiple action tags and self-closing delete
- Invalid path traversal and `.env` rejection
- Truncated/malformed responses
- Immutable file application and nested WebContainer mount tree
- File count/size limits
- Fully parseable task-manager and landing-page demo artifacts

## Manual browser integration test (run after `npm install`)

- [ ] `npm run dev` launches Vite on 5173 and API on 3001.
- [ ] `GET http://localhost:3001/api/health` returns `ok: true`.
- [ ] In demo mode, click **Task manager**; file tree and editor show new JSX/CSS.
- [ ] Click **Run project**; inspect terminal install/start logs.
- [ ] WebContainer emits server-ready, and preview displays interactive app.
- [ ] Add/check/delete a task in iframe; see UI update.
- [ ] Edit text in `src/App.jsx`, check HMR reflects edit.
- [ ] Export ZIP, unzip locally, inspect `src/App.jsx`.
- [ ] Refresh browser and check current file contents persisted.
- [ ] Import previously exported ZIP, then Restart runtime.
- [ ] In Live mode with key, ask for a minor change and inspect streamed edits.
- [ ] Check the API key is absent from browser DevTools source/network payloads.

## Validation of this delivered package

Unit tests now include the Gemini SSE adapter and parser, with synthetic SSE fixtures (no real API key or network required). The package registry could not be reached (`npm` reported DNS `EAI_AGAIN`), so dependency installation, `npm run build`, and browser/WebContainer end-to-end testing **were not completed in this environment**. These checks must be run on your computer before claiming the full app is tested.

## Negative-path manual tests

- Enter a blank prompt; Generate remains disabled.
- Select Live without an API key; see helpful backend error.
- Try to add a file named `../private`; editor rejects it.
- Give a malformed ZIP; import shows a descriptive error.
- Deliberately break `src/App.jsx`; preview should show Vite diagnostic output.
- Click Restart after changing `package.json` to ensure npm reinstallation.
