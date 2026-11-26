import test from 'node:test';
import assert from 'node:assert/strict';
import {applyProject,generateValidatedProject,validateBuild} from '../server/project-generation.js';
import {seedProject} from '../shared/seed-project.js';
const good={message:'Plant shop built',files:[{path:'src/App.jsx',content:"import React from 'react'; export default function App(){return <main>Plant shop</main>;}"}],deletes:[]};
const fixture=(text,reason='STOP')=>'data: '+JSON.stringify({candidates:[{content:{parts:[{text}]},finishReason:reason}]})+'\n\n';
test('structured output produces real compiled files',async()=>{
  const project=applyProject(good,seedProject);
  await validateBuild(project.files);
  assert.match(project.files['src/App.jsx'],/Plant shop/);
});
test('incomplete response retries a different model and validates the whole project',async()=>{
  const calls=[];
  const project=await generateValidatedProject({apiKey:'test',models:['primary','backup'],prompt:'plant shop',files:seedProject,
    fetchImpl:async(url,init)=>{calls.push(url);const config=JSON.parse(init.body).generationConfig;assert.equal(config.responseMimeType,'application/json');assert.ok(config.responseJsonSchema);
      return new Response(url.includes('/primary:')?fixture('{"message":'):fixture(JSON.stringify(good)));}});
  assert.equal(calls.length,2);assert.equal(project.message,'Plant shop built');
});
test('malformed JSX is not accepted or written to the workspace',async()=>{
  const bad={...good,files:[{path:'src/App.jsx',content:'export default function App(){return <main>'}]};
  await assert.rejects(()=>validateBuild(applyProject(bad,seedProject).files),/did not compile/);
  assert.throws(()=>applyProject({...good,files:[{path:'package.json',content:'{}'}]},seedProject),/invalid/);
});
test('overloaded model falls back without using a second API key',async()=>{
  const calls=[];
  const result=await generateValidatedProject({apiKey:'test',models:['primary','backup'],prompt:'plant shop',files:seedProject,
    fetchImpl:async(url,init)=>{calls.push(init.headers['x-goog-api-key']);return url.includes('/primary:')?new Response(JSON.stringify({error:{message:'overloaded'}}),{status:503}):new Response(fixture(JSON.stringify(good)));}});
  assert.deepEqual(calls,['test','test']);assert.equal(result.actions.length,1);
});
test('both unavailable models fail clearly instead of inventing a generated app',async()=>{
  await assert.rejects(()=>generateValidatedProject({apiKey:'test',models:['primary','backup'],prompt:'plant shop',files:seedProject,
    fetchImpl:async()=>new Response(JSON.stringify({error:{message:'busy'}}),{status:503})}),/could not finish a valid build/);
});
