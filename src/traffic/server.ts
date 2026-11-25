import "dotenv/config";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { root } from "../config.js";
import {
  runTraffic,
  validateOptions,
  type TrafficProgress,
} from "./simulator.js";

const port = Number(process.env.TRAFFIC_PORT || 3200);
const path =
  process.env.TRAFFIC_DATABASE ||
  join(root, ".runtime", "traffic", "lab.sqlite");
mkdirSync(dirname(path), { recursive: true });
const db = new DatabaseSync(path);
db.exec(
  `PRAGMA journal_mode=WAL;PRAGMA busy_timeout=5000;CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,body TEXT NOT NULL);`,
);
let active: {
  run: any;
  abort: AbortController;
  done: Promise<unknown>;
} | null = null;
const save = (run: any) =>
  db
    .prepare(
      "INSERT INTO runs VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
    )
    .run(run.id, JSON.stringify(run));
const history = () =>
  db
    .prepare("SELECT body FROM runs ORDER BY rowid DESC LIMIT 20")
    .all()
    .map((r: any) => JSON.parse(r.body));
const server = createServer(async (req, res) => {
  const reply = (status: number, value: unknown) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(value));
  };
  try {
    if (
      req.headers.origin &&
      ![`http://localhost:${port}`, `http://127.0.0.1:${port}`].includes(
        req.headers.origin,
      )
    ) {
      reply(403, { error: "Foreign origin rejected" });
      return;
    }
    if (req.method === "GET" && req.url === "/status") {
      reply(200, {
        service: "traffic-lab",
        active: active?.run ?? null,
        runs: history(),
      });
      return;
    }
    if (req.method === "GET" && req.url === "/runs") {
      reply(200, history());
      return;
    }
    if (req.method === "POST" && req.url === "/stop") {
      active?.abort.abort();
      reply(200, { stopping: !!active });
      return;
    }
    if (req.method === "POST" && req.url === "/start") {
      if (active) {
        reply(409, {
          error: "A traffic run is already active. Stop it first.",
        });
        return;
      }
      if (!req.headers["content-type"]?.startsWith("application/json")) {
        reply(415, { error: "JSON required" });
        return;
      }
      let body = "";
      for await (const c of req) {
        body += c;
        if (body.length > 8192) throw new Error("Request too large");
      }
      const options = validateOptions(JSON.parse(body || "{}"));
      // Recheck after awaiting request input: two concurrent starts must not both acquire the worker.
      if (active) {
        reply(409, { error: "A traffic run is already active." });
        return;
      }
      const run = {
        id: randomUUID(),
        options,
        status: "running",
        startedAt: Date.now(),
        finishedAt: null as number | null,
        progress: {
          attempted: 0,
          completed: 0,
          failed: 0,
          original: 0,
          redesign: 0,
        },
      };
      const abort = new AbortController();
      save(run);
      active = { run, abort, done: Promise.resolve() };
      active.done = runTraffic(
        options,
        run.id,
        abort.signal,
        (p: TrafficProgress) => {
          run.progress = p;
          save(run);
        },
      )
        .then((p) => {
          run.progress = p;
          run.status = abort.signal.aborted
            ? "stopped"
            : p.failed
              ? "completed_with_errors"
              : "completed";
        })
        .catch(() => {
          run.status = "failed";
        })
        .finally(() => {
          run.finishedAt = Date.now();
          save(run);
          active = null;
        });
      reply(202, run);
      return;
    }
    reply(404, { error: "Unknown Traffic Lab route" });
  } catch (e) {
    reply(400, {
      error: e instanceof Error ? e.message : "Traffic request failed",
    });
  }
});
server.on("error", (e) => {
  console.error(`Traffic Lab could not bind: ${e.message}`);
  db.close();
  process.exit(1);
});
server.listen(port, "127.0.0.1", () => {
  for (const row of db.prepare("SELECT id,body FROM runs").all() as {
    id: string;
    body: string;
  }[]) {
    const run = JSON.parse(row.body);
    if (run.status === "running") {
      run.status = "interrupted";
      run.finishedAt = Date.now();
      db.prepare("UPDATE runs SET body=? WHERE id=?").run(
        JSON.stringify(run),
        row.id,
      );
    }
  }
  console.log(
    `Traffic Lab ready at http://127.0.0.1:${port} — dashboard: http://127.0.0.1:${process.env.BITE_PORT || 3100}/lab`,
  );
});
async function stop() {
  const current = active;
  current?.abort.abort();
  await current?.done;
  server.close();
  db.close();
  process.exit();
}
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
