import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { root } from "../src/config.js";

const base = "http://127.0.0.1:3100";
const request = async (path: string, body?: unknown) => {
  const r = await fetch(base + path, {
    ...(body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
    signal: AbortSignal.timeout(10_000),
  });
  const value = await r.json();
  if (!r.ok) throw new Error(value.error || `HTTP ${r.status}`);
  return value;
};
if ((await request("/api/traffic/status")).active)
  throw new Error(
    "A run is already active; smoke verification will not stop it.",
  );
const proofs = [];
for (const scenario of ["healthy", "degraded"]) {
  const run = await request("/api/traffic/start", {
    baseUrl: base,
    scenario,
    mode: "comparison",
    sessions: 160,
    rate: 40,
    seed: "42",
  });
  let done: any;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const status = await request("/api/traffic/status");
    done = status.runs.find((r: any) => r.id === run.id);
    if (done?.finishedAt) break;
    await sleep(200);
  }
  assert.equal(done?.status, "completed");
  assert.equal(done.progress.failed, 0);
  await sleep(1100);
  const query = new URLSearchParams({
    from: String(run.startedAt),
    to: String(done.finishedAt),
    runId: run.id,
    includePreview: "true",
  });
  const observed = await request("/api/metrics?" + query);
  assert.equal(observed.quality.rolloutEligible, false);
  assert.equal(observed.frozen, true);
  assert.equal(observed.cohorts.original.completed, 80);
  assert.equal(observed.cohorts.redesign.completed, 80);
  assert.ok(
    scenario === "healthy"
      ? observed.comparison.cartDifferencePoints > 0
      : observed.comparison.cartDifferencePoints < 0,
  );
  proofs.push({
    runId: run.id,
    scenario,
    finishedAt: done.finishedAt,
    completed: done.progress.completed,
    originalCartRate: observed.cohorts.original.cartRatePercent,
    redesignCartRate: observed.cohorts.redesign.cartRatePercent,
    differencePoints: observed.comparison.cartDifferencePoints,
    flagsmithProof: false,
    simulated: true,
  });
}
assert.equal(proofs[0].originalCartRate, proofs[1].originalCartRate);
const dir = join(root, ".runtime", "traffic");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "smoke-latest.json"), JSON.stringify(proofs, null, 2));
console.log(JSON.stringify(proofs, null, 2));
