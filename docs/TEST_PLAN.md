# Buildora — Zap-only test plan

## Automated tests

Run `npm run check`. This runs Node's built-in tests and the Vite production build.

Tests cover:
- Incremental artifact parsing across arbitrary network chunk boundaries
- File and directory safety, including path traversal rejection
- File size and count limits, and WebContainer mount trees
- Gemini SSE parsing, 503 retry/backoff and non-retryable errors
- Express `/api/health`, prompt validation, and rejection of obsolete demo requests

No tests send a real Gemini request or require a real API key.

## Manual local checklist

- [ ] `npm run dev` starts backend on 3001 and Vite on 5173.
- [ ] `/api/health` returns `zapAvailable:true` when the private key is configured.
- [ ] Buildora shows **Zap · Ready** and no Demo/Gemini selector.
- [ ] Enter a restaurant prompt. Generate calls Zap and updates the React source on success.
- [ ] If Gemini returns 503, error is visible and previous files remain unchanged.
- [ ] After a successful generation, click **Run app** and check WebContainer preview.
- [ ] Edit CSS and confirm Vite HMR refreshes the preview.
- [ ] Export code as ZIP and inspect the files.
- [ ] Refresh and confirm workspace localStorage persistence.
- [ ] Test ZIP import, then Restart app.
- [ ] Confirm the API key never appears in the browser's requests or bundled source.

## Negative paths

- [ ] No configured API key: Zap shows **Unavailable**, clearly explains setup, and Generate is disabled.
- [ ] Public Render deployment with `PUBLIC_ZAP_ENABLED=0`: Zap unavailable; starter editor and preview remain accessible.
- [ ] Malformed prompt or invalid file path: server rejects request.
- [ ] Obsolete request containing `mode:'demo'`: server rejects it, with no template generation.
- [ ] Broken generated import: Vite errors appear in logs without falsely reporting successful preview.

**Scope:** An automated test/build pass does not prove that a live Gemini request succeeded. Perform the browser checks with your own private key before presenting full AI generation as verified.
