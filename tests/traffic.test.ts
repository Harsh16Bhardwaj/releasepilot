import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { BiteData } from "../src/bite/data.js";
import { metrics } from "../src/bite/metrics.js";
import {
  behaviour,
  visitorId,
  validateOptions,
} from "../src/traffic/simulator.js";

test("seeded visitor IDs and decisions repeat; scenario never changes control behaviour", () => {
  for (let i = 0; i < 200; i++) {
    assert.equal(visitorId("42", i), visitorId("42", i));
    assert.deepEqual(
      behaviour("42", i, "healthy", "original"),
      behaviour("42", i, "degraded", "original"),
    );
    assert.deepEqual(
      behaviour("42", i, "healthy", "redesign"),
      behaviour("42", i, "healthy", "redesign"),
    );
  }
  const count = (scenario: "healthy" | "degraded") =>
    Array.from({ length: 200 }, (_, i) =>
      behaviour("42", i, scenario, "redesign"),
    ).filter((v) => v.cart).length;
  assert.ok(count("healthy") > count("degraded") + 70);
  assert.equal(
    new Set(Array.from({ length: 1000 }, (_, i) => visitorId("42", i))).size,
    1000,
  );
});
test("traffic limits reject remote targets, bad rate and unsupported modes", () => {
  for (const input of [
    { baseUrl: "https://example.com" },
    { baseUrl: "http://localhost:3100/private" },
    { sessions: Infinity },
    { rate: 51 },
    { mode: "pretend_flagsmith" },
  ])
    assert.throws(() => validateOptions(input));
  assert.equal(validateOptions({}).mode, "comparison");
});
test("metrics separate previews and runs, count sessions once, freeze mature windows and retain freshness", () => {
  const dir = mkdtempSync(join(tmpdir(), "metrics-"));
  const data = new BiteData(join(dir, "data.sqlite"));
  try {
    const from = Date.now() - 1000;
    const a = data.createSession(
      randomUUID(),
      "original",
      "comparison-preview",
      "sha",
      true,
      { runId: "a", simulated: true },
    );
    const b = data.createSession(
      randomUUID(),
      "redesign",
      "comparison-preview",
      "sha",
      true,
      { runId: "a", simulated: true },
    );
    const other = data.createSession(
      randomUUID(),
      "redesign",
      "comparison-preview",
      "sha",
      true,
      { runId: "b", simulated: true },
    );
    data.event(randomUUID(), a.id, "page_view");
    data.event(randomUUID(), b.id, "page_view");
    data.event(randomUUID(), b.id, "add_to_cart", "smash");
    data.event(randomUUID(), b.id, "add_to_cart", "smash");
    data.endSession(a.id);
    data.endSession(b.id);
    data.endSession(other.id);
    const to = Date.now() + 1,
      now = to + 2000;
    assert.equal(
      metrics(data, { from, to, runId: "a" }, now).quality.state,
      "missing",
    );
    const query = { from, to, runId: "a", includePreview: true };
    const result = metrics(data, query, now);
    assert.equal(result.cohorts.original.completed, 1);
    assert.equal(result.cohorts.redesign.completed, 1);
    assert.equal(result.cohorts.redesign.cartRatePercent, 100);
    assert.equal(result.cohorts.redesign.cartSessions, 1);
    assert.equal(result.quality.rolloutEligible, false);
    assert.equal(result.frozen, true);
    const later = metrics(data, query, now + 20_000);
    assert.equal(later.cached, true);
    assert.equal(later.freshness.stale, true);
    assert.deepEqual(later.cohorts, result.cohorts);
    const wrongScope = metrics(
      data,
      { from, to, runId: "a", releaseId: "unknown", includePreview: true },
      now,
    );
    assert.equal(wrongScope.quality.state, "missing");
    assert.throws(() => metrics(data, { from, to: now + 1 }, now), /past/);
  } finally {
    data.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("active and single-cohort observations never imply successful comparison", () => {
  const dir = mkdtempSync(join(tmpdir(), "metrics-state-"));
  const data = new BiteData(join(dir, "data.sqlite"));
  try {
    const from = Date.now() - 1000;
    const s = data.createSession(
      randomUUID(),
      "original",
      "safe-default",
      "sha",
    );
    const to = Date.now() + 1;
    assert.equal(
      metrics(data, { from, to }, to + 2000).quality.state,
      "collecting",
    );
    data.endSession(s.id);
    const result = metrics(data, { from, to }, to + 3000);
    assert.equal(result.quality.state, "one_cohort_only");
    assert.equal(result.cohorts.redesign.cartRatePercent, null);
    assert.equal(result.quality.flagsmithOnly, false);
  } finally {
    data.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
