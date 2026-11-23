# Buildora on Render — public preview

Buildora is a React frontend served by a Node/Express backend. The generated React preview runs with WebContainers in the browser. **Zap is the only generation option.** It uses the Gemini API on the server.

## Deploy the site

1. Use [Deploy to Render](https://render.com/deploy?repo=https://github.com/ayaanr10/-AI-Powered-Web-IDE-Bolt.new-Clone-), or open your existing Buildora Render service.
2. Review the settings in `render.yaml`, which builds React with Vite and starts `node server/index.js`.
3. Wait until Render shows **Live** and open its assigned URL.
4. The home page, editable starter files, import/export, and browser preview work without an AI key.

**Service naming:** The existing Render Blueprint still uses the historical service name `buildora-ide-demo` to avoid accidentally creating a second service. That name is not a generation mode, and no demo generator exists in the application.

## Public Zap requests are disabled by default

The Render Blueprint sets `PUBLIC_ZAP_ENABLED=0`. In production, Zap is unavailable until private server credentials **and** an appropriate access-control and usage-limit implementation are in place. Merely copying your key into Render and turning on a flag would expose your API quota to anonymous visitors, so do not do that.

For now, run and demonstrate **real Zap generation locally**, with `GEMINI_API_KEY` in a private `.env` file that never enters the GitHub repository. Use the public Render site for the editor and preview, not for unrestricted AI generation.

Before enabling public Zap in a future version, implement authentication, per-user quotas, abuse controls, API cost caps, logging, and appropriate security review.

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
