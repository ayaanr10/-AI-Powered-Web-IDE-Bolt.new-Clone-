import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export class VerificationUnavailableError extends Error {
  constructor() {
    super('Human verification is temporarily unavailable.');
    this.name = 'VerificationUnavailableError';
  }
}

function hmac(value, secret) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function validSignature(id, signature, secret) {
  if (!id || !signature || !secret) return false;
  const expected = Buffer.from(hmac(id, secret));
  const provided = Buffer.from(signature);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

function findCookie(header, name) {
  for (const part of (header || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(separator + 1).trim()); }
    catch { return ''; }
  }
  return '';
}

export function getBrowserId(req, res, { secret, secure = false } = {}) {
  const cookieName = secure ? '__Host-buildora_sid' : 'buildora_sid';
  const [id, signature] = findCookie(req.get('cookie'), cookieName).split('.');
  if (id?.length === 43 && validSignature(id, signature, secret)) return id;

  const newId = randomBytes(32).toString('base64url');
  const value = `${newId}.${hmac(newId, secret)}`;
  const flags = ['Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=2592000'];
  if (secure) flags.push('Secure');
  res.append('Set-Cookie', `${cookieName}=${value}; ${flags.join('; ')}`);
  return newId;
}

export function hashRateLimitIdentity(value, secret) {
  return createHmac('sha256', secret).update(String(value)).digest('hex');
}

export async function verifyTurnstile({ token, secretKey, remoteIp, fetchImpl = fetch }) {
  if (!token || !secretKey) return { success: false };
  let response;
  try {
    response = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: secretKey,
        response: token,
        ...(remoteIp ? { remoteip: remoteIp } : {}),
        idempotency_key: randomUUID(),
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new VerificationUnavailableError();
  }
  if (!response.ok) throw new VerificationUnavailableError();
  try { return await response.json(); }
  catch { throw new VerificationUnavailableError(); }
}

export function isSameOriginRequest(req) {
  const fetchSite = req.get('sec-fetch-site');
  if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) return false;
  const origin = req.get('origin');
  if (!origin) return true;
  try { return new URL(origin).host === req.get('host'); }
  catch { return false; }
}
