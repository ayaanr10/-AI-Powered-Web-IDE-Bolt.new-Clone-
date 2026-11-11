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

  return <div className="workspace">
    <div className="topbar">
      <div className="brand-zone"><div className="brand-icon"><Braces size={19} strokeWidth={2.8}/></div><span className="brand-name">promptforge<span className="brand-period">.</span></span><span className="brand-divider"/><span className="project-name"><Layers3 size={14}/> My workspace <ChevronDown size={13}/></span></div>
      <div className="header-center"><span className="workspace-tag"><span className="workspace-tag-dot"/> PERSONAL WORKSPACE</span><span className="top-caption">Built for ideas that ship.</span></div>
      <div className="top-actions"><span className="local-only"><HardDrive size={13}/> Saved locally</span><button className="header-button" onClick={() => importRef.current?.click()} title="Import a Vite project ZIP"><Upload size={15}/> <span>Import</span></button><button className="header-button export" onClick={() => downloadZip(files)}><Download size={15}/> <span>Export code</span></button><button className="icon-button info-button" onClick={() => setShowInfo(true)} aria-label="About project"><CircleHelp size={18}/></button></div>
      <input ref={importRef} type="file" accept=".zip,application/zip" hidden onChange={importProject} />
    </div>
    <div className="main-layout">
      <aside className="chat-panel">
        <div className="panel-heading chat-heading"><div className="panel-heading-label"><span className="heading-icon"><WandSparkles size={16}/></span><div><strong>AI Assistant</strong><small>Your creative copilot</small></div></div><div className="sparkle-chip"><Sparkles size={11}/> GENERATE</div></div>
        <div className="chat-scroller" ref={scrollRef}>
          <div className="chat-intro"><div className="intro-orb"><Sparkles size={25}/></div><span className="intro-label">AI-POWERED WORKSPACE</span><h2>What will you <em>build today?</em></h2><p>Describe it in your own words. Watch it become a real, editable app.</p></div>
          <div className="suggested-section"><div className="section-kicker">START WITH AN IDEA <span>✦</span></div><div className="prompt-cards">{suggested.map((item) => <button key={item.title} className="prompt-card" onClick={() => generate(item.prompt)} disabled={busy}><span className="suggestion-icon">{item.icon}</span><span className="suggestion-text"><strong>{item.title}</strong><small>{item.detail}</small></span><ArrowRight size={15}/></button>)}</div></div>
          <div className="conversation"><div className="section-kicker">CONVERSATION</div>{messages.map((message, i) => <ChatMessage key={i} message={message}/>)}</div>
          {busy && <div className="streaming"><span className="pulse-three"><i/><i/><i/></span> Creating your app… <button onClick={() => abortRef.current?.abort()}>Stop</button></div>}
        </div>
        <div className="composer"><div className="composer-header"><span><span className="mode-led"/> MODEL</span><select aria-label="Generation mode" value={mode} onChange={(e) => setMode(e.target.value)}><option value="demo">Demo · no API key</option><option value="live">Gemini · Live AI{!liveAvailable ? ' (setup needed)' : ''}</option></select></div><form onSubmit={(e) => { e.preventDefault(); generate(); }}><textarea aria-label="Describe your project" placeholder="Ask anything… e.g. Build a finance dashboard with charts and filters" value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); generate(); } }} rows={3}/><div className="composer-footer"><span><Zap size={13}/> Shift + Enter for new line</span><button className="send-button" type="submit" disabled={busy || !prompt.trim()} aria-label="Generate app">{busy ? <LoaderCircle size={16} className="spinning"/> : <ArrowUp size={17} strokeWidth={2.8}/>}</button></div></form><div className="composer-warning"><ShieldCheck size={13}/> API key stays on the local Node server</div></div>
      </aside>
      <section className="code-panel">
        <div className="panel-heading code-heading"><div className="panel-heading-label"><Code2 size={17} className="heading-line-icon"/><div><strong>Code editor</strong><small>Explore & edit your project</small></div></div><span className="file-counter">{fileCount} FILES</span></div>
        <div className="code-body"><div className="file-explorer"><div className="explorer-title"><span>EXPLORER</span><button className="tiny-button" aria-label="New file" onClick={addFile} title="New file"><FilePlus2 size={15}/></button></div><div className="project-tree"><div className="root-folder"><ChevronDown size={13}/> <FolderOpen size={15}/> <span>PROMPTFORGE-APP</span></div><TreeBranch tree={tree} activeFile={activeFile} onSelect={setActiveFile}/></div><div className="explorer-bottom"><GitBranch size={14}/> main <span>●</span> local changes</div></div>
          <div className="editor-side"><div className="file-tab"><span className="file-tab-name">{fileIcon(activeFile)} {activeFile.split('/').at(-1)}</span><span className="tab-path">{activeFile}</span><button title="Delete file" className="tiny-button" onClick={removeFile}><Trash2 size={14}/></button></div><div className="code-mirror"><CodeMirror key={activeFile} value={files[activeFile] ?? ''} height="100%" theme="dark" extensions={extensions} onChange={updateFile} basicSetup={{ foldGutter: true, highlightActiveLine: true, lineNumbers: true, autocompletion: true }} /></div><div className="editor-status"><div><span className="green-mini"/> JavaScript ES6+ <span className="status-separator">│</span> UTF-8</div><div><Check size={13}/> Autosaved locally</div></div></div></div>
        <div className="terminal-bar"><button className={'terminal-toggle '+(terminalVisible ? 'terminal-active' : '')} onClick={() => setTerminalVisible(!terminalVisible)}><Terminal size={15}/> TERMINAL <ChevronDown size={13} className={terminalVisible ? 'rotated' : ''}/></button><div className="terminal-caption"><span className="green-mini"/> {statusText}</div><button className="tiny-button" title="Toggle terminal" onClick={() => setTerminalVisible(!terminalVisible)}><PanelBottom size={15}/></button></div>
        {terminalVisible && <div className="terminal-console">{wc.logs.map((line, i) => <div key={i}><span className="prompt-symbol">›</span>{line}</div>)}{wc.error && <p className="terminal-error">{wc.error}</p>}</div>}
      </section>
      <section className="preview-panel"><div className="panel-heading preview-heading"><div className="panel-heading-label"><Monitor size={17} className="heading-line-icon"/><div><strong>Live preview</strong><small>See your app come to life</small></div></div><Indicator status={wc.status}/></div>
        <div className="preview-toolbar"><div className="preview-tabs"><button className={view === 'preview' ? 'selected' : ''} onClick={() => setView('preview')}><Globe size={14}/> Preview</button><button className={view === 'details' ? 'selected' : ''} onClick={() => setView('details')}><Activity size={14}/> Details</button></div><div className="preview-tools"><button className="tool-button" title="Restart runtime / reinstall packages" onClick={() => wc.run(filesRef.current)} disabled={wc.status === 'booting' || wc.status === 'installing'}><RefreshCw size={15}/></button><button className="tool-button" title="Open preview in new tab" disabled={!wc.previewUrl} onClick={() => window.open(wc.previewUrl, '_blank', 'noopener,noreferrer')}><ExternalLink size={15}/></button></div></div>
        <div className="address-bar"><span className="browser-controls"><i/><i/><i/></span><span className="address"><ShieldCheck size={13}/>{wc.previewUrl || 'localhost:5173 / browser preview'}</span><button onClick={() => wc.run(filesRef.current)} aria-label="Run or restart app" title="Run app"><Play size={14} fill="currentColor"/></button></div>
        <div className="preview-surface">
          {view === 'details' ? <div className="details-view"><div className="details-header"><span><Activity size={17}/> RUNTIME OVERVIEW</span><h2>Under the hood.</h2><p>A browser-native development environment with a real Node.js process.</p></div><div className="detail-rows"><div><strong>Runtime</strong><span>WebContainers API</span></div><div><strong>Framework</strong><span>React + Vite</span></div><div><strong>AI mode</strong><span>{mode === 'demo' ? 'Deterministic demo' : 'Google Gemini'}</span></div><div><strong>Project files</strong><span>{fileCount} editable files</span></div><div><strong>Status</strong><span>{wc.status}</span></div><div><strong>Storage</strong><span>Browser localStorage</span></div></div><button className="primary-button" onClick={() => setView('preview')}>Back to preview <ArrowRight size={15}/></button></div> : wc.previewUrl ? <iframe key={wc.previewUrl} className="preview-iframe" src={wc.previewUrl} title="Generated application preview" allow="cross-origin-isolated; clipboard-read; clipboard-write"/> : <div className="preview-empty"><div className="preview-empty-art"><div className="art-halo"/><div className="art-window"><div className="art-header"><i/><i/><i/><span/></div><div className="art-body"><span className="art-pill"/><span className="art-title"/><span className="art-title short"/><span className="art-copy"/><span className="art-copy small"/><span className="art-btn"/></div></div><div className="art-flower">✳</div><div className="art-star">✦</div></div><div className="empty-caption"><h3>{['booting', 'installing', 'starting'].includes(wc.status) ? 'Preparing your workspace…' : 'Your canvas awaits.'}</h3><p>{wc.status === 'error' ? wc.error : 'Start your project to see a real React app running right here in your browser.'}</p></div><button className="run-button" onClick={() => wc.run(filesRef.current)} disabled={['booting', 'installing', 'starting'].includes(wc.status)}>{['booting', 'installing', 'starting'].includes(wc.status) ? <LoaderCircle size={16} className="spinning"/> : <Play size={15} fill="currentColor"/>}{['booting', 'installing', 'starting'].includes(wc.status) ? 'Preparing...' : 'Run project'} <ArrowRight size={15}/></button><span className="preview-tip">Powered by WebContainers · No local CLI needed to run generated apps</span></div>}
        </div><div className="preview-bottom"><div><span className="live-dot"/> WEB PREVIEW <span className="status-separator">│</span> <span>localhost</span></div><div><Zap size={13}/> Vite HMR enabled</div></div>
      </section>
    </div>
    <div className="bottom-bar"><div><span className="bottom-logo"><Braces size={13}/></span> PromptForge <span className="bottom-separator">/</span> AI-powered web IDE <span className="bottom-separator">/</span> v1.0</div><div><span className="bottom-led"/> All changes saved <span className="bottom-separator">│</span> <span className="shortcut">⌘ / Ctrl + Enter</span> to ship your idea</div></div>
    {notification && <div className="toast"><Sparkles size={16}/>{notification}<button aria-label="Dismiss" onClick={() => setNotification('')}><X size={14}/></button></div>}
    {showInfo && <div className="modal-backdrop" onClick={() => setShowInfo(false)}><div className="info-modal" onClick={(e) => e.stopPropagation()}><button className="modal-close" onClick={() => setShowInfo(false)}><X size={18}/></button><div className="modal-mark"><Braces size={27}/></div><h2>Made to be understood.</h2><p>PromptForge is a full-stack learning project, not just a mockup. Natural-language prompts produce XML file operations, the parser updates a virtual filesystem, CodeMirror edits files, and WebContainers run the React project in your browser.</p><div className="modal-stack"><span>React 19</span><span>Node.js</span><span>Gemini API</span><span>WebContainers</span><span>CodeMirror</span><span>Vite</span></div><button className="primary-button" onClick={() => { setShowInfo(false); setView('details'); }}>Explore architecture <ArrowRight size={15}/></button></div></div>}
  </div>;
}
