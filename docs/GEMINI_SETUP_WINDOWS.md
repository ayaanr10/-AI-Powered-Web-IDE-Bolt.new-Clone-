# Zap — Windows setup (Buildora's Gemini-powered generator)

Zap is the **only** Buildora generation option. It calls Gemini on a local Node backend so your API key never appears in browser source.

1. Open the latest Buildora source folder in VS Code. It must contain `package.json`.
2. In PowerShell run `npm install` and `Copy-Item .env.example .env`. If `.env` already exists, **don't overwrite it**.
3. Open the private `.env` file. Set `GEMINI_API_KEY` to a new, unshared key from your own Google AI Studio account. Set `GEMINI_MODEL` to a supported model your API key can access, such as the value in `.env.example`. Never put your key in screenshots, chat, or GitHub.
4. Run `npm run dev` and confirm the API (port 3001) and Vite (port 5173) start.
5. Open `http://localhost:5173/api/health` and check `"zapAvailable":true`. Open `http://localhost:5173`: the homepage will show **Zap · Ready**, not a mode dropdown.
6. Ask Zap to build a small restaurant homepage. Then use **Run app** to launch the generated React app in the WebContainer preview.

## Troubleshooting

- **Zap Unavailable:** The key is blank/missing, the backend is not running, or the app is on the protected public Render deployment. Check `/api/health`.
- **Port 5173 already in use:** Stop the other Vite server before starting the new one; don't stop unrelated Node processes.
- **Gemini 404:** Your chosen model isn't available to the API key. Use a supported model ID shown in your Google AI Studio project.
- **Gemini 503:** The model is temporarily overloaded. Zap retries twice with short backoff; try another available model or test later if overload persists.
- **Gemini 429:** You may have exhausted a rate or quota limit. Inspect your current quota and billing in Google AI Studio.
- **Generated app breaks:** Check Show logs, fix any imports, and restart the WebContainer if package.json changed.

The API key is never sent to React. The server streams Gemini's SSE text as NDJSON; a parser turns the structured response into source-file changes. WebContainers then runs the generated Vite app in the browser.
