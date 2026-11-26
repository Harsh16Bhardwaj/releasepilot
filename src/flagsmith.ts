import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Flagsmith } from '@flagsmith/nodejs';
import type { Config } from './config.js';
import type { Store } from './store.js';

type Rule = { type: string; conditions: {operator:string;property:string|null;value:string;description?:string|null}[]; rules?: Rule[] };
export function cleanRules(rules: Rule[]): Rule[] {
  return rules.map(r => ({type:r.type,conditions:r.conditions.map(c=>({operator:c.operator,property:c.property,value:String(c.value),description:c.description ?? null})),rules:cleanRules(r.rules || [])}));
}
export function withPercentage(rules: Rule[], percentage: number): Rule[] {
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) throw new Error('Invalid percentage');
  const copy = cleanRules(rules);
  const conditions = copy.flatMap(r=>[...r.conditions,...(r.rules||[]).flatMap(x=>x.conditions)]);
  if (conditions.length !== 1 || conditions[0].operator !== 'PERCENTAGE_SPLIT') throw new Error('Probe supports exactly one PERCENTAGE_SPLIT condition');
  conditions[0].value = String(percentage);
  return copy;
}
const same = (a: unknown,b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function scope(cfg: Config) {
  return createHash('sha256').update(JSON.stringify({url:cfg.flagsmith.url,project:cfg.flagsmith.projectId,environment:cfg.flagsmith.environmentKey,segment:cfg.flagsmith.segmentId,flag:cfg.flagsmith.flag,sdk:cfg.flagsmith.sdkKey})).digest('hex');
}
export function requireFlagsmith(cfg: Config) {
  for (const key of ['apiKey','environmentKey','sdkKey','projectId','segmentId'] as const) if (!cfg.flagsmith[key]) throw new Error(`Flagsmith configuration missing: ${key}. See .env.example.`);
  for (const key of ['projectId','segmentId'] as const) if (!/^\d+$/.test(cfg.flagsmith[key])) throw new Error(`Invalid Flagsmith ${key}`);
}
export class FlagsmithManagement {
  constructor(private cfg: Config) {}
  async request(path: string, method = 'GET', body?: unknown) {
    const r = await fetch(new URL(path,this.cfg.flagsmith.url), {method, redirect:'error', signal:AbortSignal.timeout(15_000),
      headers:{Authorization:`${this.cfg.flagsmith.authScheme} ${this.cfg.flagsmith.apiKey}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    if(!r.ok) throw new Error(`Flagsmith HTTP ${r.status}; check API access, IDs and dedicated environment configuration.`);
    return r.json() as Promise<any>;
  }
  path() { return `projects/${this.cfg.flagsmith.projectId}/segments/${this.cfg.flagsmith.segmentId}/`; }
  async read() { return this.request(this.path()); }
  async apply(rules: Rule[]) { await this.request(this.path(),'PATCH',{rules}); const actual = await this.read(); if(!same(cleanRules(actual.rules),rules)) throw new Error('Flagsmith rule read-back mismatch'); }
}
export async function probe(cfg: Config, store: Store, restoreOnly=false) {
  requireFlagsmith(cfg);
  if(!cfg.flagsmith.disposable) throw new Error('Write probe requires FLAGSMITH_PROBE_DISPOSABLE=true for a dedicated test environment.');
  const api = new FlagsmithManagement(cfg);
  const sdk = new Flagsmith({environmentKey:cfg.flagsmith.sdkKey,apiUrl:cfg.flagsmith.url, enableLocalEvaluation:true, enableAnalytics:false, enableEvents:false,retries:0,requestTimeoutSeconds:10, environmentRefreshIntervalSeconds:3600});
  const ids = Array.from({length:1000},(_,i)=>`releasepilot-probe-${i}`);
  const observe = async () => {
    await sdk.updateEnvironment();
    const env = await sdk.getEnvironment();
    if(String(env.project.id) !== cfg.flagsmith.projectId) throw new Error('SDK project does not match configured project');
    const enabled:string[]=[];
    for(const id of ids) {
      const flags=await sdk.getIdentityFlags(id);
      if(!flags.flags[cfg.flagsmith.flag]) throw new Error('Probe flag missing from SDK environment');
      if(flags.isFeatureEnabled(cfg.flagsmith.flag)) enabled.push(id);
    }
    return enabled;
  };
  let snapshot:any = store.latest('probe_snapshot');
  const restored = store.latest('probe_restored');
  const outstanding = snapshot && restored?.snapshotId !== snapshot.id;
  if(outstanding && !restoreOnly) { await sdk.close(); throw new Error('Unresolved probe snapshot exists. Run flagsmith:probe --restore first.'); }
  try {
    if(!restoreOnly) {
      const env = await api.request(`environments/${encodeURIComponent(cfg.flagsmith.environmentKey)}/`);
      if(String(typeof env.project === 'object' ? env.project.id : env.project) !== cfg.flagsmith.projectId) throw new Error('Management environment does not match project');
      if(String((await sdk.getEnvironment()).id) !== String(env.id)) throw new Error('Management and SDK keys refer to different environments');
      const current = await api.read();
      const flags = await sdk.getEnvironmentFlags();
      const flag = flags.flags[cfg.flagsmith.flag];
      if(!flag || flag.enabled || String(current.feature) !== String(flag.featureId)) throw new Error('Probe requires a feature-specific segment for this flag and a disabled environment default.');
      withPercentage(current.rules,5);
      snapshot = {id:crypto.randomUUID(),scope:scope(cfg),rules:cleanRules(current.rules),before:await observe(), createdAt:new Date().toISOString()};
      store.record('probe_snapshot',snapshot); store.report('probe-recovery',snapshot);
      let previous = new Set<string>();
      const stages=[];
      try {
        for(const percentage of [5,25,50,100]) {
          const rules=withPercentage(snapshot.rules,percentage);
          store.record('probe_intent',{snapshotId:snapshot.id,rules,percentage});
          await api.apply(rules);
          let cohort:string[]=[];
          for(let attempt=0;attempt<3;attempt++) {
            cohort=await observe();
            if(percentage===100 ? cohort.length===1000 : cohort.length >= Math.max(1,percentage*10-50) && cohort.length <= Math.min(1000,percentage*10+50)) break;
            if(attempt===2) throw new Error('SDK exposure outside expected tolerance; propagation or overrides need review');
            await delay(2000);
          }
          if([...previous].some(id=>!cohort.includes(id))) throw new Error('Earlier cohort lost during expansion');
          previous=new Set(cohort); stages.push({percentage,enabled:cohort.length,total:ids.length});
        }
        store.record('probe_expansion',{snapshotId:snapshot.id,stages});
      } finally { await restore(); }
      const proof={scope:scope(cfg),snapshotId:snapshot.id,at:new Date().toISOString(),stages,restored:true};
      store.record('flagsmith_proof',proof);store.report('flagsmith-proof',proof);return proof;
    }
    if(!outstanding) throw new Error('No unresolved probe snapshot to restore');
    await restore(); return {restored:true};
  } finally { await sdk.close(); }

  async function restore() {
    if(snapshot.scope !== scope(cfg)) throw new Error('Recovery scope differs; restore original configuration in .env first');
    const actual=cleanRules((await api.read()).rules);
    const intent=store.latest('probe_intent');
    if(!same(actual,snapshot.rules) && !(intent?.snapshotId===snapshot.id && same(actual,intent.rules))) throw new Error('Manual drift detected; inspect probe-recovery.json before manual restoration');
    store.record('probe_restore_intent',{snapshotId:snapshot.id});
    await api.apply(snapshot.rules);
    for(let i=0;i<3;i++) {
      if(same(await observe(),snapshot.before)) {store.record('probe_restored',{snapshotId:snapshot.id,at:new Date().toISOString()});return;}
      if(i<2) await delay(2000);
    }
    throw new Error('Restored rules but SDK recovery is unconfirmed; retain incident and snapshot');
  }
}
