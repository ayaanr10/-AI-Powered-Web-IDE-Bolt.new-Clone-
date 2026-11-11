export async function* generateStream({ prompt, files, mode, signal }) {
  const response = await fetch('/api/generate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, files, mode }), signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `API returned ${response.status}`);
  }
  if (!response.body) throw new Error('Browser does not support fetch streaming.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const row = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (row.trim()) yield JSON.parse(row);
      }
      if (done) break;
    }
    if (buffer.trim()) yield JSON.parse(buffer);
  } finally { reader.releaseLock(); }
}
