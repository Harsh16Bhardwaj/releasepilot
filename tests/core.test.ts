import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { command } from '../src/analysis.js';
import { config, repository, codexEnvironment, redact } from '../src/config.js';
import { Store } from '../src/store.js';
import { withPercentage } from '../src/flagsmith.js';
import { validateAnalysis, type Bundle } from '../src/analysis.js';

test('repository validation prevents traversal and runtime directory collisions',()=>{
  assert.equal(repository('Owner/Repo-name'), 'Owner/Repo-name');
  for(const value of ['../../x','a/../b','https://github.com/a/b','a/..','a/b/c','a\\b'])assert.throws(()=>repository(value));
});
test('Codex inherits OS/auth location but no integration or billing credentials',()=>{
  const env=codexEnvironment({PATH:'bin',USERPROFILE:'profile',CODEX_HOME:'codex',GITHUB_TOKEN:'secret1',FLAGSMITH_API_KEY:'secret2',OPENAI_API_KEY:'paid',CODEX_API_KEY:'paid2',NODE_OPTIONS:'--require evil.js'});
  assert.deepEqual(env,{PATH:'bin',USERPROFILE:'profile',CODEX_HOME:'codex'});
  assert.equal(redact('configured-secret', {FLAGSMITH_API_KEY:'configured-secret'}),'[REDACTED]');
  assert.equal(redact('ghp_1234567890'), '[REDACTED]');
});
test('configuration rejects remote plaintext credential transport',()=>{
  assert.equal(config({FLAGSMITH_AUTH_SCHEME:'Token'}).flagsmith.authScheme,'Token');
  assert.equal(config({}).flagsmith.authScheme,'Api-Key');
  assert.throws(()=>config({FLAGSMITH_AUTH_SCHEME:'Bearer'}));
  assert.throws(()=>config({FLAGSMITH_MANAGEMENT_URL:'http://example.com/api/v1/'}));
  assert.throws(()=>config({FLAGSMITH_MANAGEMENT_URL:'https://user:pass@example.com/'}));
  assert.doesNotThrow(()=>config({FLAGSMITH_MANAGEMENT_URL:'http://localhost:8000/api/v1/'}));
});
test('actual spawned process does not inherit service credentials or Node preload options',async()=>{
  const prior=process.env.FLAGSMITH_API_KEY;
  process.env.FLAGSMITH_API_KEY='test-only-not-a-live-key';
  try {
    const result=await command(process.execPath,['-e',"console.log(JSON.stringify({key:process.env.FLAGSMITH_API_KEY??null,preload:process.env.NODE_OPTIONS??null}))"],5000);
    assert.deepEqual(JSON.parse(result.stdout),{key:null,preload:null});
  } finally {if(prior===undefined)delete process.env.FLAGSMITH_API_KEY;else process.env.FLAGSMITH_API_KEY=prior;}
});
test('SQLite deduplicates jobs and excludes another live worker',()=>{
  const dir=mkdtempSync(join(tmpdir(),'releasepilot-test-'));
  const a=new Store('owner/repo',dir), b=new Store('owner/repo',dir);
  try {
    a.acquire();assert.throws(()=>b.acquire(),/already running/);
    assert.equal(a.beginJob('pr:head'),true);assert.equal(b.beginJob('pr:head'),false);
    a.record('analysis',{headSha:'one'});a.record('analysis',{headSha:'two'});
    assert.equal(b.latest('analysis').headSha,'two');
    a.release();b.acquire();b.release();
  }finally{a.close();b.close();rmSync(dir,{recursive:true,force:true});}
});
test('targeting edits preserve original snapshot and reject unsupported rules',()=>{
  const original=[{type:'ALL',conditions:[{operator:'PERCENTAGE_SPLIT',property:null,value:'0'}]}];
  const changed=withPercentage(original,25);
  assert.equal(changed[0].conditions[0].value,'25');assert.equal(original[0].conditions[0].value,'0');
  assert.throws(()=>withPercentage(original,101));
  assert.throws(()=>withPercentage([{type:'ALL',conditions:[]}],5));
});
const bundle={repository:'owner/repo',pr:1,headSha:'abc',files:[{path:'src/page.ts',head:{content:'const flag = "menu_redesign";'}}]} as unknown as Bundle;
const analysis=()=>({repository:'owner/repo',pr:1,headSha:'abc',classification:'needs_flag',summary:'Missing fallback',risk:'medium',
  evidence:[{path:'src/page.ts',line:1,quote:'menu_redesign',claim:'flag mention'}],affectedRoutes:[],affectedUsers:'Unknown',flag:{key:'menu_redesign',fallback:null,readiness:'unknown'},releaseNotes:'Page update',stages:[],unknowns:['Fallback'],prerequisites:['Add gating']});
test('analysis rejects invented evidence, stale revisions and unsafe progression',()=>{
  assert.doesNotThrow(()=>validateAnalysis(analysis(),bundle));
  const wrong=analysis();wrong.headSha='stale';assert.throws(()=>validateAnalysis(wrong,bundle),/revision/);
  const invented=analysis();invented.evidence[0].line=99;assert.throws(()=>validateAnalysis(invented,bundle),/evidence/);
  const unsafe=analysis();unsafe.classification='progressive_rollout';assert.throws(()=>validateAnalysis(unsafe,bundle),/requires/);
});
