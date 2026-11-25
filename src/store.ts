import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { repository, root, redact } from './config.js';

export class Store {
  readonly dir: string;
  readonly db: DatabaseSync;
  constructor(repo: string, runtimeRoot = join(root, '.runtime')) {
    const [owner, name] = repository(repo).toLowerCase().split('/');
    this.dir = join(runtimeRoot, owner, name);
    mkdirSync(this.dir, { recursive: true });
    this.db = new DatabaseSync(join(this.dir, 'pilot.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY, kind TEXT NOT NULL, at TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(job_key TEXT PRIMARY KEY, state TEXT NOT NULL, updated TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS locks(name TEXT PRIMARY KEY, pid INTEGER NOT NULL);`);
  }
  record(kind: string, body: unknown) {
    const id = randomUUID();
    this.db.prepare('INSERT INTO records VALUES(?,?,?,?)').run(id, kind, new Date().toISOString(), redact(JSON.stringify(body)));
    return id;
  }
  latest(kind: string): any {
    const row = this.db.prepare('SELECT body FROM records WHERE kind=? ORDER BY rowid DESC LIMIT 1').get(kind) as {body: string} | undefined;
    return row ? JSON.parse(row.body) : null;
  }
  report(name: string, value: unknown) {
    if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Invalid report name');
    const file = join(this.dir, `${name}.json`);
    writeFileSync(file, redact(JSON.stringify(value, null, 2)) + '\n');
    return file;
  }
  acquire() {
    const row = this.db.prepare('SELECT pid FROM locks WHERE name=?').get('worker') as {pid:number} | undefined;
    if (row) {
      try { process.kill(row.pid, 0); throw new Error('A ReleasePilot worker is already running for this repository.'); }
      catch (e: any) { if (e.code !== 'ESRCH') throw e; }
      this.db.prepare('DELETE FROM locks WHERE name=? AND pid=?').run('worker', row.pid);
    }
    try { this.db.prepare('INSERT INTO locks VALUES(?,?)').run('worker', process.pid); }
    catch { throw new Error('Another ReleasePilot worker acquired this repository.'); }
  }
  release() { this.db.prepare('DELETE FROM locks WHERE name=? AND pid=?').run('worker', process.pid); }
  beginJob(key: string) {
    return this.db.prepare("INSERT OR IGNORE INTO jobs VALUES(?,'pending',?)").run(key, new Date().toISOString()).changes === 1;
  }
  jobState(key: string, state: string) { this.db.prepare('UPDATE jobs SET state=?,updated=? WHERE job_key=?').run(state, new Date().toISOString(), key); }
  close() { this.db.close(); }
}
