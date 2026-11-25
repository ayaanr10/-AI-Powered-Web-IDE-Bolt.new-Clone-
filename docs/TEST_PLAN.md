# Buildora test plan

## Automated checks

Run:

```bash
npm run check
```

This runs the Node test suite and Vite production build. Tests cover:

- Incremental artifact parsing across arbitrary network chunk boundaries
- File and directory safety, file-count limits, and WebContainer mount trees
- Gemini SSE parsing, 503 retry/backoff, output limits, and provider errors
- Turnstile server verification, signed browser identity, and same-origin checks
- Production fail-closed behavior when Turnstile or Gemini is missing
- Atomic rate and daily quota behavior, request locks, quota error messages, and Gemini error handling
- API-key non-disclosure and the absence of owner-code headers in the client

No tests call a real Gemini API, Cloudflare account, or Render service.

## Manual local checklist

- [ ] `npm run dev` starts Express on 3001 and Vite on 5173.
- [ ] With a local `GEMINI_API_KEY`, `/api/health` returns `zapAvailable: true` without exposing the key.
- [ ] The home screen shows Zap as Ready; no access-code field or Locked/Code entered status appears.
- [ ] Click Build now with a restaurant prompt; Gemini streams output and the existing parser updates files.
- [ ] Click Run app and check the WebContainer preview.
- [ ] Edit CSS and confirm Vite HMR refreshes the preview.
- [ ] Export a ZIP, import a project, then restart its preview.
- [ ] Confirm the API key never appears in browser requests or the Vite bundle.

## Free demo checks before enabling public builds

- [ ] Keep the existing free Render web service; no paid database or cache is needed.
- [ ] Add the Gemini key only to Render's server environment.
- [ ] Configure a free Cloudflare Turnstile widget for the live hostname; set its site key and secret in Render.
- [ ] Confirm the Gemini key uses an eligible free-tier model/project if the demo must not incur charges.
- [ ] Confirm `/api/health` returns `zapAvailable: true`; no server secret should appear in its JSON.
- [ ] Submit without a Turnstile token and confirm the backend rejects the request before Gemini.
- [ ] Submit with a valid token and confirm one build succeeds.
- [ ] Repeat until an IP/browser limit is reached; confirm HTTP 429 and a clear retry message.
- [ ] Use an invalid/expired Turnstile token and confirm it is rejected.
- [ ] Check Render logs and browser network traffic for secrets; none should appear.

**Limit:** Automated tests prove code behavior with fakes, not that the live Turnstile widget, Gemini key, free-tier quota, or deployed Render service are configured correctly. In-memory limits reset on a Render restart and are not a hard billing cap.
