import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config, repository, redact, root } from "./config.js";
import { Store } from "./store.js";
import { GitHub } from "./github.js";
import { analyze, command } from "./analysis.js";
import {
  FlagsmithManagement,
  probe,
  requireFlagsmith,
  scope,
} from "./flagsmith.js";
import { githubCredential } from "./credentials.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    repo: { type: "string" },
    pr: { type: "string" },
    restore: { type: "boolean" },
    help: { type: "boolean" },
  },
});
const action = positionals[0] || "doctor";
if (values.help || !values.repo) {
  console.log(
    "ReleasePilot Sprint 1\nCommands: doctor | discover | analyze --pr NUMBER | flagsmith-probe [--restore] | gate | start\nUsage: npm run doctor -- --repo owner/repository\nRead README.md for setup and current sprint gate.",
  );
  process.exitCode = values.help ? 0 : 2;
} else {
  let store: Store | undefined;
  let locked = false;
  try {
    const repo = repository(values.repo);
    const cfg = config();
    store = new Store(repo);
    const githubToken = githubCredential();
    const github = new GitHub(repo, githubToken);
    const print = (v: unknown) =>
      console.log(redact(JSON.stringify(v, null, 2)));
    if (!["doctor", "gate"].includes(action)) {
      store.acquire();
      locked = true;
    }
    if (action === "doctor" || action === "start") {
      const checks: { name: string; ok: boolean; detail: string }[] = [];
      const check = async (name: string, fn: () => Promise<string>) => {
        try {
          checks.push({ name, ok: true, detail: await fn() });
        } catch (e) {
          checks.push({ name, ok: false, detail: redact(String(e)) });
        }
      };
      await check(
        "Node/SQLite",
        async () => process.version + " / SQLite operational",
      );
      await check("Codex authentication", async () => {
        const r = await command(cfg.codexBin, ["login", "status"], 15_000);
        const text = r.stdout + r.stderr;
        if (!/ChatGPT/i.test(text))
          throw new Error(
            "ChatGPT login required. Run codex login interactively; no API billing fallback.",
          );
        return "Signed in using ChatGPT; inference still requires live proof.";
      });
      await check("GitHub repository", async () => {
        const prs = await github.listPRs();
        return `Readable; ${prs.length} open PRs on first page. ${githubToken ? "Authenticated" : "Anonymous public access; rate limits apply"}.`;
      });
      await check("Flagsmith management", async () => {
        requireFlagsmith(cfg);
        await new FlagsmithManagement(cfg).read();
        return "Configured segment readable. Mutation/SDK proof still required.";
      });
      const report = {
        repository: repo,
        at: new Date().toISOString(),
        checks,
        laterSprintConfiguration: {
          deployment: !!cfg.deploymentUrl,
          metrics: !!cfg.metricsUrl,
        },
        gate: gate(store, cfg),
      };
      store.record("doctor", report);
      store.report("doctor", report);
      print(report);
      if (action === "start") {
        // Product watcher belongs to Sprint 4; sequential gates deliberately stop here.
        console.log(
          "Sprint 1 startup completed. Full watcher is not implemented yet. Read docs/SPRINTS.md; no rollout was started.",
        );
        process.exitCode = 2;
      } else if (checks.some((c) => !c.ok)) process.exitCode = 2;
    } else if (action === "discover") {
      const profile = await github.profile();
      store.record("profile", profile);
      const file = store.report("repository-profile", profile);
      print({
        repository: repo,
        commit: profile.commit,
        profile: file,
        files: profile.files.map((x) => x.path),
        treeTruncated: profile.treeTruncated,
      });
    } else if (action === "analyze") {
      if (!values.pr) throw new Error("--pr NUMBER is required");
      const login = await command(cfg.codexBin, ["login", "status"], 15_000);
      if (!/ChatGPT/i.test(login.stdout + login.stderr))
        throw new Error(
          "Sign in using ChatGPT before analysis; API billing is disabled by policy",
        );
      const bundle = await github.bundle(Number(values.pr));
      store.record("profile", bundle.profile);
      store.report("repository-profile", bundle.profile);
      store.record("github_proof", {
        at: new Date().toISOString(),
        pr: bundle.pr,
        headSha: bundle.headSha,
        fileCount: bundle.files.length,
      });
      console.log(
        `Read real PR #${bundle.pr}, ${bundle.files.length} changed files. Running fresh Codex analysis...`,
      );
      const result = await analyze(bundle, cfg, store);
      print(result);
    } else if (action === "flagsmith-probe") {
      print(await probe(cfg, store, !!values.restore));
    } else if (action === "gate") {
      const result = gate(store, cfg);
      store.report("sprint-1-gate", result);
      print(result);
      if (!result.passed) process.exitCode = 2;
    } else throw new Error(`Unknown command: ${action}`);
  } catch (e) {
    console.error(redact(String(e)));
    process.exitCode = 1;
  } finally {
    if (locked) store?.release();
    store?.close();
  }
}

function gate(store: Store, cfg: ReturnType<typeof config>) {
  const gh = store.latest("github_proof"),
    ai = store.latest("analysis"),
    flags = store.latest("flagsmith_proof"),
    snapshot = store.latest("probe_snapshot"),
    restored = store.latest("probe_restored");
  const fresh = (date: unknown) =>
    typeof date === "string" && Date.now() - Date.parse(date) < 24 * 3600_000;
  const checks = {
    realPR: !!gh && fresh(gh.at),
    freshCodexAnalysis:
      !!ai &&
      fresh(ai.analyzedAt) &&
      ai.headSha === gh?.headSha &&
      ai.pr === gh?.pr,
    flagsmithMutationReadbackCohortsAndRestore:
      !!flags &&
      fresh(flags.at) &&
      flags.scope === scope(cfg) &&
      flags.restored === true,
    noOutstandingRestoration: !snapshot || restored?.snapshotId === snapshot.id,
  };
  return {
    sprint: 1,
    passed: Object.values(checks).every(Boolean),
    checks,
    next: Object.values(checks).every(Boolean)
      ? "Sprint 2 prerequisites satisfied; verify proof reports before implementation."
      : "Sprint 2 is blocked. Complete the missing live proofs; mocks cannot satisfy this gate.",
  };
}
