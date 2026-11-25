# Buildora on Render

Buildora serves the React interface and its Express API from one Render web service. The browser preview runs inside WebContainers. Zap uses Gemini through the server; the Gemini key never enters React, browser storage, or generated bundles.

## Before enabling public generation

The current Render service is a free web service. Public generation is deliberately unavailable until its abuse controls are configured. The service must have all of these values set in its **Environment** page:

| Variable | Where it comes from | Secret? |
| --- | --- | --- |
| `GEMINI_API_KEY` | Google AI Studio API key | Yes; server only |
| `GEMINI_MODEL` | A model enabled for the key | No |
| `REDIS_URL` | Internal connection string for a persistent Render Key Value instance in Oregon | Yes; server only |
| `SESSION_SECRET` | A randomly generated 32-byte or longer secret | Yes; server only |
| `TURNSTILE_SITE_KEY` | Cloudflare Turnstile widget configured for `buildora-ide-demo.onrender.com` | Public widget setting |
| `TURNSTILE_SECRET_KEY` | The same widget's secret key | Yes; server only |

Create a persistent Key Value instance in the same Render workspace and region as the web service, and keep it private to Render's internal network. Buildora uses it for shared, atomic quotas and request locks. Render's free web service can initiate a private network connection to a same-region Key Value instance; use the internal connection URL shown by Render. Do not use an in-memory/free store for the live service: its counters disappear when the store restarts. Review Render's current price before creating a persistent instance; this repo does not create one automatically. See [Render's private network guide](https://render.com/docs/private-network) and [Key Value guide](https://render.com/docs/key-value).

Create a Cloudflare Turnstile widget for the Render hostname (and any custom domain you later add). Turnstile runs when someone starts a build and usually does not require a visible puzzle. Express sends the token to Cloudflare's Siteverify endpoint and rejects the request unless Cloudflare verifies the `build` action and hostname. The frontend widget by itself is not treated as protection. See [Cloudflare's server-side validation guide](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).

Generate a session signing key locally, then paste the output directly into Render's Environment page. Never commit or send it in chat:

```bash
openssl rand -hex 32
```

After saving the variables, deploy the app and check `/api/health`. It returns only whether generation is available, a public Turnstile site key, and the model name. It never returns the Gemini or Turnstile secret, Redis URL, or signing key. If the safety services are missing or unreachable, the editor remains available and generation fails closed.

## Abuse limits

The production backend enforces shared Redis limits before contacting Gemini:

- 4 builds per IP per hour and 10 per IP per UTC day
- 5 builds per signed anonymous browser per UTC day
- 8 builds for the whole app per hour and 25 per UTC day
- 12 bot-verification attempts per IP per 10 minutes
- One active generation per browser; each request has an output-token limit and a maximum run time

Anonymous usage is tied to a signed, HttpOnly, Secure, SameSite cookie and a one-way hash of Render's Cloudflare `CF-Connecting-IP` client address. Buildora does not trust a caller-supplied `X-Forwarded-For` value for quotas, and generation fails closed if the trusted edge address is missing. Clearing the browser cookie does not remove the IP or shared app limits. These controls are for a small public demo; sustained growth should add sign-in and per-account quotas. See [Render's client-IP and rate-limit guidance](https://render.com/articles/how-render-handles-ddos-attacks).

## Gemini-side limits

Check the active model's RPM, TPM, and RPD limits in [Google AI Studio](https://aistudio.google.com/rate-limit). They vary by project, tier, and model. Configure a Gemini API [spend cap](https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps) for the linked project when eligible, in addition to the application limits. A cap pauses new Gemini API use when its configured monthly target is reached; usage reporting has some latency, so set it below the maximum amount you are comfortable spending. This provider-side control cannot be configured from this repository because it belongs to the Google project/billing account.

## Deploy process

The existing service is linked to `main` and has automatic deploys enabled. Run `npm run check` before updating that branch. A push or merge to `main` starts the Render deploy; do not also trigger a manual deploy for the same commit. The configured health check is `/api/health`.

## Troubleshooting

- **“Public safety checks are still being configured.”** Add `REDIS_URL`, `SESSION_SECRET`, and both Turnstile variables on Render. Check that the Key Value instance is running in Oregon.
- **“Buildora security checks are connecting.”** Wait for the Key Value instance to become ready, then refresh the page.
- **“Please complete the quick security check.”** Allow Cloudflare challenge scripts for `challenges.cloudflare.com`; refresh to get a fresh token.
- **“Buildora reached today’s shared build limit.”** The global cap is shared by all visitors and resets at UTC midnight.
- **“Gemini has reached its current usage limit.”** Check the active project and model quotas in AI Studio.
- **Gemini is unavailable.** The provider may be overloaded; try later. Buildora retries temporary Gemini 503 responses before showing this message.
- **Preview won't run.** Use desktop Chrome or Edge, then check the WebContainer terminal. The service sets COOP/COEP headers required by WebContainers.

## Request flow

```text
React -> same-origin Express API -> Turnstile Siteverify
                               -> Redis atomic quotas + browser lock
                               -> Gemini API (server key only)
Gemini stream -> Express NDJSON -> existing parser -> editor + WebContainer preview
```
