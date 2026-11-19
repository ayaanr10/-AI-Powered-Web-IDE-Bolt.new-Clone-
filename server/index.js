import 'dotenv/config';
import express from 'express';
import { streamGeminiText } from './gemini.js';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateFiles } from '../shared/filesystem.js';
import { SYSTEM_PROMPT, makeUserPrompt } from './prompts.js';
import { getDemoArtifact } from './demo.js';

const production = process.env.NODE_ENV === 'production';
const liveAvailable = !production && Boolean(process.env.GEMINI_API_KEY);

export const app = express();
// Required for WebContainers/SharedArrayBuffer on HTTPS hosting.
app.use((_req, res, next) => {
  res.set('Cross-Origin-Opener-Policy', 'same-origin');
  res.set('Cross-Origin-Embedder-Policy', 'credentialless');
  next();
});
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
const requests = new Map();
const WINDOW_MS = 5 * 60 * 1000;
const MAX_REQUESTS = 12;

function throttle(req, res, next) {
  const ip = req.ip ?? 'local';
  const now = Date.now();
  const times = (requests.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (times.length >= MAX_REQUESTS) return res.status(429).json({ error: 'Rate limit: try again in a few minutes.' });
  times.push(now);
  requests.set(ip, times);
  next();
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, liveAvailable, model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' });
});

app.post('/api/generate', throttle, async (req, res) => {
  const { prompt, files, mode = 'demo' } = req.body ?? {};
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 2000) {
    return res.status(400).json({ error: 'Prompt must have 1–2000 characters.' });
  }
  try { validateFiles(files); }
  catch (err) { return res.status(400).json({ error: err.message }); }
  if (!['demo', 'live'].includes(mode)) return res.status(400).json({ error: 'Invalid generation mode.' });
  if (mode === 'live' && !liveAvailable) {
    return res.status(400).json({ error: 'Live AI is available only when running locally with a server-side GEMINI_API_KEY. Public deployments are demo-only.' });
  }

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
    'Connection': 'keep-alive',
  });
  const send = (event) => { if (!res.writableEnded && !res.destroyed) res.write(JSON.stringify(event) + '\n'); };
  let cancelled = false;
  res.on('close', () => { cancelled = true; });
  send({ type: 'start', mode });
  try {
    if (mode === 'demo') {
      const xml = getDemoArtifact(prompt);
      const sizes = [31, 9, 67, 18, 121, 44, 181, 53];
      for (let i = 0, k = 0; i < xml.length && !cancelled; k++) {
        const n = sizes[k % sizes.length];
        send({ type: 'chunk', text: xml.slice(i, i + n) });
        i += n;
        if (k % 4 === 0) await new Promise((resolve) => setTimeout(resolve, 5));
      }
    } else {
      // API credentials stay on this Node server, never in the browser.
      // Gemini emits SSE; the adapter yields text chunks and Express emits NDJSON.
      const controller = new AbortController();
      res.on('close', () => controller.abort());
      for await (const text of streamGeminiText({
        apiKey: process.env.GEMINI_API_KEY,
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: makeUserPrompt(prompt, files),
        signal: controller.signal,
      })) {
        if (cancelled) break;
        send({ type: 'chunk', text });
      }
    }
    if (!cancelled) send({ type: 'done' });
  } catch (err) {
    if (!cancelled) send({ type: 'error', message: err.message || 'Generation failed.' });
  } finally {
    res.end();
  }
});

// On Render, serve both the built Vite app and demo API from one service.
if (production) {
  const distDir = resolve(process.cwd(), 'dist');
  app.use(express.static(distDir));
  app.get(/.*/, (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(join(distDir, 'index.html'));
  });
}

// Makes API routes easy to test without binding a port.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3001);
  app.listen(port, production ? '0.0.0.0' : '127.0.0.1', () => console.log(`PromptForge API listening on port ${port}`));
}
