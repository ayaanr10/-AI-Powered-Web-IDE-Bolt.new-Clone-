import 'dotenv/config';
import express from 'express';
import { matchesAccessCode } from './zap-access.js';
import { streamGeminiText } from './gemini.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Local use is allowed with an API key. Public use requires extra protection.
// Hosted generation requires an opt-in and a long private access code.
const isProduction = process.env.NODE_ENV === 'production';
const protectedZap = isProduction && process.env.PUBLIC_ZAP_ENABLED === '1'
  && (process.env.ZAP_ACCESS_CODE?.length ?? 0) >= 16;
const publicZapBlocked = isProduction && !protectedZap;
const zapAvailable = () => !publicZapBlocked && Boolean(process.env.GEMINI_API_KEY);
const zapMessage = () => publicZapBlocked
  ? 'Zap is locked on this public site. The owner must configure private access first.'
  : !process.env.GEMINI_API_KEY
    ? 'Zap needs a private GEMINI_API_KEY on the server.'
    : protectedZap ? 'Enter your private Zap access code to generate an app.' : 'Zap is ready.';
const distDir = fileURLToPath(new URL('../dist/', import.meta.url));
import { validateFiles } from '../shared/filesystem.js';
import { SYSTEM_PROMPT, makeUserPrompt } from './prompts.js';

export const app = express();
app.disable('x-powered-by');
// WebContainers need these two headers for browser-based Node.js.
app.use((_req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  next();
});
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
  res.json({ ok: true, zapAvailable: zapAvailable(), zapProtected: protectedZap, zapMessage: zapMessage(), model: process.env.GEMINI_MODEL || 'gemini-3.8-flash' });
});

app.post('/api/generate', throttle, async (req, res) => {
  const { prompt, files } = req.body ?? {};
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 2000) {
    return res.status(400).json({ error: 'Prompt must have 1–2000 characters.' });
  }
  try { validateFiles(files); }
  catch (err) { return res.status(400).json({ error: err.message }); }
  // Reject outdated clients that try to use the removed demo path.
  if (req.body?.mode && req.body.mode !== 'zap') {
    return res.status(400).json({ error: 'Demo mode has been removed. Refresh Buildora to use Zap.' });
  }
  if (publicZapBlocked) {
    return res.status(403).json({ error: zapMessage() });
  }
  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({ error: zapMessage() });
  }
  // Validate the owner code BEFORE contacting the Gemini API.
  if (protectedZap && !matchesAccessCode(req.get('x-zap-access-code'), process.env.ZAP_ACCESS_CODE)) {
    return res.status(401).json({ error: 'Incorrect or missing Zap access code.' });
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
  send({ type: 'start', mode: 'zap' });
  try {
    // Zap is the only generation workflow. The key never reaches React.
    const controller = new AbortController();
    res.on('close', () => controller.abort());
    for await (const text of streamGeminiText({
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: makeUserPrompt(prompt, files),
      signal: controller.signal,
    })) {
      if (cancelled) break;
      send({ type: 'chunk', text });
    }
    if (!cancelled) send({ type: 'done' });
  } catch (err) {
    if (!cancelled) send({ type: 'error', message: err.message || 'Generation failed.' });
  } finally {
    res.end();
  }
});

// In production, one Express server serves both the React UI and the API.
// Local development continues to use Vite at http://localhost:5173.
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(distDir));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/')) {
      return res.sendFile(resolve(distDir, 'index.html'));
    }
    next();
  });
}

// Makes API routes easy to test without binding a port.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3001);
  const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1';
  app.listen(port, host, () => console.log(`Buildora running at http://${host}:${port}`));
}
