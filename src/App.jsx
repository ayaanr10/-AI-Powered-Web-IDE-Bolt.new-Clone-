import React, { useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { json } from '@codemirror/lang-json';
import {
  Activity, ArrowRight, ArrowUp, Bot, Check, ChevronDown, ChevronRight, CircleHelp,
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
  { icon: '◈', title: 'Restaurant website', detail: 'Menu, categories & booking form', prompt: 'Build a restaurant website with a food menu, category filters and a reservation form.' },
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
    <div className="message-main"><div className="message-name">{message.role === 'user' ? 'You' : 'Buildora AI'}{message.role !== 'user' && <span>ASSISTANT</span>}</div><div className="message-content">{message.text}</div>{message.files?.length > 0 && <div className="generated-files"><Check size={12}/>{message.files.length} file(s) updated <span>{message.files.slice(0, 3).map((p) => p.split('/').at(-1)).join(', ')}</span></div>}</div>
  </div>;
}

export default function App() {
  const [files, setFiles] = useState(loadFiles);
  const filesRef = useRef(files);
  const [activeFile, setActiveFile] = useState('src/App.jsx');
  const [screen, setScreen] = useState('home');
  const [zapAvailable, setZapAvailable] = useState(false);
  const [zapMessage, setZapMessage] = useState('Connecting to AI builder...');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [terminalVisible, setTerminalVisible] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showFullPreview, setShowFullPreview] = useState(false);
  const [notification, setNotification] = useState('');
  const [generationError, setGenerationError] = useState('');
  const [messages, setMessages] = useState([{ role: 'assistant', text: 'Hey! Describe what you want to build. I’ll turn your idea into a React app with editable files and a real browser preview.' }]);
  const scrollRef = useRef(null);
  const abortRef = useRef(null);
  const importRef = useRef(null);
  const wc = useWebContainer();

  useEffect(() => { filesRef.current = files; try { localStorage.setItem(STORAGE_KEY, JSON.stringify(files)); } catch { /* storage full */ } }, [files]);
  useEffect(() => {
    fetch('/api/health')
      .then((response) => response.json())
      .then((data) => {
        setZapAvailable(Boolean(data.zapAvailable));
        setZapMessage(data.zapMessage || 'AI builder is not configured on this server.');
      })
      .catch(() => {
        setZapAvailable(false);
        setZapMessage('AI connection could not be checked. You can still try generating.');
      });
  }, []);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, busy]);
  useEffect(() => {
    if (!['ready', 'starting'].includes(wc.status)) return;
    const id = setTimeout(() => wc.sync(files), 450);
    return () => clearTimeout(id);
  }, [files, wc.status]);
  useEffect(() => { if (!notification) return; const id = setTimeout(() => setNotification(''), 3500); return () => clearTimeout(id); }, [notification]);
  useEffect(() => {
    if (!showFullPreview) return;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setShowFullPreview(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showFullPreview]);

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
    setNotification('Starter project restored. Click Run app to refresh the preview.');
  };
  const importProject = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    try { const incoming = await readZip(file); setFiles(incoming); setActiveFile(Object.keys(incoming).find((p) => p.endsWith('.jsx')) || 'index.html'); setNotification('Project imported. Click Restart to run its dependencies.'); }
    catch (err) { setNotification(`Import failed: ${err.message}`); }
    finally { e.target.value = ''; }
  };
  // Health is informational, not a permanent client-side gate.
  const zapStatus = zapAvailable ? 'Ready' : 'Check connection';
  const generate = async (text = prompt) => {
    if (!text.trim() || busy) return;
    const request = text.trim();
    if (request.length > 2000) { setNotification('Keep the prompt under 2000 characters.'); return; }
    if (abortRef.current) return;
    // Zap is our product name; Google's Gemini runs privately on the server.
    const generatorName = 'Buildora AI';
    setScreen('workspace');
    setPrompt('');
    setBusy(true);
    setGenerationError('');
    setMessages((old) => [
      ...old,
      { role: 'user', text: request },
      { role: 'assistant', text: `Generating with ${generatorName}…`, files: [] },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 140000);
    let parser = new StreamingArtifactParser();
    const pendingActions = [];
    let responseMessage = '';

    try {
      let finished = false;
      let projectReceived = false;
      for await (const event of generateStream({
        prompt: request,
        files: filesRef.current,
        signal: controller.signal,
      })) {
        if (event.type === 'progress') {
          setMessages(old=>[...old.slice(0,-1),{role:'assistant',text:event.message}]);
          continue;
        }
        if (event.type === 'project') {
          if (!Array.isArray(event.actions)) throw new Error('Invalid project response.');
          pendingActions.length=0; pendingActions.push(...event.actions);
          responseMessage=event.message; projectReceived=true;
          continue;
        }
        if (event.type === 'restart') {
          parser = new StreamingArtifactParser(); pendingActions.length = 0; responseMessage = '';
          setMessages(old => [...old.slice(0,-1), {role:'assistant',text:'Trying a backup AI model…'}]);
          continue;
        }
        if (event.type === 'error') throw new Error(event.message);
        if (event.type === 'done') { finished = true; break; }
        if (event.type !== 'chunk') continue;

        for (const action of parser.push(event.text)) {
          if (action.type === 'message') {
            responseMessage = action.content;
          } else {
            // Don't change the previous working app until generation succeeds.
            pendingActions.push(action);
          }
        }
        setMessages((old) => [
          ...old.slice(0, -1),
          { role: 'assistant', text: responseMessage || `${generatorName} is writing files…` },
        ]);
      }

      if (!finished) throw new Error('The generation connection closed before completion.');
      if (!projectReceived) parser.finish();
      if (!pendingActions.length) throw new Error('No project files were generated. Try a more specific request.');

      const updated = { ...filesRef.current };
      for (const action of pendingActions) {
        if (action.type === 'file') updated[action.path] = action.content;
        if (action.type === 'delete') delete updated[action.path];
      }
      validateFiles(updated);
      const changed = [...new Set(pendingActions.map((action) => action.path))];

      setFiles(updated);
      setActiveFile(changed.find((path) => path.endsWith('.jsx')) || changed[0]);
      setMessages((old) => [
        ...old.slice(0, -1),
        {
          role: 'assistant',
          text: `${generatorName}: ${responseMessage || `Updated ${changed.length} file(s).`}`,
          files: changed,
        },
      ]);
      setNotification(`${generatorName} generated ${changed.length} file(s). ${wc.status === 'ready' ? 'Preview will update.' : 'Click Run app to preview.'}`);
    } catch (err) {
      const cancelled = err.name === 'AbortError';
      const detail = cancelled ? 'Generation stopped.' : (err.message || 'Unknown generation error.');
      setGenerationError(detail);
      setPrompt(current => current || request);
      setMessages((old) => [
        ...old.slice(0, -1),
        { role: 'assistant', text: `${generatorName} failed: ${detail} Previous app was kept unchanged.`, files: [] },
      ]);
      setNotification('Generation did not finish. The previous app was kept; see the error above.');
    } finally {
      clearTimeout(timeout);
      abortRef.current = null;
      setBusy(false);
    }
  };
  const lastReply = [...messages].reverse().find((message) => message.role === 'assistant');
  const fileCount = Object.keys(files).length;
  const statusText = { idle: 'Run to launch the app', booting: 'Booting Node.js', installing: 'Installing packages', starting: 'Starting Vite', ready: 'Application is live', error: 'Check terminal for details' }[wc.status];

  return <div className="buildora">
    <header className="site-header">
      <button className="site-brand" onClick={() => setScreen('home')} aria-label="Buildora home">
        <span className="brand-symbol"><img src="/buildora-mark.svg" alt="" /></span>
        <span>Buildora<span className="brand-dot">.</span></span>
      </button>
      <span className="header-subtitle">AI-powered web IDE</span>
      <div className="header-right">
        {screen === 'workspace' && <>
          <span className="project-name"><Layers3 size={15}/> My project</span>
          <button className="light-button" onClick={() => importRef.current?.click()}><Upload size={15}/> Import</button>
          <button className="light-button" onClick={() => downloadZip(files)}><Download size={15}/> Export code</button>
          <button className="blue-button" onClick={() => wc.run(filesRef.current)} disabled={['booting','installing','starting'].includes(wc.status)}><Play size={15}/> {['booting','installing','starting'].includes(wc.status) ? 'Starting' : wc.status === 'ready' ? 'Restart' : 'Run app'}</button>
        </>}
        <button className="header-help" title="About Buildora" aria-label="About Buildora" onClick={() => setShowInfo(true)}><CircleHelp size={19}/></button>
      </div>
    </header>

    {screen === 'home' ?
      <main className="home-layout">
        <aside className="home-sidebar">
          <div className="sidebar-label">WORKSPACE</div>
          <button className="sidebar-button selected" onClick={() => { setPrompt(''); setScreen('home'); }}><Plus size={17}/> New project</button>
          <button className="sidebar-button" onClick={() => setScreen('workspace')}><Code2 size={17}/> Open workspace</button>
          <div className="sidebar-label examples-label">GET STARTED</div>
          {suggested.map((item) => <button key={item.title} className="sidebar-button template-link" onClick={() => generate(item.prompt)} disabled={busy}><Sparkles size={15}/> {item.title}</button>)}
          <div className="sidebar-tip"><ShieldCheck size={17}/><span>Projects are saved in this browser.</span></div>
        </aside>
        <section className="home-center">
          <div className="home-eyebrow"><Sparkles size={15}/> BUILT FOR IDEAS</div>
          <h1>What should we <span>build today?</span></h1>
          <p className="home-description">Describe your idea. Buildora turns it into editable React code with a real browser preview.</p>
          <form className="home-prompt" onSubmit={(event) => { event.preventDefault(); generate(); }}>
            <textarea aria-label="Describe what you want to build" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Ask Buildora to build a portfolio, task manager, landing page..." rows={4} maxLength={2000} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); generate(); } }}/>
            <div className="home-prompt-footer">
              <div className="zap-connection"><Zap size={16}/><strong>Buildora AI</strong><span className={zapAvailable ? 'zap-online' : 'zap-offline'}>{zapStatus}</span></div>
              <button className="blue-button" type="submit" disabled={busy || !prompt.trim()}>Build now <ArrowRight size={16}/></button>
            </div>
            {!zapAvailable && <p className="zap-setup-note" role="status">{zapMessage}</p>}
          </form>
          <div className="home-examples"><span>Try an example</span><div>{suggested.map((item) => <button key={item.title} onClick={() => generate(item.prompt)} disabled={busy}>{item.title} <ArrowUp size={13}/></button>)}</div></div>
          <div className="home-footnote"><Check size={16}/> Edit the code <span/> <Check size={16}/> Run a preview <span/> <Check size={16}/> Export your project</div>
        </section>
      </main>
    :
      <main className="workspace-layout">
        <aside className="workspace-sidebar">
          <button className="workspace-nav active" onClick={() => setScreen('workspace')}><FolderOpen size={18}/> Files</button>
          <button className="workspace-nav" onClick={() => setScreen('home')}><Plus size={17}/> New idea</button>
          <div className="workspace-sidebar-divider"/>
          <div className="files-heading"><span>PROJECT FILES</span><button onClick={addFile} aria-label="Add a project file" title="Add a file"><Plus size={17}/></button></div>
          <div className="project-file-tree"><TreeBranch tree={tree} activeFile={activeFile} onSelect={setActiveFile}/></div>
          <div className="sidebar-footer"><HardDrive size={16}/> Saved locally</div>
        </aside>

        <section className="workspace-content">
          <section className="prompt-panel">
            <div className="section-title"><Sparkles size={19}/><h2>Prompt</h2></div>
            <form onSubmit={(event) => { event.preventDefault(); generate(); }}>
              <textarea aria-label="Describe what to build or change" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Build a task manager with add, complete and delete features..." rows={3} maxLength={2000} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); generate(); } }}/>
              {!zapAvailable && <p className="zap-setup-note" role="status">{zapMessage}</p>}
              <div className="prompt-actions">
                <div className="zap-connection"><Zap size={16}/><strong>Buildora AI</strong><span className={zapAvailable ? 'zap-online' : 'zap-offline'}>{zapStatus}</span></div>
                <div className="prompt-action-buttons">
                  {suggested.slice(0, 2).map((item) => <button type="button" className="prompt-suggestion" key={item.title} onClick={() => generate(item.prompt)} disabled={busy}>+ {item.title}</button>)}
                  <button type="submit" className="blue-button" disabled={!prompt.trim() || busy}>{busy ? <><LoaderCircle size={16} className="spinning"/> Generating</> : <><Sparkles size={16}/> Generate</>}</button>
                </div>
              </div>
            </form>
            <div className="generation-status" role="status">
              {busy ? <><LoaderCircle size={15} className="spinning"/> Generating with Buildora AI… <button onClick={() => abortRef.current?.abort()}>Stop</button></> : generationError ? <><CircleHelp size={15} color="#bf3d3d"/> <span className="generation-error">{generationError} — previous app kept unchanged.</span></> : <><Check size={15}/> {lastReply?.text || 'Ready to build.'}</>}
              <details className="activity-details"><summary>Activity</summary><div className="activity-log" ref={scrollRef}>{messages.map((message,index) => <ChatMessage key={index} message={message}/>)}</div></details>
            </div>
          </section>

          <div className="workspace-panels">
            <section className="code-panel">
              <div className="panel-title"><div><Code2 size={18}/><h2>Code</h2></div><span>{fileCount} files</span></div>
              <div className="code-file-tab"><span>{fileIcon(activeFile)} {activeFile}</span><button onClick={removeFile} aria-label="Delete selected file" title="Delete selected file"><Trash2 size={15}/></button></div>
              <div className="editor-surface"><CodeMirror key={activeFile} value={files[activeFile] ?? ''} height="100%" theme="light" extensions={extensions} onChange={updateFile} basicSetup={{ foldGutter: true, highlightActiveLine: true, lineNumbers: true, autocompletion: true }}/></div>
              <div className="code-footer"><span><Check size={14}/> Autosaved locally</span><button onClick={() => setTerminalVisible(!terminalVisible)}><Terminal size={15}/>{terminalVisible ? 'Hide logs' : 'Show logs'}</button></div>
              {terminalVisible && <div className="terminal-log">{wc.logs.map((line,index) => <div key={index}>{line}</div>)}{wc.error && <p>{wc.error}</p>}</div>}
            </section>

            <section className="preview-panel">
              <div className="panel-title"><div><Monitor size={18}/><h2>Preview</h2></div><Indicator status={wc.status}/></div>
              <div className="preview-controls"><span>{statusText}</span><div><button className="icon-control" onClick={() => wc.run(filesRef.current)} title="Run or restart preview" aria-label="Run or restart preview" disabled={['booting','installing','starting'].includes(wc.status)}><RefreshCw size={15}/></button><button className="icon-control" onClick={() => setShowFullPreview(true)} disabled={!wc.previewUrl} title="Expand generated preview" aria-label="Expand generated preview"><Maximize2 size={15}/></button></div></div>
              <div className="preview-surface">{wc.previewUrl ? <iframe key={wc.previewUrl} src={wc.previewUrl} title="Generated application preview" allow="cross-origin-isolated; clipboard-read; clipboard-write"/> : <div className="preview-empty"><div className="preview-placeholder-icon"><Monitor size={30}/></div><h3>{['booting','installing','starting'].includes(wc.status) ? 'Preparing your app…' : 'Your app will appear here'}</h3><p>{wc.error || 'Run your project to see the generated React app in action.'}</p><button className="blue-button" onClick={() => wc.run(filesRef.current)} disabled={['booting','installing','starting'].includes(wc.status)}><Play size={15}/>{['booting','installing','starting'].includes(wc.status) ? 'Starting…' : 'Run app'}</button></div>}</div>
              <div className="preview-footer">Powered by React, Vite &amp; WebContainers</div>
            </section>
          </div>
          <div className="workspace-bottom"><span>Buildora · Browser-based development workspace</span><button onClick={resetProject}><RotateCcw size={14}/> Reset files</button></div>
        </section>
      </main>
    }

    {showFullPreview && wc.previewUrl && <div className="full-preview-backdrop" role="dialog" aria-modal="true" aria-label="Expanded generated application preview">
      <div className="full-preview-window">
        <div className="full-preview-header">
          <div><Monitor size={18}/><strong>Generated app preview</strong><span>Full-size view</span></div>
          <button className="light-button" onClick={() => setShowFullPreview(false)} aria-label="Close expanded preview"><X size={17}/> Back to editor</button>
        </div>
        <iframe src={wc.previewUrl} title="Full-size generated application preview" allow="cross-origin-isolated; clipboard-read; clipboard-write"/>
      </div>
    </div>}
    <input ref={importRef} type="file" accept=".zip,application/zip" hidden onChange={importProject}/>
    {notification && <div className="app-toast" role="status"><Sparkles size={16}/><span>{notification}</span><button onClick={() => setNotification('')} aria-label="Dismiss notification"><X size={16}/></button></div>}
    {showInfo && <div className="modal-backdrop" onClick={() => setShowInfo(false)}><div className="about-modal" role="dialog" aria-modal="true" aria-label="About Buildora" onClick={(event) => event.stopPropagation()}><button className="close-modal" onClick={() => setShowInfo(false)} title="Close dialog" aria-label="Close"><X size={20}/></button><div className="about-mark"><img src="/buildora-mark.svg" alt="" /></div><h2>Buildora</h2><p>Describe an app, then explore its editable React files and live preview. The frontend sends requests to an Express API. Buildora uses a private server-side Gemini connection to stream source code into our file parser.</p><p>Files are saved locally in this browser. AI generation uses a server-side API key with public demo request limits.</p><button className="blue-button" onClick={() => setShowInfo(false)}>Got it <Check size={16}/></button></div></div>}
  </div>;
}
