import { createHash, randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

export type Scenario = "healthy" | "neutral" | "degraded";
export interface TrafficOptions {
  baseUrl: string;
  scenario: Scenario;
  seed: string;
  sessions: number;
  rate: number;
  mode: "comparison" | "flagsmith";
}
export function validateOptions(input: any): TrafficOptions {
  const value = {
    baseUrl: "http://127.0.0.1:3100",
    scenario: "healthy",
    seed: "42",
    sessions: 120,
    rate: 5,
    mode: "comparison",
    ...input,
  };
  const url = new URL(value.baseUrl);
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("Traffic target must be a local HTTP origin");
  if (
    !["healthy", "neutral", "degraded"].includes(value.scenario) ||
    !["comparison", "flagsmith"].includes(value.mode)
  )
    throw new Error("Invalid scenario or assignment mode");
  if (
    !Number.isInteger(value.sessions) ||
    value.sessions < 1 ||
    value.sessions > 20_000 ||
    !Number.isInteger(value.rate) ||
    value.rate < 1 ||
    value.rate > 50
  )
    throw new Error("Choose 1–20000 sessions and 1–50 visits per second");
  if (typeof value.seed !== "string" || !value.seed || value.seed.length > 100)
    throw new Error("Seed must contain 1–100 characters");
  return { ...value, baseUrl: url.origin };
}
const sample = (seed: string, index: number, label: string) =>
  createHash("sha256")
    .update(`${seed}:${index}:${label}`)
    .digest()
    .readUInt32BE(0) /
  2 ** 32;
export function visitorId(seed: string, index: number) {
  const hex = createHash("sha256")
    .update(`${seed}:visitor:${index}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function behaviour(
  seed: string,
  index: number,
  scenario: Scenario,
  version: string,
) {
  const cartChance =
    version === "original"
      ? 0.42
      : scenario === "healthy"
        ? 0.64
        : scenario === "degraded"
          ? 0.08
          : 0.42;
  const cart = sample(seed, index, "cart") < cartChance;
  return {
    cart,
    engage:
      cart ||
      sample(seed, index, "engage") <
        (version === "redesign" && scenario === "degraded" ? 0.18 : 0.75),
    checkout: cart && sample(seed, index, "checkout") < 0.65,
  };
}
export interface TrafficProgress {
  attempted: number;
  completed: number;
  failed: number;
  original: number;
  redesign: number;
}
export async function runTraffic(
  options: TrafficOptions,
  runId: string,
  signal: AbortSignal,
  onProgress: (p: TrafficProgress) => void,
) {
  const p: TrafficProgress = {
    attempted: 0,
    completed: 0,
    failed: 0,
    original: 0,
    redesign: 0,
  };
  const active = new Set<Promise<void>>();
  const visit = async (index: number) => {
    const mode =
      options.mode === "comparison"
        ? index % 2
          ? "redesign"
          : "original"
        : null;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Bite-Simulation": "true",
      "X-Bite-Run": runId,
      ...(mode ? { "X-Bite-Preview": mode } : {}),
    };
    let jar: Record<string, string> = {
      bite_visitor: visitorId(options.seed, index),
    };
    const request = async (path: string, body?: unknown) => {
      const response = await fetch(options.baseUrl + path, {
        method: body ? "POST" : "GET",
        headers: {
          ...headers,
          Cookie: Object.entries(jar)
            .map(([k, v]) => `${k}=${v}`)
            .join("; "),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      });
      for (const cookie of response.headers.getSetCookie()) {
        const [k, v] = cookie.split(";")[0].split("=");
        jar[k] = v;
      }
      if (!response.ok)
        throw new Error(`Visitor request ${path}: HTTP ${response.status}`);
      return response.json();
    };
    const event = (name: string, itemId?: string) =>
      request("/api/events", { id: randomUUID(), name, itemId });
    try {
      const session = await request("/api/session");
      p[session.version as "original" | "redesign"]++;
      await request("/api/menu");
      await event("page_view");
      const b = behaviour(
        options.seed,
        index,
        options.scenario,
        session.version,
      );
      await sleep(
        30 + Math.floor(sample(options.seed, index, "pace") * 80),
        undefined,
        { signal },
      );
      if (b.engage) await event("item_click", "smash");
      if (b.cart) await event("add_to_cart", "smash");
      if (b.checkout) await event("checkout_start");
      await request("/api/session/end", {});
      p.completed++;
    } catch {
      p.failed++;
    } finally {
      onProgress({ ...p });
    }
  };
  const started = performance.now();
  for (let i = 0; i < options.sessions && !signal.aborted; i++) {
    const wait = started + (i / options.rate) * 1000 - performance.now();
    if (wait > 0)
      try {
        await sleep(wait, undefined, { signal });
      } catch {
        break;
      }
    if (active.size >= 64) await Promise.race(active);
    if (signal.aborted) break;
    p.attempted++;
    const task = visit(i);
    active.add(task);
    void task.finally(() => active.delete(task));
  }
  await Promise.all(active);
  return p;
}
