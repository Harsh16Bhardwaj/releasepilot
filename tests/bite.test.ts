import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { BiteData } from "../src/bite/data.js";
import { priceCart } from "../src/bite/menu.js";
import { root } from "../src/config.js";
import { runTraffic, validateOptions } from "../src/traffic/simulator.js";

const dir = mkdtempSync(join(tmpdir(), "bite-test-"));
const base = "http://127.0.0.1:3198";
let child: ChildProcess;
before(async () => {
  child = spawn(
    process.execPath,
    ["--import", "tsx", "src/bite/server.ts", "--production"],
    {
      cwd: root,
      windowsHide: true,
      env: {
        ...process.env,
        BITE_PORT: "3198",
        BITE_DATABASE: join(dir, "site.sqlite"),
        FLAGSMITH_SDK_KEY: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  await new Promise<void>((resolve, reject) => {
    let logs = "";
    const timer = setTimeout(
      () => reject(new Error("Bite did not start: " + logs)),
      15_000,
    );
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Bite exited ${code}: ${logs}`));
    });
    child.stdout!.on("data", (c) => {
      logs += c.toString();
      if (logs.includes("Bite is running")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr!.on("data", (c) => {
      logs += c.toString();
    });
  });
});
after(async () => {
  if (child && child.exitCode === null) {
    child.kill();
    await once(child, "exit");
  }
  rmSync(dir, { recursive: true, force: true });
});
const cookies = (r: Response) =>
  r.headers
    .getSetCookie()
    .map((x) => x.split(";")[0])
    .join("; ");

test("safe fallback and explicitly labelled comparison sessions use different cookies", async () => {
  const r = await fetch(base + "/api/session");
  const s = await r.json();
  assert.equal(s.version, "original");
  assert.equal(s.source, "safe-default");
  assert.equal(s.preview, false);
  const p = await fetch(base + "/api/session", {
    headers: { "X-Bite-Preview": "redesign", Cookie: cookies(r) },
  });
  const ps = await p.json();
  assert.equal(ps.version, "redesign");
  assert.equal(ps.preview, true);
  assert.match(cookies(p), /bite_preview=/);
  const health = await (await fetch(base + "/api/health")).json();
  assert.equal(health.rolloutReady, false);
});
test("parallel duplicate events persist once and cannot spoof variant attribution", async () => {
  const r = await fetch(base + "/api/session");
  const id = randomUUID();
  const requests = await Promise.all(
    Array.from({ length: 12 }, () =>
      fetch(base + "/api/events", {
        method: "POST",
        headers: { Cookie: cookies(r), "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          name: "add_to_cart",
          itemId: "smash",
          version: "redesign",
        }),
      }),
    ),
  );
  const replies = await Promise.all(requests.map((x) => x.json()));
  assert.equal(replies.filter((x) => x.inserted).length, 1);
  const second = await fetch(base + "/api/session");
  const collision = await fetch(base + "/api/events", {
    method: "POST",
    headers: { Cookie: cookies(second), "Content-Type": "application/json" },
    body: JSON.stringify({ id, name: "add_to_cart", itemId: "smash" }),
  });
  assert.equal(collision.status, 400);
});
test("checkout calculates prices on server and is idempotent under concurrent retries", async () => {
  const s = await fetch(base + "/api/session");
  const key = randomUUID();
  const opts = {
    method: "POST",
    headers: { Cookie: cookies(s), "Content-Type": "application/json" },
    body: JSON.stringify({ key, cart: { smash: 1 }, total: 1 }),
  };
  const results = await Promise.all(
    Array.from({ length: 5 }, async () => {
      const r = await fetch(base + "/api/orders", opts);
      assert.equal(r.status, 200);
      return r.json();
    }),
  );
  assert.equal(new Set(results.map((x) => x.id)).size, 1);
  assert.equal(results[0].total, 278);
  assert.equal(results[0].simulated, true);
  const invalid = await fetch(base + "/api/orders", {
    ...opts,
    body: JSON.stringify({ key: randomUUID(), cart: { smash: -1 } }),
  });
  assert.equal(invalid.status, 400);
});
test("foreign-origin event writes are rejected", async () => {
  const r = await fetch(base + "/api/events", {
    method: "POST",
    headers: {
      Origin: "https://example.org",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(r.status, 403);
});
test("real simulated HTTP sessions produce scoped comparison metrics without impersonating Flagsmith", async () => {
  const runId = randomUUID(),
    from = Date.now() - 1;
  const progress = await runTraffic(
    validateOptions({
      baseUrl: base,
      mode: "comparison",
      sessions: 20,
      rate: 50,
      seed: "http-proof",
      scenario: "healthy",
    }),
    runId,
    new AbortController().signal,
    () => {},
  );
  assert.equal(progress.failed, 0);
  assert.equal(progress.completed, 20);
  assert.equal(progress.original, 10);
  assert.equal(progress.redesign, 10);
  const query = new URLSearchParams({
    runId,
    from: String(from),
    to: String(Date.now()),
    includePreview: "true",
  });
  const result = await (await fetch(base + "/api/metrics?" + query)).json();
  assert.equal(result.cohorts.original.completed, 10);
  assert.equal(result.cohorts.redesign.completed, 10);
  assert.equal(result.quality.rolloutEligible, false);
  assert.equal(result.quality.flagsmithOnly, false);
  query.delete("includePreview");
  const normal = await (await fetch(base + "/api/metrics?" + query)).json();
  assert.equal(normal.quality.state, "missing");
});
test("finalized sessions cannot be revised by late events", () => {
  const db = new BiteData(join(dir, "metrics.sqlite"));
  try {
    const s = db.createSession(randomUUID(), "original", "test", "test");
    db.event(randomUUID(), s.id, "page_view");
    db.finalize(Date.now() + 31_000);
    assert.throws(
      () => db.event(randomUUID(), s.id, "add_to_cart", "smash"),
      /finalized/,
    );
  } finally {
    db.db.close();
  }
  assert.deepEqual(priceCart({ smash: 3 }), {
    subtotal: 747,
    delivery: 0,
    total: 747,
  });
});

test("React menu, filters, cart, modal and checkout work against the actual HTTP backend", async () => {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: base + "/?preview=redesign",
  });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    HTMLDialogElement: dom.window.HTMLDialogElement,
    location: dom.window.location,
    localStorage: dom.window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  const realFetch = globalThis.fetch;
  let jar: Record<string, string> = {};
  globalThis.fetch = async (input: any, options: any = {}) => {
    const response = await realFetch(new URL(String(input), base), {
      ...options,
      headers: {
        ...options.headers,
        Cookie: Object.entries(jar)
          .map(([k, v]) => `${k}=${v}`)
          .join("; "),
      },
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [k, v] = cookie.split(";")[0].split("=");
      jar[k] = v;
    }
    return response;
  };
  const { render, screen, cleanup } = await import("@testing-library/react");
  const { userEvent } = await import("@testing-library/user-event");
  const React = await import("react");
  const { App } = await import("../apps/bite/src/App.js");
  try {
    const user = userEvent.setup({ document: dom.window.document });
    render(React.createElement(App));
    await screen.findByRole("button", { name: "Add The OG Smash" });
    const search = screen.getByRole("textbox", { name: "Search the menu" });
    await user.type(search, "pizza");
    assert.equal(
      screen.queryByRole("button", { name: "Add The OG Smash" }),
      null,
    );
    await user.clear(search);
    await user.click(screen.getByRole("button", { name: "View The OG Smash" }));
    assert.ok(screen.getByRole("dialog"));
    await user.click(screen.getByRole("button", { name: "Close dialog" }));
    await user.click(screen.getByRole("button", { name: "Add The OG Smash" }));
    await user.click(screen.getByRole("button", { name: /Review order/ }));
    await user.click(screen.getByRole("button", { name: /Place demo order/ }));
    await screen.findByText("Demo order confirmed!");
    assert.ok(screen.getByText(/No payment was taken/));
  } finally {
    cleanup();
    globalThis.fetch = realFetch;
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
