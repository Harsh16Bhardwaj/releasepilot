import { createHash } from "node:crypto";
import type { BiteData } from "./data.js";

export interface MetricQuery {
  from: number;
  to: number;
  runId?: string;
  build?: string;
  releaseId?: string;
  stageId?: string;
  includePreview?: boolean;
}
const percent = (n: number, d: number) => (d ? (100 * n) / d : null);
export function metrics(data: BiteData, q: MetricQuery, now = Date.now()) {
  if (
    !Number.isSafeInteger(q.from) ||
    !Number.isSafeInteger(q.to) ||
    q.from < 0 ||
    q.to <= q.from ||
    q.to > now ||
    q.to - q.from > 86_400_000
  )
    throw new Error(
      "Metrics window requires past integer from/to timestamps, at most 24 hours.",
    );
  const key = createHash("sha256")
    .update(
      JSON.stringify([
        q.from,
        q.to,
        q.runId ?? null,
        q.build ?? null,
        q.releaseId ?? null,
        q.stageId ?? null,
        !!q.includePreview,
      ]),
    )
    .digest("hex");
  const saved = data.db
    .prepare("SELECT body FROM metric_windows WHERE key=?")
    .get(key) as { body: string } | undefined;
  if (saved) {
    const value = JSON.parse(saved.body);
    const age =
      value.freshness.lastEventAt === null
        ? null
        : now - value.freshness.lastEventAt;
    return {
      ...value,
      cached: true,
      freshness: {
        ...value.freshness,
        ageMs: age,
        stale: age === null || age > 15_000,
        snapshotAgeMs: now - value.collectedAt,
      },
    };
  }
  const where = ["s.created>=?", "s.created<?"];
  const params: (string | number)[] = [q.from, q.to];
  if (!q.includePreview) where.push("s.preview=0");
  for (const [field, value] of [
    ["run_id", q.runId],
    ["build", q.build],
    ["release_id", q.releaseId],
    ["stage_id", q.stageId],
  ] as const)
    if (value !== undefined) {
      where.push(`s.${field}=?`);
      params.push(value);
    }
  const clause = where.join(" AND ");
  const sessions = data.db
    .prepare(
      `SELECT s.*,
    EXISTS(SELECT 1 FROM events e WHERE e.session_id=s.id AND e.name='add_to_cart') AS cart,
    EXISTS(SELECT 1 FROM events e WHERE e.session_id=s.id AND e.name='checkout_start') AS checkout,
    EXISTS(SELECT 1 FROM events e WHERE e.session_id=s.id AND e.name IN ('item_click','add_to_cart','checkout_start')) AS engaged
    FROM sessions s WHERE ${clause} LIMIT 50001`,
    )
    .all(...params) as any[];
  if (sessions.length > 50_000)
    throw new Error(
      "Metrics cohort exceeds 50000 sessions; narrow the window or run scope.",
    );
  const result: Record<string, any> = {};
  for (const version of ["original", "redesign"]) {
    const cohort = sessions.filter((s) => s.version === version);
    const finished = cohort.filter((s) => s.completed !== null);
    // Only completed sessions contribute to frozen request statistics.
    const requests = data.db
      .prepare(
        `SELECT r.status,r.duration_ms FROM requests r JOIN sessions s ON s.id=r.session_id WHERE ${clause} AND s.version=? AND s.completed IS NOT NULL ORDER BY r.duration_ms`,
      )
      .all(...params, version) as { status: number; duration_ms: number }[];
    result[version] = {
      visitors: new Set(cohort.map((s) => s.visitor)).size,
      sessions: cohort.length,
      completed: finished.length,
      active: cohort.length - finished.length,
      cartSessions: finished.filter((s) => s.cart).length,
      cartRatePercent: percent(
        finished.filter((s) => s.cart).length,
        finished.length,
      ),
      checkoutRatePercent: percent(
        finished.filter((s) => s.checkout).length,
        finished.length,
      ),
      bounceRatePercent: percent(
        finished.filter((s) => !s.engaged).length,
        finished.length,
      ),
      requests: requests.length,
      errors: requests.filter((r) => r.status >= 500).length,
      errorRatePercent: percent(
        requests.filter((r) => r.status >= 500).length,
        requests.length,
      ),
      p95Ms: requests.length
        ? requests[Math.ceil(requests.length * 0.95) - 1].duration_ms
        : null,
    };
  }
  const active = sessions.filter((s) => s.completed === null).length;
  // Inactivity finalization runs every five seconds. Future arrivals cannot enter a cohort older than this guard.
  const frozen = sessions.length > 0 && active === 0 && now - q.to >= 1000;
  const end = sessions.length
    ? sessions.reduce((n, s) => Math.max(n, s.last_seen), 0)
    : null;
  const flagsmithOnly =
    sessions.length > 0 &&
    sessions.every((s) => s.source === "flagsmith" && !s.preview);
  const response = {
    query: q,
    windowKey: key,
    collectedAt: now,
    frozen,
    cached: false,
    cohorts: result,
    comparison: {
      cartDifferencePoints:
        result.original.cartRatePercent !== null &&
        result.redesign.cartRatePercent !== null
          ? result.redesign.cartRatePercent - result.original.cartRatePercent
          : null,
    },
    quality: {
      state: !sessions.length
        ? "missing"
        : active
          ? "collecting"
          : result.original.completed === 0 || result.redesign.completed === 0
            ? "one_cohort_only"
            : "available",
      activeSessions: active,
      previewIncluded: !!q.includePreview,
      simulatedSessions: sessions.filter((s) => s.simulated).length,
      flagsmithOnly,
      rolloutEligible:
        flagsmithOnly &&
        !!q.build &&
        !!q.releaseId &&
        !!q.stageId &&
        !q.includePreview,
      note: q.includePreview
        ? "Comparison simulation: never rollout authorization or real-user UX evidence."
        : "Metrics alone never authorize a release.",
    },
    freshness: {
      lastEventAt: end,
      ageMs: end === null ? null : now - end,
      stale: end === null || now - end > 15_000,
      snapshotAgeMs: 0,
    },
  };
  if (frozen)
    data.db
      .prepare("INSERT OR IGNORE INTO metric_windows VALUES(?,?)")
      .run(key, JSON.stringify(response));
  return response;
}
