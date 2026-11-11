// Plain object virtual filesystem: { 'src/App.jsx': 'file contents' }.
// The same validators are used by the API and browser.
export const MAX_FILES = 80;
export const MAX_FILE_BYTES = 200_000;
export const MAX_PROJECT_BYTES = 800_000;

export function safePath(input) {
  if (typeof input !== 'string' || !input || input.length > 180) return false;
  if (input.startsWith('/') || input.startsWith('./') || input.includes('\\')) return false;
  if (!/^[A-Za-z0-9_./-]+$/.test(input)) return false;
  const parts = input.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return false;
  if (parts.some((part) => ['node_modules', '.git', '.env', 'dist'].includes(part))) return false;
  if (parts.some((part) => part.startsWith('.env'))) return false;
  return true;
}

export function validateFiles(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Project must be a filename-to-content object.');
  }
  const entries = Object.entries(input);
  if (entries.length > MAX_FILES) throw new Error(`Too many files (max ${MAX_FILES}).`);
  let projectBytes = 0;
  for (const [path, content] of entries) {
    if (!safePath(path)) throw new Error(`Invalid file path: ${path}`);
    if (typeof content !== 'string') throw new Error(`Invalid content in ${path}`);
    const bytes = new TextEncoder().encode(content).length;
    if (bytes > MAX_FILE_BYTES) throw new Error(`File too large: ${path}`);
    projectBytes += bytes;
  }
  if (projectBytes > MAX_PROJECT_BYTES) throw new Error('Project size limit exceeded.');
  return input;
}

export function applyAction(files, action) {
  if (action.type === 'message') return files;
  if (!safePath(action.path)) throw new Error('AI suggested an unsafe path.');
  const next = { ...files };
  if (action.type === 'file') next[action.path] = action.content;
  else if (action.type === 'delete') delete next[action.path];
  else throw new Error('Unknown file operation.');
  return validateFiles(next);
}

export function toMountTree(files) {
  validateFiles(files);
  const root = {};
  for (const [path, contents] of Object.entries(files)) {
    const parts = path.split('/');
    let cursor = root;
    for (const name of parts.slice(0, -1)) {
      if (!cursor[name]) cursor[name] = { directory: {} };
      cursor = cursor[name].directory;
    }
    cursor[parts.at(-1)] = { file: { contents } };
  }
  return root;
}

export function languageFor(path) {
  if (/\.(jsx?|tsx?)$/i.test(path)) return 'javascript';
  if (/\.css$/i.test(path)) return 'css';
  if (/\.html?$/i.test(path)) return 'html';
  if (/\.json$/i.test(path)) return 'json';
  return 'text';
}
