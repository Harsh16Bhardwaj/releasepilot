import "dotenv/config";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, createReadStream } from "node:fs";
import { join, resolve, extname, sep } from "node:path";
import { Flagsmith } from "@flagsmith/nodejs";
import { root, redact,config } from "../config.js";
import { menu, categories, priceCart } from "./menu.js";
import { BiteData, type Version } from "./data.js";
import { metrics } from "./metrics.js";

const port = Number(process.env.BITE_PORT || 3100);
const production = process.argv.includes("--production");
const db = new BiteData(
  process.env.BITE_DATABASE || join(root, ".runtime", "bite", "bite.sqlite"),
);
const build = (() => {
  try {
    return production
      ? JSON.parse(
          readFileSync(join(root, "dist", "bite", "build.json"), "utf8"),
        )
      : {
          commit: execFileSync("git", ["rev-parse", "HEAD"], {
            cwd: root,
            stdio: ["ignore", "pipe", "ignore"],
          })
            .toString()
            .trim(),
          dirty: true,
          mode: "development",
        };
  } catch {
    return {
      commit: "uncommitted",
      dirty: true,
      mode: production ? "production" : "development",
    };
  }
})();
const sdk = process.env.FLAGSMITH_SDK_KEY && process.env.BITE_DISABLE_FLAGSMITH!=='true'
  ? new Flagsmith({
      environmentKey: process.env.FLAGSMITH_SDK_KEY,
      apiUrl:config().flagsmith.sdkUrl,
      enableLocalEvaluation: true,
      enableAnalytics: false,
      enableEvents: false,
      retries: 0,
      requestTimeoutSeconds: 3,
      environmentRefreshIntervalSeconds: 5,
    })
  : null;
let flagsHealth = sdk
  ? "Not evaluated yet"
  : "Not configured — serving original safely";
const cookies = (req: IncomingMessage) =>
  Object.fromEntries(
    (req.headers.cookie || "")
      .split(";")
      .map((x) => x.trim().split("="))
      .filter((x) => x.length === 2),
  );
const preview = (req: IncomingMessage) =>
  req.headers["x-bite-preview"] === "redesign"
    ? "redesign"
    : req.headers["x-bite-preview"] === "original"
      ? "original"
      : null;
function session(req: IncomingMessage) {
  return db.session(
    cookies(req)[preview(req) ? "bite_preview" : "bite_session"] || "",
  );
}
function reply(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
}
async function body(req: IncomingMessage) {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (Buffer.byteLength(data) > 16_384) throw new Error("Request too large");
  }
  return JSON.parse(data || "{}");
}
const interval = setInterval(() => db.finalize(), 5000);
interval.unref();
const vite = !production
  ? await (
      await import("vite")
    ).createServer({
      configFile: join(root, "vite.config.ts"),
      server: { middlewareMode: true },
      appType: "spa",
    })
  : null;
const server = createServer(async (req, res) => {
  const started = performance.now();
  let requestSession = session(req)?.id ?? null;
  res.on("finish", () => {
    if (
      req.url &&
      ["/api/events", "/api/menu", "/api/orders", "/api/session/end"].includes(
        req.url.split("?")[0],
      )
    ) {
      try {
        db.db
          .prepare(
            "INSERT INTO requests(session_id,status,duration_ms,created) VALUES(?,?,?,?)",
          )
          .run(
            requestSession,
            res.statusCode,
            performance.now() - started,
            Date.now(),
          );
      } catch {
        /* shutting down */
      }
    }
  });
  try {
    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
    if (req.method !== "GET" && req.method !== "HEAD") {
      const origin = req.headers.origin;
      if (
        origin &&
        ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(
          origin,
        )
      ) {
        reply(res, 403, { error: "Foreign origin rejected" });
        return;
      }
      if (!req.headers["content-type"]?.startsWith("application/json")) {
        reply(res, 415, { error: "JSON content type required" });
        return;
      }
    }
    if (url.pathname === "/api/health") {
      reply(res, 200, {
        service: "bite",
        ...build,
        flagsmith: flagsHealth,
        rolloutReady:
          !!sdk &&
          flagsHealth === "Connected" &&
          !build.dirty &&
          build.commit !== "uncommitted",
        simulation: true,
      });
      return;
    }
    if (url.pathname === "/api/menu" && req.method === "GET") {
      reply(res, 200, { menu, categories });
      return;
    }
    if (url.pathname === "/api/session" && req.method === "GET") {
      const mode = preview(req);
      let current = session(req);
      if (
        !current ||
        current.completed !== null ||
        (mode && current.version !== mode)
      ) {
        const visitor = /^[a-f0-9-]{36}$/.test(cookies(req).bite_visitor || "")
          ? cookies(req).bite_visitor
          : randomUUID();
        let version: Version = "original",
          source = "safe-default";
        if (mode) {
          version = mode;
          source = "comparison-preview";
        } else if (sdk) {
          try {
            const flags = await sdk.getIdentityFlags(visitor);
            if (!flags.flags.menu_redesign)
              throw new Error("menu_redesign is missing");
            version = flags.isFeatureEnabled("menu_redesign")
              ? "redesign"
              : "original";
            source = "flagsmith";
            flagsHealth = "Connected";
          } catch {
            flagsHealth = "Evaluation failed — serving original safely";
          }
        }
        current = db.createSession(
          visitor,
          version,
          source,
          build.commit,
          !!mode,
          {
            runId:
              typeof req.headers["x-bite-run"] === "string" &&
              /^[a-f0-9-]{36}$/.test(req.headers["x-bite-run"])
                ? req.headers["x-bite-run"]
                : undefined,
            simulated: req.headers["x-bite-simulation"] === "true",
          },
        );
        res.setHeader("Set-Cookie", [
          `bite_visitor=${visitor}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`,
          `${mode ? "bite_preview" : "bite_session"}=${current.id}; Path=/; HttpOnly; SameSite=Strict`,
        ]);
      }
      requestSession = current.id;
      reply(res, 200, {
        id: current.id,
        version: current.version,
        source: current.source,
        preview: !!current.preview,
        build: current.build,
        simulated: !!current.simulated,
        runId: current.run_id,
      });
      return;
    }
    if (url.pathname === "/api/session/end" && req.method === "POST") {
      const s = session(req);
      if (!s) {
        reply(res, 409, { error: "Session not found" });
        return;
      }
      db.endSession(s.id);
      reply(res, 200, { completed: true });
      return;
    }
    if (url.pathname === "/api/metrics" && req.method === "GET") {
      reply(
        res,
        200,
        metrics(db, {
          from: Number(url.searchParams.get("from")),
          to: Number(url.searchParams.get("to")),
          ...(url.searchParams.has("runId")
            ? { runId: url.searchParams.get("runId")! }
            : {}),
          ...(url.searchParams.has("build")
            ? { build: url.searchParams.get("build")! }
            : {}),
          ...(url.searchParams.has("releaseId")
            ? { releaseId: url.searchParams.get("releaseId")! }
            : {}),
          ...(url.searchParams.has("stageId")
            ? { stageId: url.searchParams.get("stageId")! }
            : {}),
          includePreview: url.searchParams.get("includePreview") === "true",
        }),
      );
      return;
    }
    if (url.pathname.startsWith("/api/traffic/")) {
      const path = url.pathname.slice("/api/traffic".length);
      if (
        !["/status", "/runs", "/start", "/stop"].includes(path) ||
        !(
          (req.method === "GET" && ["/status", "/runs"].includes(path)) ||
          (req.method === "POST" && ["/start", "/stop"].includes(path))
        )
      ) {
        reply(res, 404, { error: "Unknown traffic operation" });
        return;
      }
      try {
        const forwarded = req.method === "POST" ? await body(req) : undefined;
        const response = await fetch(
          `http://127.0.0.1:${process.env.TRAFFIC_PORT || 3200}${path}`,
          {
            method: req.method,
            headers: { "Content-Type": "application/json" },
            ...(forwarded ? { body: JSON.stringify(forwarded) } : {}),
            signal: AbortSignal.timeout(5000),
            redirect: "error",
          },
        );
        reply(res, response.status, await response.json());
      } catch {
        reply(res, 503, {
          error:
            "Traffic Lab is not running. Start npm run traffic:server in another terminal.",
        });
      }
      return;
    }
    if (url.pathname === "/api/events" && req.method === "POST") {
      const s = session(req);
      if (!s || s.completed !== null) {
        reply(res, 409, { error: "Session expired; refresh session first" });
        return;
      }
      const data = await body(req);
      if (
        typeof data.id !== "string" ||
        !/^[a-f0-9-]{36}$/.test(data.id) ||
        typeof data.name !== "string" ||
        (data.itemId != null && !menu.some((x) => x.id === data.itemId))
      ) {
        reply(res, 400, { error: "Invalid event" });
        return;
      }
      reply(res, 200, {
        persisted: true,
        inserted: db.event(data.id, s.id, data.name, data.itemId || null),
      });
      return;
    }
    if (url.pathname === "/api/orders" && req.method === "POST") {
      const s = session(req);
      if (!s || s.completed !== null) {
        reply(res, 409, { error: "Session expired; refresh first" });
        return;
      }
      const data = await body(req);
      if (
        typeof data.key !== "string" ||
        !/^[a-f0-9-]{36}$/.test(data.key) ||
        !data.cart ||
        typeof data.cart !== "object" ||
        Array.isArray(data.cart)
      ) {
        reply(res, 400, { error: "Invalid order" });
        return;
      }
      const total = priceCart(data.cart);
      const order = db.order(s.id, data.key, data.cart, total.total);
      reply(res, 200, {
        ...order,
        ...total,
        simulated: true,
        message:
          "Demo order received. No payment taken; no restaurant contacted.",
      });
      return;
    }
    if (url.pathname === "/api/activity" && req.method === "GET") {
      reply(res, 200, { ...db.summary(), flagsmith: flagsHealth });
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      reply(res, 404, { error: "Route not found" });
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      reply(res, 405, { error: "Method not allowed" });
      return;
    }
    if (vite) {
      vite.middlewares(req, res);
      return;
    }
    const base = join(root, "dist", "bite");
    const pathname = decodeURIComponent(url.pathname);
    const file = resolve(base, "." + pathname);
    if (!file.startsWith(base + sep) && file !== base) {
      reply(res, 403, { error: "Forbidden" });
      return;
    }
    const target =
      existsSync(file) && extname(file) ? file : join(base, "index.html");
    const types: Record<string, string> = {
      ".html": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
      ".jpg": "image/jpeg",
      ".svg": "image/svg+xml",
      ".json": "application/json",
    };
    res.setHeader(
      "Content-Type",
      types[extname(target)] || "application/octet-stream",
    );
    createReadStream(target)
      .on("error", () => {
        if (!res.headersSent) res.writeHead(404);
        res.end();
      })
      .pipe(res);
  } catch (e) {
    if (!res.headersSent)
      reply(res, 400, {
        error: redact(e instanceof Error ? e.message : "Request failed"),
      });
    else res.end();
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    `Bite is running at http://127.0.0.1:${port}\nComparison preview: http://127.0.0.1:${port}/?preview=redesign\nNormal visitors: actual Flagsmith assignment or safe original fallback.`,
  ),
);
async function shutdown() {
  clearInterval(interval);
  server.close();
  await vite?.close();
  await sdk?.close(1000);
  db.db.close();
}
process.once("SIGINT", () => {
  void shutdown().then(() => process.exit());
});
process.once("SIGTERM", () => {
  void shutdown().then(() => process.exit());
});
