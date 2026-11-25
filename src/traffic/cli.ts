import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { runTraffic, validateOptions } from "./simulator.js";
const { values } = parseArgs({
  options: {
    scenario: { type: "string", default: "healthy" },
    seed: { type: "string", default: "42" },
    sessions: { type: "string", default: "120" },
    rate: { type: "string", default: "5" },
    mode: { type: "string", default: "comparison" },
    url: { type: "string", default: "http://127.0.0.1:3100" },
  },
});
try {
  const options = validateOptions({
    baseUrl: values.url,
    scenario: values.scenario,
    seed: values.seed,
    sessions: Number(values.sessions),
    rate: Number(values.rate),
    mode: values.mode,
  });
  const abort = new AbortController();
  process.once("SIGINT", () => abort.abort());
  const runId = randomUUID();
  console.log(
    JSON.stringify({
      runId,
      options,
      label: "SIMULATED VISITORS — not real-user UX evidence",
    }),
  );
  const result = await runTraffic(options, runId, abort.signal, (p) => {
    if ((p.completed + p.failed) % 20 === 0) console.log(JSON.stringify(p));
  });
  console.log(
    JSON.stringify({ runId, ...result, stopped: abort.signal.aborted }),
  );
  if (result.failed) process.exitCode = 1;
} catch (e) {
  console.error(e instanceof Error ? e.message : "Traffic failed");
  process.exitCode = 1;
}
