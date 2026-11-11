import { strToU8, strFromU8, zipSync, unzipSync } from 'fflate';
import { safePath, validateFiles } from '../../shared/filesystem.js';

export function downloadZip(files, filename = 'promptforge-project.zip') {
  validateFiles(files);
  const payload = Object.fromEntries(Object.entries(files).map(([path, data]) => [path, strToU8(data)]));
  const blob = new Blob([zipSync(payload, { level: 5 })], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function readZip(file) {
  if (file.size > 2_000_000) throw new Error('Zip exceeds 2MB import limit.');
  const contents = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const next = {};
  for (const [path, data] of Object.entries(contents)) {
    if (path.endsWith('/')) continue;
    if (!safePath(path)) throw new Error(`Archive contains an unsupported path: ${path}`);
    next[path] = strFromU8(data);
  }
  validateFiles(next);
  if (!next['package.json'] || !next['index.html']) throw new Error('Import a Vite project with package.json and index.html.');
  return next;
}
