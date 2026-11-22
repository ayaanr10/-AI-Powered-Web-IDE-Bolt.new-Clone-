import React, { useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { json } from '@codemirror/lang-json';
import {
  Activity, ArrowRight, ArrowUp, Bot, Braces, Check, ChevronDown, ChevronRight, CircleHelp,
  Code2, Copy, Download, ExternalLink, File, FileCode2, FileJson2, FilePlus2,
  Folder, FolderOpen, GitBranch, Globe, HardDrive, Layers3, LayoutPanelLeft,
  LoaderCircle, Maximize2, MessageSquare, Monitor, MoreHorizontal, PanelBottom,
  Play, Plus, RefreshCw, RotateCcw, Send, Settings2, ShieldCheck, Sparkles,
  Square, Terminal, Trash2, Upload, WandSparkles, X, Zap,
} from 'lucide-react';
import { seedProject } from '../shared/seed-project.js';
import { safePath, languageFor, validateFiles } from '../shared/filesystem.js';
import { StreamingArtifactParser } from '../shared/artifact-parser.js';
import { generateStream } from './lib/api.js';
import { downloadZip, readZip } from './lib/archive.js';
import { useWebContainer } from './lib/useWebContainer.js';

const STORAGE_KEY = 'promptforge-project-v1';
const suggested = [
  { icon: '✦', title: 'SaaS landing page', detail: 'Elegant hero, features & signup', prompt: 'Build a modern SaaS landing page for a creative productivity app. Make it responsive with interactive navigation and a working signup confirmation.' },
  { icon: '▣', title: 'Task manager', detail: 'Lists, completion & filtering', prompt: 'Build a beautiful, interactive task manager with add, complete, delete, filter and progress tracking.' },
  { icon: '◈', title: 'Analytics dashboard', detail: 'Metrics, visuals & controls', prompt: 'Build a clean analytics dashboard with metric cards, visual bar charts made with CSS, and interactive filters.' },
];
function loadFiles() {
  try { const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)); if (stored) return validateFiles(stored); }
  catch { /* fall back to the sample */ }
  return { ...seedProject };
}
function fileIcon(name) {
  if (name.endsWith('.json')) return <FileJson2 size={14} className="icon-json" />;
  if (name.endsWith('.css')) return <span className="type-css">#</span>;
  if (/\.[jt]sx?$/.test(name)) return <FileCode2 size={14} className="icon-js" />;
  if (name.endsWith('.html')) return <Globe size={14} className="icon-html" />;
  return <File size={14} />;
}
function buildTree(files) {
  const root = {};
  for (const path of Object.keys(files).sort()) {
    const parts = path.split('/'); let node = root;
    for (const piece of parts.slice(0, -1)) node = (node[piece] ??= { _folder: true, children: {} }).children;
    node[parts.at(-1)] = { _path: path };
  }
  return root;
}
function TreeBranch({ tree, depth = 0, activeFile, onSelect }) {
  return Object.entries(tree).sort(([a, x], [b, y]) => Number(Boolean(y._folder)) - Number(Boolean(x._folder)) || a.localeCompare(b)).map(([name, data]) =>
    data._folder
      ? <FolderBranch key={name} name={name} data={data} depth={depth} activeFile={activeFile} onSelect={onSelect} />
      : <button key={data._path} className={'tree-file ' + (activeFile === data._path ? 'active' : '')} style={{ paddingLeft: 16 + depth * 15 }} onClick={() => onSelect(data._path)} title={data._path}>{fileIcon(name)}<span>{name}</span>{activeFile === data._path && <span className="active-file-dot"/>}</button>
  );
}
function FolderBranch({ name, data, depth, activeFile, onSelect }) {
  const [open, setOpen] = useState(true);
  return <>
    <button className="tree-folder" style={{ paddingLeft: 8 + depth * 15 }} onClick={() => setOpen(!open)}>
      {open ? <ChevronDown size={13}/> : <ChevronRight size={13}/>} {open ? <FolderOpen size={15}/> : <Folder size={15}/>} <span>{name}</span>
    </button>
    {open && <TreeBranch tree={data.children} depth={depth + 1} activeFile={activeFile} onSelect={onSelect} />}
  </>;
}
function Indicator({ status }) {
  const map = {
    idle: ['muted', 'Not started'], booting: ['warn', 'Booting runtime'], installing: ['warn', 'Installing packages'],
    starting: ['warn', 'Starting server'], ready: ['good', 'Live preview ready'], error: ['bad', 'Runtime error'],
  };
  const [tone, label] = map[status] || map.idle;
  return <span className={'status-chip ' + tone}><span className="status-dot"/>{label}</span>;
}
function ChatMessage({ message }) {
  return <div className={'chat-message ' + message.role}>
    <div className="message-avatar">{message.role === 'user' ? 'Y' : <Sparkles size={15}/>}</div>
    <div className="message-main"><div className="message-name">{message.role === 'user' ? 'You' : 'PromptForge AI'}{message.role !== 'user' && <span>ASSISTANT</span>}</div><div className="message-content">{message.text}</div>{message.files?.length > 0 && <div className="generated-files"><Check size={12}/>{message.files.length} file(s) updated <span>{message.files.slice(0, 3).map((p) => p.split('/').at(-1)).join(', ')}</span></div>}</div>
  </div>;
}

export default function App() {
  const [files, setFiles] = useState(loadFiles);
  const filesRef = useRef(files);
  const [activeFile, setActiveFile] = useState('src/App.jsx');
  const [view, setView] = useState('preview');
  const [screen, setScreen] = useState('home');
  const [mode, setMode] = useState('demo');
  const [liveAvailable, setLiveAvailable] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [terminalVisible, setTerminalVisible] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [notification, setNotification] = useState('');
  const [messages, setMessages] = useState([{ role: 'assistant', text: 'Hey! Describe what you want to build. I’ll turn your idea into a React app with editable files and a real browser preview.' }]);
  const scrollRef = useRef(null);
  const abortRef = useRef(null);
  const importRef = useRef(null);
  const wc = useWebContainer();

  useEffect(() => { filesRef.current = files; try { localStorage.setItem(STORAGE_KEY, JSON.stringify(files)); } catch { /* storage full */ } }, [files]);
  useEffect(() => {
    const handler = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        document.querySelector('.composer .send-button')?.click();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  useEffect(() => { fetch('/api/health').then((r) => r.json()).then((d) => setLiveAvailable(Boolean(d.liveAvailable))).catch(() => {}); }, []);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, busy]);
  useEffect(() => {
    if (!['ready', 'starting'].includes(wc.status)) return;
    const id = setTimeout(() => wc.sync(files), 450);
    return () => clearTimeout(id);
  }, [files, wc.status]);
  useEffect(() => { if (!notification) return; const id = setTimeout(() => setNotification(''), 3500); return () => clearTimeout(id); }, [notification]);

  const extensions = useMemo(() => {
    const language = languageFor(activeFile);
    return language === 'javascript' ? [javascript({ jsx: true })] : language === 'css' ? [css()] : language === 'html' ? [html()] : language === 'json' ? [json()] : [];
  }, [activeFile]);
  const tree = useMemo(() => buildTree(files), [files]);
  const updateFile = (content) => { setFiles((old) => ({ ...old, [activeFile]: content })); };
  const addFile = () => {
    const path = window.prompt('New file path (example: src/components/Card.jsx):');
    if (path === null) return;
    if (!safePath(path)) return setNotification('Invalid path. Use safe relative paths without .. or backslashes.');
    if (files[path] !== undefined) return setNotification('That file already exists.');
    setFiles((old) => { try { return validateFiles({ ...old, [path]: '' }); } catch (err) { setNotification(err.message); return old; } });
    setActiveFile(path);
  };
  const removeFile = () => {
    if (['package.json', 'index.html', 'src/main.jsx'].includes(activeFile)) return setNotification('Core project files cannot be deleted from the editor.');
    if (!window.confirm(`Delete ${activeFile}?`)) return;
    setFiles((old) => { const next = { ...old }; delete next[activeFile]; return next; });
    setActiveFile('src/App.jsx');
  };
  const resetProject = () => {
    if (!window.confirm('Reset your workspace to the original starter app? Your current files will be replaced.')) return;
    abortRef.current?.abort();
    setFiles({ ...seedProject }); setActiveFile('src/App.jsx'); setMessages([{ role: 'assistant', text: 'Workspace reset. You’re ready for a new idea.' }]);
    setNotification('Starter project restored. Click Restart to refresh the browser runtime.');
  };
  const importProject = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    try { const incoming = await readZip(file); setFiles(incoming); setActiveFile(Object.keys(incoming).find((p) => p.endsWith('.jsx')) || 'index.html'); setNotification('Project imported. Click Restart to run its dependencies.'); }
    catch (err) { setNotification(`Import failed: ${err.message}`); }
    finally { e.target.value = ''; }
  };
  const generate = async (text = prompt) => {
    if (!text.trim() || busy) return;
    const request = text.trim();
    setScreen('workspace');
    setPrompt(''); setBusy(true);
    setMessages((m) => [...m, { role: 'user', text: request }, { role: 'assistant', text: 'Generating project files…', files: [] }]);
    const controller = new AbortController(); abortRef.current = controller;
    const parser = new StreamingArtifactParser();
    let responseMessage = '';
    const changed = [];
    try {
      let gotDone = false;
      for await (const event of generateStream({ prompt: request, files: filesRef.current, mode, signal: controller.signal })) {
        if (event.type === 'error') throw new Error(event.message);
        if (event.type === 'done') { gotDone = true; break; }
        if (event.type !== 'chunk') continue;
        const actions = parser.push(event.text);
        for (const action of actions) {
          if (action.type === 'message') responseMessage = action.content;
          else {
            setFiles((old) => {
              const next = { ...old };
              if (action.type === 'file') next[action.path] = action.content;
              else delete next[action.path];
              try { validateFiles(next); return next; } catch (err) { setNotification(err.message); return old; }
            });
            changed.push(action.path);
          }
        }
        setMessages((m) => [...m.slice(0, -1), { role: 'assistant', text: responseMessage || 'Writing application files…', files: [...changed] }]);
      }
      if (!gotDone) throw new Error('Stream disconnected before completion.');
      parser.finish();
      if (changed.length) setActiveFile(changed.find((p) => p.endsWith('.jsx')) || changed[0]);
      setMessages((m) => [...m.slice(0, -1), { role: 'assistant', text: responseMessage || `Updated ${changed.length} files.`, files: changed }]);
      setNotification(`Generated ${changed.length} file(s). ${wc.status === 'ready' ? 'Live preview will update.' : 'Click Run project to preview.'}`);
    } catch (err) {
      const cancelled = err.name === 'AbortError';
      setMessages((m) => [...m.slice(0, -1), { role: 'assistant', text: cancelled ? 'Generation stopped. Completed files were kept.' : `Generation error: ${err.message}`, files: changed }]);
    } finally { abortRef.current = null; setBusy(false); }
  };
  const fileCount = Object.keys(files).length;
  const statusText = { idle: 'Run to launch the app', booting: 'Booting Node.js', installing: 'Installing packages', starting: 'Starting Vite', ready: 'Application is live', error: 'Check terminal for details' }[wc.status];

  return <div className="buildora">
    <header className="simple-header">
      <button className="brand-link" onClick={() => setScreen('home')} title="Buildora home">
        <span className="brand-mark"><Braces size={20}/></span><span>buildora<span className="brand-accent">.</span></span>
      </button>
      <span className="header-description">AI-powered web IDE</span>
      <div className="header-actions">
        {screen === 'workspace' && <button className="quiet-button" onClick={() => setScreen('home')}><Plus size={16}/> New idea</button>}
        <button className="quiet-button" onClick={() => setShowInfo(true)}><CircleHelp size={16}/> About</button>
      </div>
    </header>

    {screen === 'home' ? <main className="welcome-page">
      <div className="welcome-eyebrow"><Sparkles size={15}/> BUILDORA STUDIO</div>
      <h1>From idea to <span>running application.</span></h1>
      <p className="welcome-description">Describe a website or app you want to build. Buildora creates editable React files that you can run and explore.</p>

      <form className="home-composer" onSubmit={(event) => { event.preventDefault(); generate(); }}>
        <textarea aria-label="Describe your app idea" placeholder="Build a personal portfolio with an About section, projects and a contact form..." value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); generate(); } }} rows={4}/>
        <div className="composer-bottom">
          <label className="mode-control"><span>Mode</span><select aria-label="Generation mode" value={mode} onChange={(e) => setMode(e.target.value)}><option value="demo">Demo (no key)</option><option value="live" disabled={!liveAvailable}>Gemini AI {!liveAvailable ? '(available when configured locally)' : ''}</option></select></label>
          <button className="primary-action" type="submit" disabled={!prompt.trim() || busy}>Generate app <ArrowRight size={16}/></button>
        </div>
      </form>
      <div className="example-section"><span>OR TRY AN EXAMPLE</span><div className="example-buttons">{suggested.map((item) => <button key={item.title} className="example-button" onClick={() => generate(item.prompt)} disabled={busy}>{item.title} <ArrowUp size={14}/></button>)}</div></div>
      <div className="welcome-steps"><div><span>01</span><strong>Describe an idea</strong><small>Write what you want in plain English.</small></div><div><span>02</span><strong>Generate your code</strong><small>See React files created automatically.</small></div><div><span>03</span><strong>Run and edit</strong><small>Preview the app and change its code.</small></div></div>
      <button className="existing-project" onClick={() => setScreen('workspace')}><Code2 size={16}/> Open existing workspace <ArrowRight size={15}/></button>
    </main> : <main className="studio-page">
      <div className="studio-heading">
        <div><span className="studio-eyebrow">YOUR WORKSPACE</span><h1>Build your next idea.</h1><p>Ask Buildora to make changes, edit the code, or run your app.</p></div>
        <div className="studio-actions">
          <button className="quiet-button" onClick={() => importRef.current?.click()}><Upload size={15}/> Import</button>
          <button className="quiet-button" onClick={() => downloadZip(files)}><Download size={15}/> Export code</button>
        </div>
      </div>
      <div className="studio-grid">
        <section className="studio-panel assistant-panel">
          <div className="simple-panel-title"><div><Sparkles size={18}/><strong>Build with AI</strong></div><span className="small-label">{mode === 'demo' ? 'Demo mode' : 'Gemini AI'}</span></div>
          <div className="conversation-list" ref={scrollRef}>
            {messages.map((message, index) => <ChatMessage key={index} message={message}/>)}
            {busy && <div className="progress-note"><LoaderCircle size={15} className="spinning"/> Creating your app... <button onClick={() => abortRef.current?.abort()}>Stop</button></div>}
          </div>
          <form className="studio-composer" onSubmit={(event) => { event.preventDefault(); generate(); }}>
            <textarea aria-label="Ask Buildora to change your app" placeholder="Add a dark mode toggle..." rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); generate(); } }}/>
            <div className="composer-bottom">
              <select aria-label="Generation mode" value={mode} onChange={(e) => setMode(e.target.value)}><option value="demo">Demo</option><option value="live" disabled={!liveAvailable}>Gemini AI {!liveAvailable ? '(local setup)' : ''}</option></select>
              <button className="primary-action" type="submit" disabled={busy || !prompt.trim()}>{busy ? 'Creating...' : 'Generate'} <ArrowUp size={15}/></button>
            </div>
          </form>
        </section>
        <section className="studio-panel editor-panel">
          <div className="simple-panel-title"><div><Code2 size={18}/><strong>Code editor</strong></div><span className="small-label">{fileCount} files</span></div>
          <div className="editor-workarea">
            <nav className="simple-files" aria-label="Project files"><div className="files-heading"><span>FILES</span><button onClick={addFile} aria-label="Add file" title="Add file"><FilePlus2 size={17}/></button></div><TreeBranch tree={tree} activeFile={activeFile} onSelect={setActiveFile}/></nav>
            <div className="simple-editor"><div className="editor-file-heading"><span>{fileIcon(activeFile)} {activeFile}</span><button className="icon-only" onClick={removeFile} title="Delete selected file" aria-label="Delete file"><Trash2 size={15}/></button></div><div className="editor-code"><CodeMirror key={activeFile} value={files[activeFile] ?? ''} height="100%" theme="dark" extensions={extensions} onChange={updateFile} basicSetup={{ foldGutter: true, highlightActiveLine: true, lineNumbers: true, autocompletion: true }}/></div></div>
          </div>
          <div className="editor-footer"><span><Check size={13}/> Auto-saved in your browser</span><button onClick={() => setTerminalVisible(!terminalVisible)}><Terminal size={15}/> {terminalVisible ? 'Hide logs' : 'Show logs'}</button></div>
          {terminalVisible && <div className="simple-logs">{wc.logs.map((line,index) => <div key={index}>{line}</div>)}{wc.error && <p>{wc.error}</p>}</div>}
        </section>
        <section className="studio-panel live-panel">
          <div className="simple-panel-title"><div><Monitor size={18}/><strong>Live preview</strong></div><Indicator status={wc.status}/></div>
          <div className="preview-actions"><span>{statusText}</span><div><button className="quiet-button" onClick={() => wc.run(filesRef.current)} disabled={['booting','installing','starting'].includes(wc.status)}><Play size={15}/> {wc.status === 'ready' ? 'Restart' : 'Run app'}</button><button className="icon-only" disabled={!wc.previewUrl} onClick={() => window.open(wc.previewUrl,'_blank','noopener,noreferrer')} aria-label="Open preview in a new tab" title="Open preview"><ExternalLink size={15}/></button></div></div>
          <div className="simple-preview">{wc.previewUrl ? <iframe key={wc.previewUrl} src={wc.previewUrl} title="Generated application preview" allow="cross-origin-isolated; clipboard-read; clipboard-write"/> : <div className="preview-placeholder"><div className="placeholder-icon"><Monitor size={34}/></div><h2>{['booting','installing','starting'].includes(wc.status) ? 'Preparing your app...' : 'See your app here'}</h2><p>{wc.error || 'Click Run app to launch your React project in the browser.'}</p><button className="primary-action" onClick={() => wc.run(filesRef.current)} disabled={['booting','installing','starting'].includes(wc.status)}>{['booting','installing','starting'].includes(wc.status) ? 'Starting...' : 'Run app'} <ArrowRight size={16}/></button></div>}</div>
          <div className="preview-help">The preview runs with WebContainers. The first start may need to install packages.</div>
        </section>
      </div>
      <div className="studio-bottom"><span>React + Vite · Gemini or Demo · Browser preview</span><button onClick={resetProject}><RotateCcw size={13}/> Reset project</button></div>
    </main>}

    <input ref={importRef} type="file" accept=".zip,application/zip" hidden onChange={importProject}/>
    {notification && <div className="simple-toast" role="status"><Sparkles size={16}/>{notification}<button onClick={() => setNotification('')} aria-label="Dismiss"><X size={15}/></button></div>}
    {showInfo && <div className="simple-overlay" onClick={() => setShowInfo(false)}><div className="simple-dialog" role="dialog" aria-modal="true" aria-label="About Buildora" onClick={(e) => e.stopPropagation()}><button className="dialog-close" onClick={() => setShowInfo(false)} aria-label="Close"><X size={18}/></button><div className="brand-mark"><Braces size={22}/></div><h2>About Buildora</h2><p>Buildora turns your idea into React source files. A small Node.js server streams demo or Gemini-generated changes, a parser updates the files, and WebContainers run the app inside your browser.</p><p>Your edits are stored locally in this browser. The Gemini API key belongs on the Node server, never in the frontend.</p><button className="primary-action" onClick={() => setShowInfo(false)}>Got it <Check size={16}/></button></div></div>}
  </div>;
}
