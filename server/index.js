import 'dotenv/config';
import express from 'express';
import { createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateFiles } from '../shared/filesystem.js';
import { SYSTEM_PROMPT, makeUserPrompt } from './prompts.js';
import { streamGeminiText } from './gemini.js';
import { getBrowserId, hashRateLimitIdentity, isSameOriginRequest, VerificationUnavailableError, verifyTurnstile } from './security.js';
import { MemoryUsageStore } from './usage-store.js';

const distDir = fileURLToPath(new URL('../dist/', import.meta.url));
const MAX_GENERATION_SECONDS = 180;
const LOCK_SECONDS = 240;
const MAX_OUTPUT_TOKENS = 8192;
const LIMITS = Object.freeze({
  verificationPerIpWindow: 8,
  generationsPerIpWindow: 2,
  generationsPerIpDay: 4,
  generationsPerBrowserDay: 3,
  generationsPerAppWindow: 3,
  generationsPerAppDay: 10,
});

function secondsUntilNextUtcHour(now) {
  return Math.max(1, Math.ceil(((Math.floor(now / 3_600_000) + 1) * 3_600_000 - now) / 1000));
}

function secondsUntilNextUtcDay(now) {
  const date = new Date(now);
  const next = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now) / 1000));
}

function utcDay(now) { return new Date(now).toISOString().slice(0, 10); }

function turnstileConfigured(env) {
  return Boolean(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY);
}

function clientIp(req, production) {
  if (!production) return req.ip || 'local';
  const address = req.get('cf-connecting-ip')?.trim();
  return address && isIP(address) ? address : null;
}

function readiness({ env, production, store }) {
  if (!env.GEMINI_API_KEY) return { available: false, message: 'AI generation is not configured yet. Your editor and preview are still available.' };
  if (!production) return { available: true, message: 'Zap is ready.' };
  if (!turnstileConfigured(env)) {
    return { available: false, message: 'Free bot protection is still being set up. Your editor and preview are still available.' };
  }
  if (!store?.isReady()) return { available: false, message: 'Buildora security checks are connecting. Please try again shortly.' };
  return { available: true, message: 'Zap is ready.' };
}

function publicGenerationError(error) {
  const message = String(error?.message || '');
  if (error?.name === 'AbortError') return 'This build took too long and was stopped. Try a smaller or simpler request.';
  if (/\b429\b|quota|resource exhausted/i.test(message)) {
    return 'Gemini has reached its current usage limit. Please wait a little and try again.';
  }
  if (/\b503\b|overload|temporar|high demand/i.test(message)) {
    return 'Gemini is temporarily unavailable. Please try again in a few minutes.';
  }
  if (/\b401\b|\b403\b|\b404\b|api key|not found/i.test(message)) {
    return 'The AI service is not configured correctly. Please try again later.';
  }
  if (/output limit|max_tokens/i.test(message)) return 'Gemini reached the response limit. Try a smaller app or a simpler request.';
  return 'Buildora could not finish this build. Please try again with a clearer request.';
}

function createUsageStore(injectedStore) {
  if (injectedStore) return injectedStore;
  return new MemoryUsageStore();
}

function quotaMessage(name) {
  if (name === 'appHour') return 'Buildora is busy right now. Please try again in a few minutes.';
  if (name === 'appDay') return 'Buildora has reached today’s shared build limit. Please try again tomorrow.';
  if (name === 'ipHour') return 'Too many builds have started from this network recently. Please wait a little and try again.';
  if (name === 'ipDay') return 'This network has reached today’s build limit. Please try again tomorrow.';
  if (name === 'browserDay') return 'You’ve reached today’s build limit in this browser. Please try again tomorrow.';
  if (name === 'verification') return 'Too many security checks came from this network. Please wait a few minutes.';
  if (name === 'storeBusy') return 'Buildora is temporarily limiting new builds. Please try again in a minute.';
  if (name === 'inFlight') return 'A build is already running in this browser. Wait for it to finish before starting another.';
  return 'Buildora is temporarily limiting requests. Please try again shortly.';
}

export function createApp({
  env = process.env,
  usageStore,
  turnstileVerifier = verifyTurnstile,
  geminiStreamer = streamGeminiText,
  clock = Date.now,
  limits = LIMITS,
} = {}) {
  const production = env.NODE_ENV === 'production';
  const store = createUsageStore(usageStore);
  // Keep setup simple: derive the signed-cookie key from the server-only Gemini key.
  const sessionSecret = createHmac('sha256', env.GEMINI_API_KEY || 'buildora-local-demo')
    .update('buildora-anonymous-demo-session-v1').digest('hex');
  const turnstileEnabled = production && turnstileConfigured(env);
  const app = express();

  app.disable('x-powered-by');
  if (production) app.set('trust proxy', 1);
  // WebContainers need cross-origin isolation to run Node.js in the browser.
  app.use((_req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    next();
  });
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    getBrowserId(req, res, { secret: sessionSecret, secure: production });
    const state = readiness({ env, production, store });
    res.json({
      ok: true,
      zapAvailable: state.available,
      zapMessage: state.message,
      requiresBotVerification: turnstileEnabled,
      turnstileSiteKey: turnstileEnabled ? env.TURNSTILE_SITE_KEY : null,
      model: env.GEMINI_MODEL || 'gemini-3.8-flash',
    });
  });

  app.post('/api/generate', async (req, res) => {
    if (production && (!req.get('origin') || !isSameOriginRequest(req))) {
      return res.status(403).json({ error: 'Please open Buildora directly before starting a build.' });
    }
    if (!isSameOriginRequest(req)) return res.status(403).json({ error: 'Build requests must come from Buildora.' });

    const { prompt, files } = req.body ?? {};
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 2000) {
      return res.status(400).json({ error: 'Your description must have 1–2000 characters.' });
    }
    try { validateFiles(files); }
    catch (err) { return res.status(400).json({ error: err.message }); }
    if (req.body?.mode && req.body.mode !== 'zap') {
      return res.status(400).json({ error: 'That build option is no longer available. Refresh Buildora and try again.' });
    }

    const state = readiness({ env, production, store });
    if (!state.available) {
      return res.status(503).json({ error: state.message });
    }

    let browserId;
    let ipId;
    let visitorIp;
    try {
      browserId = getBrowserId(req, res, { secret: sessionSecret, secure: production });
      visitorIp = clientIp(req, production);
      if (!visitorIp) return res.status(503).json({ error: 'Buildora cannot verify this network connection. Please try again shortly.' });
      ipId = hashRateLimitIdentity(visitorIp, sessionSecret);
    } catch {
      return res.status(503).json({ error: 'Buildora security checks are unavailable. Please try again shortly.' });
    }

    if (turnstileEnabled) {
      const checks = await store.consume([{
        key: `buildora:limit:verify:${ipId}:${Math.floor(clock() / 600_000)}`,
        name: 'verification', limit: limits.verificationPerIpWindow, ttlSeconds: 600,
      }]).catch(() => null);
      if (!checks) return res.status(503).json({ error: 'Buildora security checks are unavailable. Please try again shortly.' });
      if (!checks.allowed) {
        res.setHeader('Retry-After', String(checks.retryAfterSeconds));
        return res.status(429).json({ error: quotaMessage(checks.name), retryAfterSeconds: checks.retryAfterSeconds });
      }
      const token = req.body?.turnstileToken;
      if (typeof token !== 'string' || token.length < 10 || token.length > 2048) {
        return res.status(403).json({ error: 'Please complete the quick security check, then try again.' });
      }
      let verification;
      try {
        verification = await turnstileVerifier({ token, secretKey: env.TURNSTILE_SECRET_KEY, remoteIp: visitorIp });
      } catch (error) {
        if (error instanceof VerificationUnavailableError || error?.name === 'VerificationUnavailableError') {
          return res.status(503).json({ error: 'The security check is temporarily unavailable. Please try again shortly.' });
        }
        return res.status(503).json({ error: 'The security check is temporarily unavailable. Please try again shortly.' });
      }
      const expectedHostname = req.hostname;
      if (!verification?.success || verification.action !== 'build' || verification.hostname !== expectedHostname) {
        return res.status(403).json({ error: 'The security check expired or could not be verified. Please try again.' });
      }
    }

    const lockKey = `buildora:lock:browser:${browserId}`;
    const lockToken = randomBytes(20).toString('hex');
    let lockAcquired = false;
    let quota;
    try {
      lockAcquired = await store.acquireLock(lockKey, lockToken, LOCK_SECONDS);
      if (!lockAcquired) {
        return res.status(429).json({ error: quotaMessage('inFlight'), retryAfterSeconds: 30 });
      }
      const now = clock();
      const hour = Math.floor(now / 3_600_000);
      const day = utcDay(now);
      const hourTtl = secondsUntilNextUtcHour(now);
      const dayTtl = secondsUntilNextUtcDay(now);
      quota = await store.consume([
        { key: `buildora:limit:app:hour:${hour}`, name: 'appHour', limit: limits.generationsPerAppWindow, ttlSeconds: hourTtl },
        { key: `buildora:limit:app:day:${day}`, name: 'appDay', limit: limits.generationsPerAppDay, ttlSeconds: dayTtl },
        { key: `buildora:limit:ip:hour:${ipId}:${hour}`, name: 'ipHour', limit: limits.generationsPerIpWindow, ttlSeconds: hourTtl },
        { key: `buildora:limit:ip:day:${ipId}:${day}`, name: 'ipDay', limit: limits.generationsPerIpDay, ttlSeconds: dayTtl },
        { key: `buildora:limit:browser:day:${browserId}:${day}`, name: 'browserDay', limit: limits.generationsPerBrowserDay, ttlSeconds: dayTtl },
      ]);
    } catch {
      if (lockAcquired) await store.releaseLock(lockKey, lockToken).catch(() => {});
      return res.status(503).json({ error: 'Buildora could not check today’s limits. Please try again shortly.' });
    }
    if (!quota.allowed) {
      await store.releaseLock(lockKey, lockToken).catch(() => {});
      res.setHeader('Retry-After', String(quota.retryAfterSeconds));
      return res.status(429).json({ error: quotaMessage(quota.name), retryAfterSeconds: quota.retryAfterSeconds });
    }

    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      'Connection': 'keep-alive',
    });
    const send = (event) => { if (!res.writableEnded && !res.destroyed) res.write(JSON.stringify(event) + '\n'); };
    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MAX_GENERATION_SECONDS * 1000);
    res.on('close', () => {
      if (!res.writableEnded) {
        cancelled = true;
        controller.abort();
      }
    });
    send({ type: 'start', mode: 'zap' });
    try {
      for await (const text of geminiStreamer({
        apiKey: env.GEMINI_API_KEY,
        model: env.GEMINI_MODEL || 'gemini-3.8-flash',
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: makeUserPrompt(prompt, files),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        signal: controller.signal,
      })) {
        if (cancelled) break;
        send({ type: 'chunk', text });
      }
      if (!cancelled) send({ type: 'done' });
    } catch (error) {
      if (!cancelled) send({ type: 'error', message: publicGenerationError(error) });
    } finally {
      clearTimeout(timeout);
      await store.releaseLock(lockKey, lockToken).catch(() => {});
      if (!res.writableEnded) res.end();
    }
  });

  // In production, one Express process serves the React UI and its same-origin API.
  if (production) {
    app.use(express.static(distDir));
    app.use((req, res, next) => {
      if (req.method === 'GET' && !req.path.startsWith('/api/')) return res.sendFile(resolve(distDir, 'index.html'));
      next();
    });
  }

  app.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);
    if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'This project is too large to send for one build.' });
    if (error instanceof SyntaxError && 'body' in error) return res.status(400).json({ error: 'Buildora received an unreadable request. Refresh and try again.' });
    return res.status(500).json({ error: 'Buildora hit a server error. Please try again shortly.' });
  });

  app.locals.usageStore = store;
  return app;
}

export const app = createApp();

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3001);
  const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1';
  app.listen(port, host, () => console.log(`Buildora running at http://${host}:${port}`));
}
