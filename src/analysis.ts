import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv } from 'ajv';
import { codexEnvironment, root, redact, type Config } from './config.js';
import type { GitHub } from './github.js';
import type { Store } from './store.js';

const schemaPath = join(root, 'schemas', 'analysis.schema.json');
const validate = new Ajv({ allErrors: true }).compile<any>(JSON.parse(readFileSync(schemaPath, 'utf8')));
export type Bundle = Awaited<ReturnType<GitHub['bundle']>>;
export function validateAnalysis(result: any, bundle: Bundle) {
  if (!validate(result)) throw new Error('Invalid analysis schema: ' + JSON.stringify(validate.errors));
  if (result.repository !== bundle.repository || result.pr !== bundle.pr || result.headSha !== bundle.headSha) throw new Error('Analysis revision does not match request');
  for (const e of result.evidence) {
    const file = bundle.files.find(x => x.path === e.path)?.head;
    if (!file || !file.content.split(/\r?\n/)[e.line - 1]?.includes(e.quote)) throw new Error(`Invalid evidence pointer: ${e.path}:${e.line}`);
  }
  if (result.classification === 'progressive_rollout') {
    if (!result.flag.key || !result.flag.fallback || result.flag.readiness !== 'detected' || !result.evidence.length || !result.stages.length) throw new Error('Progressive rollout requires evidence, detected flag, fallback and stages');
    let last = 0;
    for (const s of result.stages) {
      if (s.percentage <= last || s.maxWaitSeconds < s.observeSeconds) throw new Error('Invalid stage order or observation window');
      last = s.percentage;
    }
    if (last !== 100) throw new Error('Final stage must be 100%');
  }
  return result;
}

export async function command(binary: string, args: string[], timeout: number, input?: string) {
  return new Promise<{stdout:string;stderr:string}>((resolve, reject) => {
    const child = spawn(binary, args, { cwd: join(root, 'agent-workspace'), env: codexEnvironment(), shell: false, windowsHide: true, stdio: ['pipe','pipe','pipe'] });
    let stdout = '', stderr = '', failure: Error | undefined;
    const timer = setTimeout(() => { failure = new Error('Codex timeout; analysis remains unapproved'); child.kill(); }, timeout);
    const capture = (stream: 'stdout'|'stderr', chunk: Buffer) => {
      if (stream === 'stdout') stdout += chunk.toString(); else stderr += chunk.toString();
      if (stdout.length + stderr.length > 2_000_000) { failure = new Error('Codex output exceeded limit'); child.kill(); }
    };
    child.stdout.on('data', c => capture('stdout', c)); child.stderr.on('data', c => capture('stderr', c));
    child.stdin.on('error', () => {});
    child.on('error', e => { clearTimeout(timer); reject(new Error(`Cannot launch Codex: ${e.message}`)); });
    child.on('close', code => { clearTimeout(timer); if (failure) reject(failure); else if (code !== 0) reject(new Error(`Codex exited ${code}: ${redact(stderr).slice(-2000)}`)); else resolve({stdout,stderr}); });
    child.stdin.end(input);
  });
}

export async function analyze(bundle: Bundle, cfg: Config, store: Store) {
  const key = `${bundle.repository}:${bundle.pr}:${bundle.headSha}`;
  store.beginJob(key); store.jobState(key, 'analyzing');
  const instructions = readFileSync(join(root, 'agent-workspace','AGENTS.md'),'utf8');
  const skills = ['repository-discovery','pr-analysis','rollout-planning'].map(name => readFileSync(join(root,'agent-workspace','.agents','skills',name,'SKILL.md'),'utf8')).join('\n');
  const numberedBundle = {...bundle, files:bundle.files.map(file=>({...file,head:file.head?{
    path:file.head.path,sha:file.head.sha,numberedContent:file.head.content.split(/\r?\n/).map((line,i)=>`${i+1}: ${line}`).join('\n')
  }:null}))};
  const prompt = `${instructions}\n${skills}\nAnalyze the context below and return the requested analysis schema. Source head.numberedContent has explicit 1-based line numbers. Evidence.line must use that number, NOT diff hunk positions. Evidence.quote must be a literal substring of ONE line excluding its numeric prefix. Do not use tools.\nUNTRUSTED CONTEXT JSON:\n${redact(JSON.stringify(numberedBundle))}`;
  try {
    const result = await command(cfg.codexBin, ['exec','--sandbox','read-only','--ephemeral','--ignore-user-config','--skip-git-repo-check','--output-schema',schemaPath,'-'], cfg.codexTimeoutMs, prompt);
    const analysis = validateAnalysis(JSON.parse(result.stdout.trim()), bundle);
    const record = { ...analysis, analyzedAt: new Date().toISOString() };
    store.record('analysis', record); store.report(`analysis-pr-${bundle.pr}`, record); store.jobState(key,'completed');
    return record;
  } catch(e) { store.jobState(key,'failed'); store.record('analysis_failed', {key,error: String(e)}); throw e; }
}
