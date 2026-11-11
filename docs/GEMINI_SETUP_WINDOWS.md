# Gemini edition — Windows setup (5 steps)

This ZIP is a new version of PromptForge. The previous version calls Claude. **Use this folder**, not the old one.

1. Extract `PromptForge_Gemini_Edition.zip` to a **new location**, for example `Documents\PromptForge-Gemini`.
2. Open the extracted `forge-ide` folder in VS Code. Open **Terminal > New Terminal**.
3. Run `npm install`, then `Copy-Item .env.example .env` (or make `.env` manually if it already exists).
4. Open `.env`, set `GEMINI_API_KEY=YOUR_OWN_KEY` on one line. Leave `GEMINI_MODEL=gemini-2.5-flash`. **Never share this key or commit `.env`.**
5. Run `npm run dev`, open `http://localhost:5173`, then select **Gemini · Live AI** under MODEL.

Example request: `Create a student attendance dashboard with 3 subject cards, a progress bar and a purple theme. Keep it simple and responsive.`

Once files appear, click **Run project** if the preview isn't started. If it is running, code changes should sync automatically.

## Quick checks

- `npm run test` should run 16 tests, including 5 fake (key-free) Gemini adapter tests.
- `http://localhost:3001/api/health` should return JSON including `"liveAvailable":true` if the backend loaded your key. The JSON never contains your key.
- `npm run check` runs the tests plus production Vite build.
- If you see the old Claude dropdown, you started the wrong extracted folder. Stop the old process with `Ctrl + C` and run this version.

## Troubleshooting

| Problem | Explanation / action |
|---|---|
| `liveAvailable:false` | `.env` is missing, the key value is blank, or the Node backend wasn't restarted. |
| `Gemini API 400` | Check model name and Gemini API key project access. |
| `Gemini API 403` | Check Google AI Studio permissions and whether this key can access the Gemini Developer API. |
| `Gemini API 429` | Rate or quota limit reached. Check your current free-tier limits in Google AI Studio. |
| AI artifact incomplete | Model may have hit token limit; request a smaller project/change. |
| Preview blank or broken | Check the built-in terminal for missing import/dependency errors; try restarting the WebContainer. |
| `npm install` fails | Check Node 20.19+, internet, npm registry accessibility and local firewall/proxy. |

Google's free-tier eligibility and rate limits can change; check the [official pricing](https://ai.google.dev/gemini-api/docs/pricing) and [quotas](https://ai.google.dev/gemini-api/docs/rate-limits) for your own project. Do not assume a request is free if billing is active.

**Interview explanation:** Google streams Server-Sent Events (SSE), the Node backend extracts Gemini's text and forwards provider-neutral NDJSON, and the browser's custom parser applies `<file>` operations to a virtual filesystem. CodeMirror edits the files and WebContainers runs React/Vite.
