import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Flagsmith } from "@flagsmith/nodejs";
import { config, root } from "../src/config.js";
import {
  FlagsmithManagement,
  cleanRules,
  withPercentage,
  scope,
} from "../src/flagsmith.js";
import { runTraffic, validateOptions } from "../src/traffic/simulator.js";

const base = "http://127.0.0.1:3100",
  cfg = config();
if (!cfg.flagsmith.disposable || !cfg.flagsmith.rolloutSegmentId)
  throw new Error("Configure the dedicated disposable demo environment first");
const target = {
  ...cfg,
  flagsmith: {
    ...cfg.flagsmith,
    flag: "menu_redesign",
    segmentId: cfg.flagsmith.rolloutSegmentId,
  },
};
const api = new FlagsmithManagement(target);
const sdk = new Flagsmith({
  environmentKey: cfg.flagsmith.sdkKey,
  apiUrl: cfg.flagsmith.sdkUrl,
  enableLocalEvaluation: true,
  retries: 0,
  enableAnalytics: false,
  environmentRefreshIntervalSeconds: 3600,
});
const dir = join(root, ".runtime", "flagsmith");
mkdirSync(dir, { recursive: true });
const journalPath = join(dir, "app-probe-recovery.json");
const restoreOnly = process.argv.includes("--restore");
let journal: any = existsSync(journalPath)
  ? JSON.parse(readFileSync(journalPath, "utf8"))
  : null;
const save = () => writeFileSync(journalPath, JSON.stringify(journal, null, 2));
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const headers = {
  "Content-Type": "application/json",
  "X-Bite-Simulation": "true",
};
async function request(path: string, cookie = "", body?: unknown) {
  const r = await fetch(base + path, {
    ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
    headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) },
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`Bite ${path} HTTP ${r.status}`);
  return {
    body: await r.json(),
    cookie: r.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  };
}
async function observed(percentage: number) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await sdk.updateEnvironment();
    const env = await sdk.getEnvironment();
    const sdkPercent = Number(
      env.project.segments.find(
        (s) => s.id === Number(target.flagsmith.segmentId),
      )?.rules[0]?.conditions[0]?.value,
    );
    const app = (await request("/api/flags")).body;
    if (
      sdkPercent === percentage &&
      app.percentage === percentage &&
      !app.sdkRefreshFailed
    )
      return;
    if (attempt < 2) await delay(15_000);
  }
  throw new Error(
    `Application did not confirm ${percentage}% within the bounded observation period`,
  );
}
async function restore() {
  if (!journal || journal.scope !== scope(target))
    throw new Error(
      "Saved application probe scope does not match current configuration",
    );
  const actual = cleanRules((await api.read()).rules);
  if (!same(actual, journal.rules) && !same(actual, journal.lastIntentRules))
    throw new Error(
      "Unexpected flag drift; manual inspection required before restoration",
    );
  await api.apply(journal.rules);
  await observed(0);
  journal.restored = true;
  journal.restoredAt = new Date().toISOString();
  save();
}
let heartbeat: ReturnType<typeof setInterval> | undefined;
try {
  if (restoreOnly) {
    if (!journal || journal.restored)
      throw new Error("No unresolved application probe");
    await restore();
    console.log(JSON.stringify({ restored: true }));
  } else {
    if (journal && !journal.restored)
      throw new Error("Unresolved application probe; run with --restore first");
    const original = cleanRules((await api.read()).rules);
    if (Number(original[0]?.conditions[0]?.value) !== 0)
      throw new Error(
        "Application integration proof requires the dedicated flag to start at 0%",
      );
    await observed(0);
    journal = {
      scope: scope(target),
      rules: original,
      lastIntentRules: original,
      restored: false,
      startedAt: new Date().toISOString(),
    };
    save();
    let result: any;
    try {
      journal.lastIntentRules = withPercentage(original, 50);
      save();
      await api.apply(journal.lastIntentRules);
      await observed(50);
      let retained: { body: any; cookie: string } | undefined;
      for (let i = 0; i < 20; i++) {
        const candidate = await request(
          "/api/session",
          `bite_visitor=${randomUUID()}`,
        );
        if (candidate.body.version === "redesign") {
          retained = candidate;
          break;
        }
      }
      assert.ok(retained, "No treatment session found");
      heartbeat = setInterval(() => {
        void request("/api/events", retained!.cookie, {
          id: randomUUID(),
          name: "active_time",
        }).catch(() => {});
      }, 3000);
      const runId = randomUUID(),
        from = Date.now() - 1;
      const traffic = await runTraffic(
        validateOptions({
          baseUrl: base,
          scenario: "healthy",
          mode: "flagsmith",
          seed: "flagsmith-live-proof",
          sessions: 200,
          rate: 50,
        }),
        runId,
        new AbortController().signal,
        () => {},
      );
      assert.equal(traffic.failed, 0);
      assert.ok(
        traffic.original > 0 &&
          traffic.redesign >= 60 &&
          traffic.redesign <= 140,
      );
      const params = new URLSearchParams({
        from: String(from),
        to: String(Date.now()),
        runId,
      });
      const m = (await request("/api/metrics?" + params)).body;
      assert.equal(m.quality.flagsmithOnly, true);
      assert.equal(m.quality.previewIncluded, false);
      result = {
        traffic,
        cohorts: m.cohorts,
        runId,
        source: "Actual Flagsmith identity assignment; simulated HTTP visitors",
        rolloutOrchestrationProof: false,
      };
      await restore();
      const recovered = await request("/api/session", retained.cookie);
      assert.equal(recovered.body.version, "original");
      assert.notEqual(recovered.body.id, retained.body.id);
      assert.equal(recovered.body.previousSessionEndReason, "flag_disabled");
      result.activeSessionRecovery = true;
      result.restored = true;
      result.at = new Date().toISOString();
      writeFileSync(
        join(dir, "app-proof.json"),
        JSON.stringify(result, null, 2),
      );
      console.log(JSON.stringify(result, null, 2));
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      if (journal && !journal.restored) await restore();
    }
  }
} finally {
  await sdk.close();
}
