import 'dotenv/config';
import { resolve } from 'node:path';

export const root = resolve(import.meta.dirname, '..');
export function repository(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value) || value.split('/').some(x => x === '.' || x === '..')) {
    throw new Error('Repository must be owner/repository (not a URL or filesystem path).');
  }
  return value;
}
export function config(env: NodeJS.ProcessEnv = process.env) {
  const integer = (name: string, fallback: number) => {
    const n = Number(env[name] || fallback);
    if (!Number.isSafeInteger(n) || n < 1) throw new Error(`Invalid ${name}`);
    return n;
  };
  const managementUrl = new URL(env.FLAGSMITH_MANAGEMENT_URL || 'https://api.flagsmith.com/api/v1/');
  if (managementUrl.protocol !== 'https:' && !(managementUrl.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(managementUrl.hostname))) {
    throw new Error('Flagsmith URL requires HTTPS or local HTTP.');
  }
  if (managementUrl.username || managementUrl.password || managementUrl.search || managementUrl.hash) throw new Error('Credentials/query parameters are forbidden in Flagsmith URL.');
  return {
    githubToken: env.GITHUB_TOKEN || '', codexBin: env.CODEX_BIN || 'codex',
    codexTimeoutMs: integer('CODEX_TIMEOUT_SECONDS', 180) * 1000,
    flagsmith: { url: managementUrl.href.replace(/\/?$/, '/'), apiKey: env.FLAGSMITH_API_KEY || '',
      environmentKey: env.FLAGSMITH_ENVIRONMENT_KEY || '', sdkKey: env.FLAGSMITH_SDK_KEY || '',
      projectId: env.FLAGSMITH_PROJECT_ID || '', segmentId: env.FLAGSMITH_PROBE_SEGMENT_ID || '',
      flag: env.FLAGSMITH_PROBE_FLAG || 'releasepilot_probe', disposable: env.FLAGSMITH_PROBE_DISPOSABLE === 'true' },
    deploymentUrl: env.BITE_DEPLOYMENT_URL || '', metricsUrl: env.METRICS_URL || '',
  };
}
export type Config = ReturnType<typeof config>;

export function redact(value: string, env: NodeJS.ProcessEnv = process.env): string {
  let text = value;
  for (const [key, secret] of Object.entries(env)) {
    if (/(TOKEN|SECRET|PASSWORD|API_KEY|SDK_KEY|ENVIRONMENT_KEY)/i.test(key) && secret && secret.length >= 4) text = text.split(secret).join('[REDACTED]');
  }
  return text.replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{16,})\b/g, '[REDACTED]')
    .replace(/((?:api[_-]?key|token|password|secret)[ \t]*[:=][ \t]*)[^\s,;]+/gi, '$1[REDACTED]');
}

export function codexEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const allowed = new Set(['PATH','PATHEXT','SYSTEMROOT','WINDIR','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','HOME','CODEX_HOME','COMSPEC']);
  return Object.fromEntries(Object.entries(env).filter(([k,v]) => allowed.has(k.toUpperCase()) && v !== undefined));
}
