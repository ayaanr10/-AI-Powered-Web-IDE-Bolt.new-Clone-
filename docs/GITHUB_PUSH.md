# GitHub upload guide

Run these from the extracted `forge-ide` directory **after** you've installed dependencies and verified the local run:

```bash
npm install
npm run check

git init
git add .
git commit -m "Build PromptForge AI Web IDE"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git push -u origin main
```

First create an **empty repo** on GitHub (don't initialize it with a README) and replace the example URL with its actual HTTPS URL. GitHub may ask you to authenticate via its browser sign-in or credential manager. Do not paste access tokens into chat or commit them.

**Do not commit `.env` or API keys.** `.gitignore` already excludes secrets and `node_modules`.

A possible description:

> AI-powered React IDE with Gemini streaming, custom XML artifact parsing, CodeMirror editing, and WebContainer live preview.

Add your own real screenshot after the project runs successfully. Do not describe simulated Demo mode as a real Gemini API response.
