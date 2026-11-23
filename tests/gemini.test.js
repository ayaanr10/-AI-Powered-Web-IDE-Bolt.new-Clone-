import test from 'node:test';
import assert from 'node:assert/strict';
import { streamGeminiText } from '../server/gemini.js';

function mockStream(chunks) {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index >= chunks.length) controller.close();
      else controller.enqueue(new TextEncoder().encode(chunks[index++]));
    },
  });
}

async function gather(options) {
  const result = [];
  for await (const piece of streamGeminiText(options)) result.push(piece);
  return result;
}

const fixture = (text, finishReason) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, ...(finishReason ? { finishReason } : {}) }] })}\n\n`;

test('Gemini adapter streams text from arbitrarily split SSE frames', async () => {
  const raw = fixture('<artifact>', null) + fixture('<file path="src/App.jsx">ok</file>', null) + fixture('</artifact>', 'STOP');
  let request;
  const fragments = [...raw]; // one character per network read
  const output = await gather({
    apiKey: 'test-key', model: 'gemini-2.5-flash', systemPrompt: 'protocol', userPrompt: 'build something',
    fetchImpl: async (url, init) => { request = { url, init }; return new Response(mockStream(fragments), { status: 200 }); },
  });
  assert.equal(output.join(''), '<artifact><file path="src/App.jsx">ok</file></artifact>');
  assert.match(request.url, /gemini-2\.5-flash:streamGenerateContent\?alt=sse$/);
  assert.equal(request.init.headers['x-goog-api-key'], 'test-key');
  assert.equal(JSON.parse(request.init.body).contents[0].parts[0].text, 'build something');
});

test('SSE parser handles CRLF, batched events and UTF-8 text split across bytes', async () => {
  const data = (fixture('Hello 🪄') + fixture(' world', 'STOP')).replaceAll('\n', '\r\n');
  const bytes = new TextEncoder().encode(data);
  let idx = 0;
  const stream = new ReadableStream({ pull(controller) { if (idx >= bytes.length) return controller.close(); controller.enqueue(bytes.slice(idx, idx += 3)); } });
  const output = await gather({ apiKey: 'test-key', systemPrompt: 'x', userPrompt: 'y', fetchImpl: async () => new Response(stream) });
  assert.equal(output.join(''), 'Hello 🪄 world');
});

test('SSE parser ignores thought-only text blocks', async () => {
  const event = `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hidden thoughts', thought: true }, { text: 'visible' }] } }] })}\n\n`;
  const output = await gather({ apiKey: 'test-key', systemPrompt: 'x', userPrompt: 'y', fetchImpl: async () => new Response(mockStream([event])) });
  assert.equal(output.join(''), 'visible');
});

test('HTTP errors surface useful messages without exposing credentials', async () => {
  await assert.rejects(
    gather({ apiKey: 'secret-test-key', systemPrompt: 'x', userPrompt: 'y', fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'Quota reached' } }), { status: 429, headers: { 'Content-Type': 'application/json' } }) }),
    (err) => err.message.includes('429') && err.message.includes('Quota reached') && !err.message.includes('secret-test-key'),
  );
});

test('Empty or truncated Gemini outputs do not appear successful', async () => {
  await assert.rejects(gather({ apiKey: 'test-key', systemPrompt: 'x', userPrompt: 'y', fetchImpl: async () => new Response(mockStream(['data: {"candidates":[]}\n\n'])) }), /no text/);
  await assert.rejects(gather({ apiKey: 'test-key', systemPrompt: 'x', userPrompt: 'y', fetchImpl: async () => new Response(mockStream([fixture('partial', 'MAX_TOKENS')])) }), /output limit/);
});

test('temporary Gemini 503 retries once and then streams a successful result', async () => {
  let calls = 0;
  const output = await gather({
    apiKey: 'test-key', systemPrompt: 'x', userPrompt: 'y', retryDelayMs: 1,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response(JSON.stringify({ error: { message: 'High demand' } }), { status: 503 });
      return new Response(mockStream([fixture('Restaurant generated', 'STOP')]), { status: 200 });
    },
  });
  assert.equal(calls, 2);
  assert.deepEqual(output, ['Restaurant generated']);
});

test('Gemini overload stops after two retries and displays an actionable error', async () => {
  let calls = 0;
  await assert.rejects(gather({
    apiKey: 'test-key', systemPrompt: 'x', userPrompt: 'y', retryDelayMs: 1,
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: { message: 'High demand' } }), { status: 503 });
    },
  }), /Gemini is overloaded.*retried twice/);
  assert.equal(calls, 3);
});

test('Gemini does not retry quota errors', async () => {
  let calls = 0;
  await assert.rejects(gather({
    apiKey: 'test-key', systemPrompt: 'x', userPrompt: 'y', retryDelayMs: 1,
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: { message: 'Quota reached' } }), { status: 429 });
    },
  }), /429/);
  assert.equal(calls, 1);
});
