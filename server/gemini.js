/**
 * Minimal Gemini streaming adapter. Only the Express server calls Google;
 * no API key is ever sent to the React client or preview runtime.
 *
 * Gemini sends Server-Sent Events (SSE). One TCP/read chunk may contain
 * half an event or several events, so we buffer and split on blank lines.
 * Our Express API converts extracted text into provider-neutral NDJSON.
 */
import { setTimeout as pause } from 'node:timers/promises';

const API_ORIGIN = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_SSE_EVENT_CHARS = 1_000_000;

function* readSseEvents(state, fragment, flush = false) {
  state.buffer += fragment;
  // Normalize CRLF and support event delimiters split across network frames.
  state.buffer = state.buffer.replace(/\r\n/g, '\n');
  let end;
  while ((end = state.buffer.indexOf('\n\n')) !== -1) {
    const raw = state.buffer.slice(0, end);
    state.buffer = state.buffer.slice(end + 2);
    const data = raw.split('\n').filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart()).join('\n');
    if (data) yield data;
  }
  if (state.buffer.length > MAX_SSE_EVENT_CHARS) {
    throw new Error('Gemini returned an unexpectedly large streaming event.');
  }
  if (flush && state.buffer.trim()) {
    const data = state.buffer.split('\n').filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart()).join('\n');
    state.buffer = '';
    if (data) yield data;
  }
}

function eventText(data) {
  if (data === '[DONE]') return '';
  let payload;
  try { payload = JSON.parse(data); }
  catch { throw new Error('Gemini sent invalid streaming JSON.'); }
  if (payload.error) throw new Error(`Gemini: ${payload.error.message || 'generation error'}`);
  const candidate = payload.candidates?.[0];
  const reason = candidate?.finishReason;
  if (reason && !['STOP', 'FINISH_REASON_UNSPECIFIED'].includes(reason)) {
    if (reason === 'MAX_TOKENS') { const error = new Error('Gemini reached the output limit. Try a smaller app or simpler request.'); error.code = 'MAX_TOKENS'; throw error; }
    throw new Error(`Gemini stopped generation (${reason}). Try a different prompt.`);
  }
  return (candidate?.content?.parts || [])
    .filter((part) => typeof part.text === 'string' && !part.thought)
    .map((part) => part.text).join('');
}

export async function* streamGeminiText({
  apiKey, model = 'gemini-3.8-flash', systemPrompt, userPrompt,
  signal, fetchImpl = fetch, retryDelayMs = 1000, maxRetries = 2, responseJsonSchema,
}) {
  if (!apiKey) throw new Error('Missing GEMINI_API_KEY.');
  const url = `${API_ORIGIN}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
  const request = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.2, maxOutputTokens: 24576,
        ...(responseJsonSchema ? {responseMimeType:'application/json', responseJsonSchema} : {}),
        ...(/^gemini-3(?:\.|-)/.test(model) && /flash/.test(model) ? {thinkingConfig:{thinkingLevel:'MINIMAL'}} : {}),
      },
    }),
    signal,
  };

  // Google's 503 means temporary overload. Retry only before any stream begins.
  // Two short retries prevent an outage from triggering unlimited API calls.
  let response;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    response = await fetchImpl(url, request);
    if (response.status !== 503 || attempt === maxRetries) break;
    await response.body?.cancel?.();
    await pause(retryDelayMs * (2 ** attempt), undefined, { signal });
  }

  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    const detail = failure.error?.message || response.statusText || 'Unknown API error';
    const extra = response.status === 429
      ? ' Check your quota in Google AI Studio.'
      : response.status === 503
        ? (maxRetries === 2 ? ' Gemini is overloaded. Buildora retried twice; try later or switch to another model available in AI Studio.' : ' Gemini is overloaded.')
        : '';
    const error = new Error(`Gemini API ${response.status}: ${detail}${extra}`.replaceAll(apiKey, '[redacted]'));
    error.code = response.status;
    throw error;
  }
  if (!response.body) throw new Error('Gemini returned no streaming body.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const state = { buffer: '' };
  let hasOutput = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      for (const data of readSseEvents(state, decoder.decode(value || new Uint8Array(), { stream: !done }), done)) {
        const text = eventText(data);
        if (text) { hasOutput = true; yield text; }
      }
      if (done) break;
    }
  } finally {
    // Cancel the HTTP stream if the complete artifact was already received.
    try { await reader.cancel(); } catch { /* stream may already be closed */ }
    reader.releaseLock();
  }
  if (!hasOutput) throw new Error('Gemini returned no text. Try another prompt or model.');
}

// Fall back only before any text is emitted, never mix two artifacts.
// The first-text timeout becomes a rolling inactivity timeout while streaming.
export async function* streamGeminiWithFallback(options) {
  const models = [...new Set([options.model, options.fallbackModel].filter(Boolean))];
  const firstTokenMs = options.firstTokenTimeoutMs ?? 25000;
  const idleMs = options.idleTimeoutMs ?? 30000;
  for (let i = 0; i < models.length; i++) {
    let emitted = false;
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    let timer;
    function arm(ms) {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(new Error('Gemini stopped responding.')), ms);
    }
    arm(firstTokenMs);
    const started = Date.now();
    try {
      const userPrompt = i === 0 ? options.userPrompt : options.userPrompt + '\n\nReturn a compact complete implementation; avoid long comments, repetitive markup and extra files. Finish the artifact promptly.';
      for await (const piece of streamGeminiText({...options, userPrompt, model: models[i], signal, maxRetries: 0})) {
        if (!emitted) console.info('Buildora first output', models[i], Date.now()-started, 'ms');
        emitted = true;
        arm(idleMs);
        yield piece;
      }
      console.info('Buildora generation complete', models[i], Date.now()-started, 'ms');
      return;
    } catch (err) {
      console.warn('Buildora model attempt failed', models[i], controller.signal.aborted ? 'idle timeout' : (err.code || err.name), 'emitted:', emitted);
      if (options.signal?.aborted) throw err;
      const restartable = emitted && err.code === 'MAX_TOKENS' && typeof options.onRestart === 'function';
      if ((emitted && !restartable) || i === models.length - 1) {
        if (controller.signal.aborted) throw new Error('AI stopped responding. Your prompt and previous project are saved; retry with a smaller request.');
        throw err;
      }
      if (![404, 429, 500, 502, 503, 504, 'MAX_TOKENS'].includes(err.code) && !controller.signal.aborted) throw err;
      if (restartable) options.onRestart();
    } finally {
      clearTimeout(timer);
    }
  }
}
