# Buildora on Render — public preview

Buildora is a React frontend served by a Node/Express backend. The generated React preview runs with WebContainers in the browser. **Zap is the only generation option.** It uses the Gemini API on the server.

## Deploy the site

1. Use [Deploy to Render](https://render.com/deploy?repo=https://github.com/ayaanr10/-AI-Powered-Web-IDE-Bolt.new-Clone-), or open your existing Buildora Render service.
2. Review the settings in `render.yaml`, which builds React with Vite and starts `node server/index.js`.
3. Wait until Render shows **Live** and open its assigned URL.
4. The home page, editable starter files, import/export, and browser preview work without an AI key.

**Service naming:** The existing Render Blueprint still uses the historical service name `buildora-ide-demo` to avoid accidentally creating a second service. That name is not a generation mode, and no demo generator exists in the application.

## Enable Zap safely on your existing Render service

The site stays publicly visible, but generation requires a private code. Open the service's **Environment** tab:

| Name | Value |
| --- | --- |
| `GEMINI_API_KEY` | Your **private** Google AI Studio key |
| `GEMINI_MODEL` | `gemini-3.8-flash` (or another model your key can access) |
| `PUBLIC_ZAP_ENABLED` | `1` |
| `ZAP_ACCESS_CODE` | A unique randomly generated code of at least 16 characters |

Select **Save, rebuild, and deploy**. Never share these secrets in screenshots, GitHub, or chat.

Once live, a **Private Zap access code** field appears on the Buildora home and workspace screens. Enter your code, then click Build now. The React app sends this code over HTTPS to the same-origin Express API; the server checks it before calling Gemini. Missing or incorrect codes return HTTP 401. The code is kept only in React memory and is cleared on refresh.

The existing in-memory rate limiter adds basic protection but is not a substitute for strong authentication, durable per-user quotas or provider-side spending controls. This is a **private interview demo**, not an unrestricted public AI service. If the code is shared, disable Zap and change it.

If the code is absent, shorter than 16 characters, or `PUBLIC_ZAP_ENABLED=0`, production Zap remains disabled.

## Production architecture

```
GitHub -> Render builds frontend dist/ -> Express starts
Express serves React files + /api/health + /api/generate
React -> Zap prompt -> Express -> Gemini (private server key)
                 response -> artifact parser -> editable files
                 WebContainers -> npm + Vite -> preview iframe
```

The service binds to Render's `PORT` on `0.0.0.0`, while the local API uses `127.0.0.1:3001`. Cross-origin isolation headers for WebContainers are set by Express:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: credentialless`

## Troubleshooting

- **Zap shows Unavailable on Render:** Expected for the publicly accessible service.
- **Zap shows Unavailable locally:** Check `.env`, restart `npm run dev`, and inspect `http://localhost:5173/api/health`.
- **Gemini responds with HTTP 503:** The model is temporarily overloaded; the adapter retries twice with backoff and shows the error if it still fails.
- **Preview won't run:** Check desktop Chrome/Edge compatibility, WebContainer logs and COOP/COEP settings.
- **Render serves old code:** Check the deployed Git SHA or use **Manual Deploy -> Deploy latest commit** from the existing service.
