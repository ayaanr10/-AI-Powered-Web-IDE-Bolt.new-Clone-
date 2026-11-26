import {posix as path} from 'node:path';
import {streamGeminiText} from './gemini.js';
import {SYSTEM_PROMPT, makeUserPrompt} from './prompts.js';
import {validateFiles, safePath} from '../shared/filesystem.js';
import {parseArtifact} from '../shared/artifact-parser.js';

export const PROJECT_SCHEMA = {
  type:'object',
  properties:{
    message:{type:'string'},
    files:{type:'array',items:{type:'object',properties:{path:{type:'string'},content:{type:'string'}},required:['path','content']}},
    deletes:{type:'array',items:{type:'string'}}
  },
  required:['message','files','deletes']
};
const core = ['package.json','index.html','src/main.jsx','src/App.jsx','src/styles.css'];
const allowed = p => typeof p === 'string' && safePath(p) && (p === 'index.html' || p.startsWith('src/'));
const fail = (message,code='INVALID_PROJECT') => Object.assign(new Error(message),{code});

export function decodeProject(raw) {
  const text = raw.trim().replace(/^\x60\x60\x60(?:json|xml)?\s*/i,'').replace(/\s*\x60\x60\x60$/,'');
  if (text.startsWith('<artifact')) {
    const parsed = parseArtifact(text);
    return {message:parsed.actions.find(a=>a.type==='message')?.content || parsed.title,
      files:parsed.actions.filter(a=>a.type==='file').map(({path,content})=>({path,content})),
      deletes:parsed.actions.filter(a=>a.type==='delete').map(a=>a.path)};
  }
  return JSON.parse(text);
}

export function applyProject(project, existing) {
  if (!project || typeof project.message !== 'string' || !Array.isArray(project.files) ||
      !Array.isArray(project.deletes) || project.files.length > 16 || project.deletes.length > 16)
    throw fail('AI returned an invalid project structure.');
  const next={...existing}, actions=[], seen=new Set();
  for (const file of project.files) {
    if (!file || !allowed(file.path) || typeof file.content !== 'string' || !file.content.trim() || seen.has(file.path))
      throw fail('AI returned an invalid or duplicate file.');
    seen.add(file.path); next[file.path]=file.content; actions.push({type:'file',path:file.path,content:file.content});
  }
  for (const p of project.deletes) {
    if (!allowed(p) || core.includes(p) || seen.has(p)) throw fail('AI attempted an invalid file deletion.');
    seen.add(p); delete next[p]; actions.push({type:'delete',path:p});
  }
  if (!actions.length || !actions.some(a=>a.type==='file')) throw fail('AI did not generate any files.');
  for (const p of core) if (typeof next[p]!=='string' || !next[p].trim()) throw fail('A required project file is missing.');
  validateFiles(next);
  return {message:project.message.slice(0,500),actions,files:next};
}

// Compile only in memory; do not execute generated code, read arbitrary server files,
// install generated dependencies, or run generated package scripts.
export async function validateBuild(files) {
  const {build}=await import('esbuild');
  let pkg;
  try {pkg=JSON.parse(files['package.json']);}catch{throw fail('Invalid workspace package.json.');}
  const dependencies=new Set(Object.keys({...pkg.dependencies,...pkg.devDependencies}));
  function resolveLocal(p) {
    const normalized=path.normalize(p).replace(/^\//,'');
    for (const candidate of [normalized,...['.jsx','.js','.tsx','.ts','.css','.json','.svg'].map(x=>normalized+x),...['index.jsx','index.js','index.tsx','index.ts'].map(x=>path.join(normalized,x))])
      if (Object.hasOwn(files,candidate)) return candidate;
    return null;
  }
  try {
    await build({
      entryPoints:['src/main.jsx'],bundle:true,write:false,outdir:'virtual-output',
      platform:'browser',format:'esm',logLevel:'silent',jsx:'automatic',
      plugins:[{name:'virtual-workspace',setup(b){
        b.onResolve({filter:/.*/},args=>{
          if (args.kind==='entry-point') return {path:'src/main.jsx',namespace:'workspace'};
          if (/^(https?:|data:|#)/.test(args.path) && ['url-token','import-rule'].includes(args.kind)) return {path:args.path,external:true};
          if (args.path.startsWith('.') || args.path.startsWith('/')) {
            const target=resolveLocal(args.path.startsWith('/')?args.path:path.join(path.dirname(args.importer),args.path));
            return target?{path:target,namespace:'workspace'}:{errors:[{text:'Missing local file: '+args.path}]};
          }
          const parts=args.path.split('/');
          const name=args.path.startsWith('@')?parts.slice(0,2).join('/'):parts[0];
          return dependencies.has(name)?{path:args.path,external:true}:{errors:[{text:'Undeclared dependency: '+name}]};
        });
        b.onLoad({filter:/.*/,namespace:'workspace'},args=>{
          const ext=path.extname(args.path).slice(1);
          const loader=['jsx','js','tsx','ts','css','json','text'].includes(ext)?ext:ext==='svg'?'dataurl':'text';
          return {contents:files[args.path],loader:loader==='js'?'jsx':loader};
        });
      }}]
    });
  } catch {throw fail('Generated files did not compile.');}
}

export async function generateValidatedProject({apiKey,models,prompt,files,signal,onProgress=()=>{},fetchImpl,checkBuild=validateBuild,firstTokenMs=25000,idleMs=30000}) {
  let last;
  for (const [i,model] of [...new Set(models.filter(Boolean))].entries()) {
    if(signal?.aborted) throw signal.reason;
    const controller=new AbortController(), combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
    let timer, raw='', first=true, project;
    const arm=ms=>{clearTimeout(timer);timer=setTimeout(()=>controller.abort(fail('AI stopped responding.','TIMEOUT')),ms);};
    arm(firstTokenMs);
    const started=Date.now();
    try {
      onProgress(i?'Trying a backup model…':'Generating your project…');
      const userPrompt=makeUserPrompt(prompt,files)+(i?'\nReturn a smaller complete JSON implementation. Avoid repetition.':'');
      for await(const piece of streamGeminiText({apiKey,model,systemPrompt:SYSTEM_PROMPT,userPrompt,signal:combined,fetchImpl,maxRetries:0,responseJsonSchema:PROJECT_SCHEMA})) {
        if(first){console.info('Buildora first output',model,Date.now()-started,'ms');first=false;onProgress('Writing project files…');}
        arm(idleMs);raw+=piece;
        if(raw.length>650000) throw fail('Generated project exceeded the size limit.');
        // A complete JSON object is sufficient; no need to wait for trailing tokens.
        if(/[}>]$/.test(raw.trimEnd())) {
          try{project=decodeProject(raw);}catch{continue;}
          if(project) break;
        }
      }
      clearTimeout(timer);
      if (!project) {try{project=decodeProject(raw);}catch{throw fail('Gemini returned incomplete or malformed project data.');}}
      const validated=applyProject(project,files);
      onProgress('Checking generated code…');
      await checkBuild(validated.files);
      if(signal?.aborted)throw signal.reason;
      console.info('Buildora validated project',model,Date.now()-started,'ms',validated.actions.length,'files');
      return validated;
    }catch(err){
      if(signal?.aborted)throw signal.reason;
      last=controller.signal.aborted?controller.signal.reason:err;
      console.warn('Buildora model failed',model,last.code||last.name);
      if([401,403].includes(last.code))break;
    }finally{clearTimeout(timer);controller.abort();}
  }
  if([401,403].includes(last?.code))throw fail('AI credentials are not authorized. Contact the site owner.','AUTH');
  if(last?.code===429)throw fail('AI quota is temporarily exhausted. Your project is unchanged.','QUOTA');
  throw fail('AI could not finish a valid build after trying available models. Your prompt and previous project are saved.',last?.code||'GENERATION_FAILED');
}
