# Deploy Buildora to Render (public demo)

Buildora has **one** Node/Express web service. In production, Express serves the built React interface and the `/api` endpoints from the same URL. The WebContainers preview still runs **inside each visitor's browser**.

## One-click setup

1. Open the [Deploy to Render shortcut](https://render.com/deploy?repo=https://github.com/ayaanr10/-AI-Powered-Web-IDE-Bolt.new-Clone-).
2. Sign into Render and approve access to the repository if asked.
3. Review the Blueprint configuration in `render.yaml`. It creates one **Free** Node web service named `buildora-ide-demo`.
4. Choose **Deploy Blueprint** and open the service's actual `.onrender.com` address from Render after the deployment is Live.
5. In desktop Chrome or Edge, choose **Demo**, click **Task manager**, and then click **Run app**.

There is no automatic public URL until the Render service has actually been created in your account. Free services can take time to wake up after inactivity.

## Why no Gemini key in the public demo?

A publicly accessible web endpoint that spends your Gemini API quota could be abused. The Render Blueprint enables `PUBLIC_DEMO=1`, which **disables live Gemini mode even if the service accidentally receives a key**. This protects your quota for the first deployment.

For your interview, demonstrate:
- Demo generation and editable React files on the deployed site.
- Real Gemini generation locally, with your API key in a private `.env`, never committed to GitHub.

For a future public Gemini version, add authentication, user-level rate limits, spending controls, and abuse prevention *before* enabling live generation. Do not remove the demo restriction until those safeguards are in place.

## How the deployment works (interview explanation)

```
GitHub push
   ↓
Render builds the Vite React application into dist/
   ↓
Render starts server/index.js
   ↓
Express serves both the React files and /api/generate
   ↓
The visitor enters a prompt and sees the workspace
   ↓
WebContainers runs the generated Vite project in that visitor's browser
```

`server/index.js` sets the two cross-origin isolation headers needed by WebContainers:
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: credentialless`

The Express server listens on `0.0.0.0` and Render's assigned `PORT` in production. Local development still uses Vite at `http://localhost:5173` and the API on `127.0.0.1:3001`.

## Troubleshooting

- **Home page loads but Run app fails:** Try desktop Chrome/Edge, and inspect browser devtools or the UI's Show logs panel for WebContainer errors. Browser settings/extensions may interfere.
- **Render returns a port error:** Confirm that it deployed the commit containing the new production host logic and used `node server/index.js`.
- **Gemini AI option unavailable:** That's expected on the public demo. Run locally with your own private key instead.
- **Waiting on first visit:** The Render Free service may have spun down.
- **Want your changes live?** Commit them to the connected GitHub branch and verify the latest successful Render deploy in the dashboard.
