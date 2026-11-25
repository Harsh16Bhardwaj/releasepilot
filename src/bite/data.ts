import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export type Version = "original" | "redesign";
export const eventNames = [
  "page_view",
  "item_click",
  "category_change",
  "search",
  "add_to_cart",
  "remove_from_cart",
  "checkout_start",
  "order_placed",
  "active_time",
] as const;
export class BiteData {
  db: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL;PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,visitor TEXT NOT NULL,version TEXT NOT NULL,source TEXT NOT NULL,build TEXT NOT NULL,created INTEGER NOT NULL,last_seen INTEGER NOT NULL,completed INTEGER,preview INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,name TEXT NOT NULL,item_id TEXT,created INTEGER NOT NULL,FOREIGN KEY(session_id) REFERENCES sessions(id));
      CREATE INDEX IF NOT EXISTS session_events ON events(session_id,created);
      CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,idempotency_key TEXT UNIQUE NOT NULL,cart TEXT NOT NULL,total INTEGER NOT NULL,created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS requests(id INTEGER PRIMARY KEY,session_id TEXT,status INTEGER,duration_ms REAL,created INTEGER);`);
    // Additive migrations preserve sessions collected before Traffic Lab existed.
    const columns = this.db.prepare("PRAGMA table_info(sessions)").all() as {
      name: string;
    }[];
    for (const name of ["run_id", "release_id", "stage_id"])
      if (!columns.some((c) => c.name === name))
        this.db.exec(`ALTER TABLE sessions ADD COLUMN ${name} TEXT`);
    if (!columns.some((c) => c.name === "simulated"))
      this.db.exec(
        "ALTER TABLE sessions ADD COLUMN simulated INTEGER NOT NULL DEFAULT 0",
      );
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS metric_windows(key TEXT PRIMARY KEY,body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS session_windows ON sessions(run_id,created,completed);`);
  }
  createSession(
    visitor: string,
    version: Version,
    source: string,
    build: string,
    preview = false,
    context: {
      runId?: string;
      simulated?: boolean;
      releaseId?: string;
      stageId?: string;
    } = {},
  ) {
    const id = randomUUID(),
      now = Date.now();
    this.db
      .prepare(
        "INSERT INTO sessions(id,visitor,version,source,build,created,last_seen,completed,preview,run_id,release_id,stage_id,simulated) VALUES(?,?,?,?,?,?,?,NULL,?,?,?,?,?)",
      )
      .run(
        id,
        visitor,
        version,
        source,
        build,
        now,
        now,
        Number(preview),
        context.runId ?? null,
        context.releaseId ?? null,
        context.stageId ?? null,
        Number(!!context.simulated),
      );
    return this.session(id)!;
  }
  session(id: string) {
    return this.db.prepare("SELECT * FROM sessions WHERE id=?").get(id) as
      | {
          id: string;
          visitor: string;
          version: Version;
          source: string;
          build: string;
          preview: number;
          completed: number | null;
          run_id: string | null;
          simulated: number;
        }
      | undefined;
  }
  event(
    id: string,
    session: string,
    name: string,
    itemId: string | null = null,
  ) {
    if (!eventNames.includes(name as any)) throw new Error("Unknown event");
    const row = this.session(session);
    if (!row) throw new Error("Session not found");
    if (row.completed !== null)
      throw new Error("Session already finalized; create a new session");
    const prior = this.db
      .prepare("SELECT session_id FROM events WHERE id=?")
      .get(id) as { session_id: string } | undefined;
    if (prior && prior.session_id !== session)
      throw new Error("Event ID belongs to another session");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const inserted = this.db
        .prepare("INSERT OR IGNORE INTO events VALUES(?,?,?,?,?)")
        .run(id, session, name, itemId, Date.now()).changes;
      if (inserted)
        this.db
          .prepare("UPDATE sessions SET last_seen=? WHERE id=?")
          .run(Date.now(), session);
      this.db.exec("COMMIT");
      return inserted === 1;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  finalize(now = Date.now()) {
    return this.db
      .prepare(
        "UPDATE sessions SET completed=last_seen WHERE completed IS NULL AND last_seen<=?",
      )
      .run(now - 30_000).changes;
  }
  endSession(id: string) {
    const s = this.session(id);
    if (!s) throw new Error("Session not found");
    this.db
      .prepare(
        "UPDATE sessions SET completed=last_seen WHERE id=? AND completed IS NULL",
      )
      .run(id);
  }
  order(
    session: string,
    key: string,
    cart: Record<string, number>,
    total: number,
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const prior = this.db
        .prepare("SELECT * FROM orders WHERE idempotency_key=?")
        .get(key) as any;
      if (prior) {
        if (prior.session_id !== session || prior.cart !== JSON.stringify(cart))
          throw new Error("Order key already used");
        this.db.exec("COMMIT");
        return { id: prior.id, total: prior.total };
      }
      const id = "BITE-" + randomUUID().slice(0, 8).toUpperCase();
      this.db
        .prepare("INSERT INTO orders VALUES(?,?,?,?,?,?)")
        .run(id, session, key, JSON.stringify(cart), total, Date.now());
      this.db
        .prepare("INSERT INTO events VALUES(?,?,?,?,?)")
        .run(randomUUID(), session, "order_placed", null, Date.now());
      this.db
        .prepare("UPDATE sessions SET last_seen=? WHERE id=?")
        .run(Date.now(), session);
      this.db.exec("COMMIT");
      return { id, total };
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  summary() {
    return {
      sessions: this.db
        .prepare(
          "SELECT version,preview,COUNT(*) AS visits,SUM(completed IS NOT NULL) AS completed FROM sessions GROUP BY version,preview",
        )
        .all(),
      events: this.db
        .prepare("SELECT name,COUNT(*) AS count FROM events GROUP BY name")
        .all(),
      recent: this.db
        .prepare(
          "SELECT e.name,e.item_id,e.created,s.version,s.preview FROM events e JOIN sessions s ON s.id=e.session_id ORDER BY e.rowid DESC LIMIT 12",
        )
        .all(),
      note: "Preview sessions are separately labelled and must not be used to evaluate a release.",
    };
  }
}
