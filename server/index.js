import 'dotenv/config';
import express from 'express';
import { generateValidatedProject } from './project-generation.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const isProduction = process.env.NODE_ENV === 'production';
const zapAvailable = () => Boolean(process.env.GEMINI_API_KEY?.trim());
const zapMessage = () => zapAvailable() ? 'AI builder is ready.' : 'AI builder is not configured on the server.';
const distDir = fileURLToPath(new URL('../dist/', import.meta.url));
import { validateFiles } from '../shared/filesystem.js';

export const app = express();
app.disable('x-powered-by');
// WebContainers need these two headers for browser-based Node.js.
app.use((_req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  next();
});
app.use(express.json({ limit: '1mb' }));
// Conservative process-wide limits protect a public demo even behind a proxy.
const WINDOW_MS = 5 * 60 * 1000;
const MAX_REQUESTS = 4;
const MAX_DAILY = 40;
const requests = new Map();
let daily = [];
let active = 0;
function throttle(req, res, next) {
  if (req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({error:'Use the Buildora website to generate.'});
  const now = Date.now();
  for (const [key, times] of requests) {
    const recent = times.filter(t => now - t < WINDOW_MS);
    if (recent.length) requests.set(key, recent); else requests.delete(key);
  }
  daily = daily.filter(t => now - t < 86400000);
  const ip = req.ip ?? 'local';
  const times = requests.get(ip) ?? [];
  if (times.length >= MAX_REQUESTS || daily.length >= MAX_DAILY)
    return res.status(429).json({error:'Public demo limit reached. Please try again later; editing and preview still work.'});
  if (active >= 1) return res.status(429).json({error:'Another build is running. Please try again shortly.'});
  times.push(now); daily.push(now); requests.set(ip, times);
  active++;
  let released = false;
  const release = () => { if (!released) { released = true; active--; } };
  res.once('finish', release); res.once('close', release);
  next();
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, zapAvailable: zapAvailable(), zapProtected: false, zapMessage: zapMessage(), model: process.env.GEMINI_FAST_MODEL || 'gemini-3.5-flash-lite', generationProtocol:'validated-json-v1' });
});

app.post('/api/generate', async (req, res, next) => {
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
  if (!zapAvailable()) return res.status(503).json({ error: zapMessage() });
  next();
}, throttle, async (req, res) => {
  const { prompt, files } = req.body;
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
  const heartbeat = setInterval(() => send({type:'heartbeat'}), 10000);
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(new Error('Build timed out. Try a smaller prompt.')), 125000);
  res.on('close', () => controller.abort());
  try {
    const project=await generateValidatedProject({
      apiKey:process.env.GEMINI_API_KEY,
      models:[process.env.GEMINI_FAST_MODEL || 'gemini-3.5-flash-lite',process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.5-flash'],
      prompt,files,signal:controller.signal,
      onProgress:message=>send({type:'progress',message}),
    });
    if(!cancelled){
      send({type:'project',message:project.message,actions:project.actions});
      send({type:'done'});
    }
  } catch (err) {
    console.warn('Buildora generation failed:', err.name, err.code || '');
    if (!cancelled) send({ type: 'error', message: controller.signal.aborted ? 'Build timed out. Retry with a smaller request.' : (err.message || 'Generation failed.') });
  } finally {
    clearTimeout(deadline);
    clearInterval(heartbeat);
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
