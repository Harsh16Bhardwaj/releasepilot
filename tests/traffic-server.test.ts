import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { root } from "../src/config.js";

test(
  "Traffic Lab serializes start, stops cleanly and marks a killed run interrupted on restart",
  { timeout: 20_000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "traffic-service-"));
    const base = "http://127.0.0.1:3199";
    let child: ChildProcess | undefined;
    const start = async () => {
      const p = spawn(
        process.execPath,
        ["--import", "tsx", "src/traffic/server.ts"],
        {
          cwd: root,
          windowsHide: true,
          env: {
            ...process.env,
            TRAFFIC_PORT: "3199",
            TRAFFIC_DATABASE: join(dir, "lab.sqlite"),
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      await new Promise<void>((resolve, reject) => {
        let text = "";
        const timeout = setTimeout(
          () => reject(new Error(text || "Traffic startup timeout")),
          5000,
        );
        p.stdout!.on("data", (c) => {
          text += c;
          if (text.includes("Traffic Lab ready")) {
            clearTimeout(timeout);
            resolve();
          }
        });
        p.stderr!.on("data", (c) => (text += c));
        p.on("exit", (code) => {
          clearTimeout(timeout);
          reject(new Error(`Traffic startup exited ${code}: ${text}`));
        });
      });
      return p;
    };
    const post = (path: string, body: unknown = {}) =>
      fetch(base + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const options = {
      baseUrl: "http://127.0.0.1:3197",
      sessions: 20,
      rate: 1,
      mode: "comparison",
      seed: "lifecycle",
      scenario: "neutral",
    };
    try {
      child = await start();
      const responses = await Promise.all([
        post("/start", options),
        post("/start", options),
      ]);
      assert.deepEqual(responses.map((r) => r.status).sort(), [202, 409]);
      const run = await responses.find((r) => r.status === 202)!.json();
      await post("/stop");
      let status: any;
      for (let i = 0; i < 100; i++) {
        status = await (await fetch(base + "/status")).json();
        if (!status.active) break;
        await delay(20);
      }
      assert.equal(status.active, null);
      assert.equal(
        status.runs.find((r: any) => r.id === run.id).status,
        "stopped",
      );
      const crashed = await (await post("/start", options)).json();
      child.kill("SIGKILL");
      await once(child, "exit");
      child = undefined;
      child = await start();
      const recovered = await (await fetch(base + "/status")).json();
      assert.equal(recovered.active, null);
      assert.equal(
        recovered.runs.find((r: any) => r.id === crashed.id).status,
        "interrupted",
      );
    } finally {
      if (child && child.exitCode === null) {
        child.kill();
        await once(child, "exit");
      }
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
