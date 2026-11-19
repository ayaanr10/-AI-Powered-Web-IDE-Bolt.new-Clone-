# Deploy PromptForge to Render (public demo mode)

## Before deploying

- This service hosts the **React UI plus Express demo API** on one public HTTPS URL.
- Public deployments are intentionally **demo-only**. You can generate the Task Manager and Landing Page sample templates. Custom Gemini generation still works on your *local machine* when a server-side `GEMINI_API_KEY` is configured.
- Do **not** put a Google API key in GitHub, a `VITE_*` variable, or the public service's environment. This version has no user authentication, per-user quota tracking or paid-API billing controls.
- This is a learning MVP, not a multi-tenant or hardened production IDE.

## Deployment

1. Merge the beginner-friendly UI PR into `main`.
2. Connect your GitHub account to [Render](https://dashboard.render.com/), and create a new **Blueprint** from this repository.
3. Render detects the root `render.yaml` and creates the web service. Review any plan/pricing before confirming.
4. Render runs `npm install --no-audit --no-fund && npm run build`, then `npm run start:api`. The server listens on Render's assigned `PORT` on `0.0.0.0`.
5. Open the HTTPS URL Render provides. Test `/api/health`, which should return `"ok":true` and `"liveAvailable":false`.
6. In desktop Chrome/Edge, choose **Task manager**, then click **Run preview**. Try editing code by selecting **Show code editor**. Test both the example and exported ZIP.

## WebContainer requirements / known limitations

WebContainers rely on `SharedArrayBuffer` and cross-origin isolation. The Express server sets:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: credentialless`

The WebContainer instance boots with `coep: 'credentialless'`. Browser plugins, cookies restrictions, third-party script policies, dependency installation and embedded previews can still cause problems; a successful Node deployment does not guarantee WebContainer runtime success on every browser. Test the deployed HTTPS site on Chromium.

If the preview is blank, check the in-app terminal for dependency-install logs and the browser console for COOP/COEP errors. For **local development**, use `npm run dev` and open `http://localhost:5173`.

## How to explain in an interview

"The frontend is a React/Vite IDE where user prompts are sent to an Express backend. The backend streams a structured artifact response. A parser turns it into file edits in a virtual filesystem. The browser uses WebContainers to run a generated React app. My public deployment demonstrates the template generation and preview flow; Gemini-powered generation is run locally to avoid exposing unrestricted paid API access."

Do not call this a fully public AI-generation service. In demo mode the two templates are deterministic, not LLM-generated.

## Before enabling public AI generation

Add authentication, quotas per user, reliable rate limits, proper billing limits and a security review for generated executable code. Do not simply set `GEMINI_API_KEY` on the public demo service.
