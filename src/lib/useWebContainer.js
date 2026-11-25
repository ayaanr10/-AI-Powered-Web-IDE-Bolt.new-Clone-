import { useCallback, useRef, useState } from 'react';
import { WebContainer } from '@webcontainer/api';
import { toMountTree } from '../../shared/filesystem.js';

export function useWebContainer() {
  const instance = useRef(null);
  const starting = useRef(false);
  const devProcess = useRef(null);
  const currentFiles = useRef({});
  const queue = useRef(Promise.resolve());
  const [status, setStatus] = useState('idle');
  const [previewUrl, setPreviewUrl] = useState('');
  const [logs, setLogs] = useState(['Welcome to Buildora Terminal', 'The browser runtime boots when you click Run app.']);
  const [error, setError] = useState('');

  const log = useCallback((data) => {
    if (typeof data !== 'string') return;
    setLogs((old) => [...old, ...data.replace(/\r/g, '').split('\n').filter(Boolean)].slice(-180));
  }, []);

  const streamOutput = useCallback((process) => {
    process.output.pipeTo(new WritableStream({ write: (chunk) => log(chunk) })).catch((err) => log(`Log stream ended: ${err.message}`));
  }, [log]);

  const run = useCallback(async (files) => {
    if (starting.current) return;
    if (!window.crossOriginIsolated) {
      const msg = 'WebContainers need cross-origin isolation. Use Chrome/Edge on http://localhost:5173 (not a file:// URL), and verify Vite COOP/COEP headers.';
      setError(msg); setStatus('error'); log(msg); return;
    }
    starting.current = true;
    setError('');
    setPreviewUrl('');
    try {
      setStatus('booting');
      log('Booting WebContainer (Node.js in your browser)...');
      if (!instance.current) {
        instance.current = await WebContainer.boot({ coep: 'credentialless' });
        instance.current.on('server-ready', (_port, url) => { setPreviewUrl(url); setStatus('ready'); log(`Preview ready: ${url}`); });
        instance.current.on('error', (err) => { setError(err.message); log(`Runtime error: ${err.message}`); });
      }
      const wc = instance.current;
      if (devProcess.current) {
        devProcess.current.kill();
        devProcess.current = null;
      }
      log(`Mounting ${Object.keys(files).length} project files...`);
      await wc.mount(toMountTree(files));
      currentFiles.current = { ...files };
      setStatus('installing');
      log('Installing generated app dependencies...');
      const install = await wc.spawn('npm', ['install', '--no-audit', '--no-fund']);
      streamOutput(install);
      const exitCode = await install.exit;
      if (exitCode !== 0) throw new Error(`npm install failed (exit ${exitCode}). Check terminal output.`);
      log('Starting Vite development server...');
      setStatus('starting');
      devProcess.current = await wc.spawn('npm', ['run', 'dev', '--', '--host', '0.0.0.0']);
      streamOutput(devProcess.current);
      // The server-ready event sets status=ready & previewUrl asynchronously.
    } catch (err) {
      log(`ERROR: ${err.message}`);
      setError(err.message);
      setStatus('error');
    } finally { starting.current = false; }
  }, [log, streamOutput]);

  const sync = useCallback((nextFiles) => {
    if (!instance.current || !['ready', 'starting'].includes(status)) return;
    const wc = instance.current;
    const prev = currentFiles.current;
    const changed = Object.entries(nextFiles).filter(([path, contents]) => prev[path] !== contents);
    const removed = Object.keys(prev).filter((path) => !(path in nextFiles));
    if (!changed.length && !removed.length) return;
    currentFiles.current = { ...nextFiles };
    queue.current = queue.current.then(async () => {
      for (const path of removed) {
        try { await wc.fs.rm(path); } catch (err) { log(`Could not remove ${path}: ${err.message}`); }
      }
      for (const [path, contents] of changed) {
        const directory = path.split('/').slice(0, -1).join('/');
        if (directory) await wc.fs.mkdir(directory, { recursive: true });
        await wc.fs.writeFile(path, contents);
      }
      log(`Synced ${changed.length} file(s)${removed.length ? `, removed ${removed.length}` : ''}. Vite will update the preview.`);
      if (changed.some(([path]) => path === 'package.json')) log('package.json changed — click Restart to reinstall dependencies.');
    }).catch((err) => { log(`Sync failed: ${err.message}`); setError(err.message); });
  }, [status, log]);

  return { status, previewUrl, logs, error, log, run, sync };
}
