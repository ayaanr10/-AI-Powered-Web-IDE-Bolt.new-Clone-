# Buildora free demo on Render

Buildora runs as one Render web service. React serves the interface, Express calls Gemini, and WebContainers run the generated preview in each visitor's browser. The Gemini key stays on Express; it never enters React or the browser bundle.

## What the demo needs

Keep the existing Render free web service. No paid database, Redis service, or extra session secret is needed.

Set these values in the service's **Environment** page:

| Variable | Value | Secret? |
| --- | --- | --- |
| `GEMINI_API_KEY` | Your Google AI Studio API key | Yes; server only |
| `GEMINI_MODEL` | A model available to your key | No |
| `TURNSTILE_SITE_KEY` | Public key from a Cloudflare Turnstile widget | No |
| `TURNSTILE_SECRET_KEY` | Secret key for that widget | Yes; server only |

Create a Cloudflare Turnstile widget for the Render hostname, `buildora-ide-demo.onrender.com`. Turnstile has a free plan. Add both widget keys directly in Render; never put the secret key in frontend code, GitHub, or chat. The small invisible check runs when a visitor presses **Build now**. Express sends the token to Cloudflare for server-side verification.

If a Gemini key already appears in Render's Environment page, keep it there. Do not click the reveal icon or share its value. Set `GEMINI_MODEL` to the model that is enabled for that key.

## Demo safety limits

The Express process checks the same-origin request, Turnstile result, trusted Render client IP, signed browser cookie, and a small in-memory quota before calling Gemini:

- 2 builds per network per hour and 4 per network per UTC day
- 3 builds per browser per UTC day
- 3 builds total per hour and 10 total per UTC day
- 8 Turnstile checks per network per 10 minutes
- One active build per browser, up to 8,192 output tokens and 3 minutes

These counters live in the web service's memory. They reset when Render restarts or redeploys the service and are not a billing guarantee. Turnstile helps screen automated traffic, and the low app-wide limit keeps this demo small. This setup is for a portfolio demo, not a high-traffic public product.

## Keep Gemini use free

Google offers a free Gemini API tier for eligible models and projects, with usage limits. Check that your key belongs to the free tier and that paid billing is not enabled if you cannot pay. The app's demo limits reduce requests, but only Google controls the API account's billing and quotas. Check the current [Gemini API pricing and free-tier details](https://ai.google.dev/gemini-api/docs/pricing) before sharing the public link.

## Deploy and check

After the Environment values are saved, deploy the Buildora branch to Render. Open `/api/health`; it should report that Zap is available without returning any secret values. Then try a small prompt, confirm files appear, and run the preview in desktop Chrome or Edge.

When bot protection is missing, Buildora explains that it is still being set up and keeps the editor and preview available. Gemini quota errors and temporary provider outages also have clear messages.

## Troubleshooting

- **“Free bot protection is still being set up.”** Add both Turnstile keys to Render and confirm the widget allows the Buildora hostname.
- **“Gemini has reached its current usage limit.”** Check the active model and free-tier quota in AI Studio.
- **“Gemini is temporarily unavailable.”** Try again later; the provider may be busy.
- **“Buildora has reached today’s shared build limit.”** The demo's 10-build shared daily cap resets at UTC midnight, or when the service restarts.
- **Preview does not run.** Use desktop Chrome or Edge. WebContainers need the cross-origin isolation headers already set by the server.

## Request flow

```text
React -> same-origin Express API -> Turnstile server verification
                               -> in-memory demo limits
                               -> Gemini API (server key only)
Gemini stream -> Express NDJSON -> existing parser -> editor + WebContainer preview
```
