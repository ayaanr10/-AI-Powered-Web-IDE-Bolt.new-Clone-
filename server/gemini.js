/**
 * Minimal Gemini streaming adapter. Only the Express server calls Google;
 * no API key is ever sent to the React client or preview runtime.
 *
 * Gemini sends Server-Sent Events (SSE). One TCP/read chunk may contain
 * half an event or several events, so we buffer and split on blank lines.
 * Our Express API converts extracted text into provider-neutral NDJSON.
 */
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
    if (reason === 'MAX_TOKENS') throw new Error('Gemini reached the output limit. Try a smaller app or simpler request.');
    throw new Error(`Gemini stopped generation (${reason}). Try a different prompt.`);
  }
  return (candidate?.content?.parts || [])
    .filter((part) => typeof part.text === 'string' && !part.thought)
    .map((part) => part.text).join('');
}

export async function* streamGeminiText({
  apiKey, model = 'gemini-2.5-flash', systemPrompt, userPrompt,
  signal, fetchImpl = fetch,
}) {
  if (!apiKey) throw new Error('Missing GEMINI_API_KEY.');
  const url = `${API_ORIGIN}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 16000 },
    }),
    signal,
  });

  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    const detail = failure.error?.message || response.statusText || 'Unknown API error';
    const extra = response.status === 429 ? ' Check free-tier quota in Google AI Studio.' : '';
    throw new Error(`Gemini API ${response.status}: ${detail}${extra}`);
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
    reader.releaseLock();
  }
  if (!hasOutput) throw new Error('Gemini returned no text. Try another prompt or model.');
}
