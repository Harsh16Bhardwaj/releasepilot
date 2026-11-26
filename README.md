# ReleasePilot

A local release agent for Flagsmith, with **Bite**, a working food-ordering website, and **Traffic Lab**, a separate simulated-visitor service and comparison board. Agent foundations, website, traffic/metrics and live Flagsmith Cloud integration are implemented. Percentage targeting, SDK verification, restoration and active-session recovery have been demonstrated. The human-approved autonomous rollout controller remains the next phase.

## Run Bite now

```powershell
npm ci --ignore-scripts
npm run bite
```

On this Windows installation use `npm.cmd` in place of `npm`.

- Website: http://127.0.0.1:3100/
- Redesign comparison: http://127.0.0.1:3100/?preview=redesign
- Original comparison: http://127.0.0.1:3100/?preview=original
- Health and build evidence: http://127.0.0.1:3100/api/health

Menu search, category/vegetarian/rating filters, favourites, item details, cart quantities, delivery calculation, delivery labels and simulated checkout work. The backend calculates prices, saves idempotent orders, deduplicates events and records server-assigned session versions in SQLite. No real payments or restaurant requests occur. The activity icon opens persisted event history.

Normal traffic receives actual Flagsmith assignment when configured; otherwise it safely receives the original. Preview links explicitly bypass assignment for comparison and are separately labelled in storage. Preview data is never proof of a real rollout. Both styles are included for independent review; the demonstration PR and autonomous approval/rollout wiring are still future work.

Production mode: `npm run build`, then `npm run bite:production`. Builds include commit/dirty metadata. Development or dirty builds are not reported as ready for an approved rollout. Runtime data lives under `.runtime/bite/` and is ignored by Git.

## Traffic Lab

Run Bite in one terminal and the separate simulator service in another:

```powershell
npm run bite
npm run traffic:server
```

Open http://127.0.0.1:3100/lab to start/stop healthy, neutral or degraded visitor scenarios and inspect live comparison metrics and persisted run history. On this machine use `npm.cmd` instead of the PowerShell `npm` wrapper.

Comparison mode explicitly previews original/redesign at 50/50 and is excluded from rollout evidence. Flagsmith mode asks Bite to choose actual visitor versions; absent credentials it honestly produces only the original. Simulation settings live in the separate Traffic Lab database and are never sent to the metrics evaluator. Both modes generate real local HTTP requests and clearly labelled simulated sessions.

Standalone simulator (does not need the lab service):

```powershell
npm.cmd run traffic -- --scenario healthy --mode comparison --sessions 120 --rate 5 --seed 42
```

Stable seeded identities and decisions repeat across runs; observed network latency is naturally variable. Explicit simulated session endings or 30 seconds of inactivity finalize sessions. Metrics use completed sessions, count cart conversions once per session, distinguish missing/one-cohort/stale data, and freeze closed windows. Errors mean HTTP 5xx; P95 uses measured API request durations. Comparison does not establish real human preference.

`GET /api/metrics?from=<epoch-ms>&to=<epoch-ms>&runId=<id>&includePreview=true` reads a bounded cohort window. Preview inclusion must be explicit; default queries exclude it. Optional `build`, `releaseId` and `stageId` narrow the scope. Release/stage fields are reserved; the pending release engine must assign them before any window can qualify as scoped rollout evidence. Empty data is not zero-percent failures. Frozen historical metrics expose their age instead of pretending to remain fresh.

Run history persists in `.runtime/traffic/lab.sqlite`. Only one run can be active. Stop cancels scheduled visits and outstanding requests. A hard-killed run is marked interrupted on the next service start, without automatically resuming it. HTTP-only simulation is implemented; browser automation remains unavailable in Work settings.

## Agent setup

```powershell
npm ci --ignore-scripts
Copy-Item .env.example .env
# Fill local .env in your editor; never paste keys into the chat or repository.
codex login
npm run doctor -- --repo owner/repository
npm run discover -- --repo owner/repository
npm run analyze -- --repo owner/repository --pr 123
npm run flagsmith:probe -- --repo owner/repository
npm run gate -- --repo owner/repository
```

On this Windows installation PowerShell resolves `npm` to a wrapper that strips forwarded option names. Use **`npm.cmd`** in the commands above (for example `npm.cmd run analyze -- --repo owner/repository --pr 123`) to preserve arguments. This is verified locally; no global shell configuration is changed.

`npm run pilot -- --repo owner/repository` starts diagnostics and reports the current gate. In Sprint 1 it exits with an explicit not-yet-implemented watcher message. It does not silently claim to start the full product. No command needs this conversation.

Use a real public PR with <=40 changed text files and <=320KB UTF-8 context. Local Git Credential Manager authentication is reused automatically; a read-only token is optional. The analysis command reads metadata, diff and complete changed head files plus selected root documents, removing duplicate baseline documents when their changed head file is already included. Missing/binary patches and oversized bundles are rejected. Only analyze repositories you intend to inspect.

## Flagsmith setup and live proof

```powershell
npm.cmd run flagsmith:setup
npm.cmd run flagsmith:probe -- --repo Harsh16Bhardwaj/releasepilot
# With Bite running, verify actual app assignments and active-session recovery:
npm.cmd run flagsmith:verify-app
```

Provisioning creates a separate Free organisation/project, leaving existing projects untouched. Generated SDK/environment settings stay in ignored `.runtime/flagsmith/connection.env`; nonempty local environment settings take precedence. The management endpoint is `api.flagsmith.com`, and the SDK defaults to `edge.api.flagsmith.com`. Separate endpoints matter: the management-host evaluation document lagged during testing. Cloud v2 override creation uses numeric environment IDs and typed values. Setup reruns preserve existing targets and refuse publishing a missing override for a nonzero segment.

The app integration proof temporarily changes the dedicated `menu_redesign` segment from 0% to 50% and restores it in `finally`. It sends 200 actual HTTP sessions with real Flagsmith assignments; those visitors remain clearly simulated. Recovery is journalled in `.runtime/flagsmith/app-probe-recovery.json`; use `npm.cmd run flagsmith:verify-app -- --restore` if interrupted. Unexpected drift stops restoration for inspection. This proves configuration/app recovery, not an approved autonomous release.

Bite checks treatment sessions against the locally evaluated flag on requests and ends a session if it is no longer eligible. The visible page checks every five seconds, then refreshes after a confirmed change. SDK polling defaults to 15 seconds (about 23040 reads over four days for one running app). Recovery is verified after propagation, never claimed instantaneous. Session events retain their original variant; refresh creates a new session.

Use a dedicated disposable project/environment. **Flagsmith Cloud Free is now the selected path**; self-hosting remains a fallback. Cloud uses `FLAGSMITH_MANAGEMENT_URL=https://api.flagsmith.com/api/v1/`; self-hosting uses `http://localhost:8000/api/v1/`. Do not add a card, enable overages or upgrade to unblock this project. Organisation API keys use `FLAGSMITH_AUTH_SCHEME=Api-Key`; user API tokens use `Token`. Both stay in local `.env`. A separate **server-side SDK key** is needed for local evaluation and can be provisioned through authorized account setup. Management/environment/SDK keys are distinct. Never commit them.

1. Create a disabled test feature named `releasepilot_probe` (or configure `FLAGSMITH_PROBE_FLAG`).
2. In that feature's target environment create a **feature-specific segment** with exactly one Percentage Split condition, no other conditions, and an enabled override for this feature. Start at 0%.
3. Configure API base URL, project ID, environment key, server-side SDK key, probe segment ID and test feature in `.env`.
4. Set `FLAGSMITH_PROBE_DISPOSABLE=true` only for this test scope. This is explicit authorization for the probe's 5/25/50/100% changes and restoration, not for future releases.
5. Run `flagsmith:probe`. It saves original rules and SDK identity results; changes the same segment; reads back each change; evaluates 1,000 fixed identities locally using the official SDK; checks nested cohorts; restores the original rules and verifies recovery. Local evaluation avoids 1,000 remote evaluation calls per stage.

The adapter supports only this simple feature-specific split. Conflicting overrides, dependencies or unsupported evaluation behaviour should fail the proof, not be silently corrected. The probe makes no feature creation, deletion, deployment or PR mutation requests.

If interrupted or restoration is unresolved:

```powershell
npm run flagsmith:probe -- --repo owner/repository --restore
```

Keep the original `.env` scope. Inspect `.runtime/<owner>/<repository>/probe-recovery.json` if restoration is refused. Unexpected remote rule drift requires manual review; don't overwrite it blindly. After repairing access, repeat restoration and the full probe. Do not delete the runtime database to erase unresolved work.

## Instructions, memory and separation

`agent-workspace/AGENTS.md` and its `.agents/skills/` files define the agent. Context is assembled from GitHub data for every fresh Codex call and supplied through stdin. JSON Schema plus evidence checks reject fabricated paths, line numbers and stale SHA results. SQLite holds commit-bound profiles, previous analyses, failed jobs, probe snapshots and proofs. Reports are readable exports, not approval or executable memory.

Codex runs locally with the current ChatGPT login, an ephemeral read-only session and ignored user config; the child environment excludes API billing keys and integration credentials. The trusted prompt explicitly forbids repository code/tool execution. Read-only sandboxing is not a complete defense against malicious repository text: no supplied repository is trusted as instructions, and broader untrusted-repository support requires additional sandbox/tool-denial verification. No auth files are copied or exported. Do not move local ChatGPT credentials into public CI.

The Flagsmith API adapter is separate from AI analysis. Credentials are never added to context. Known environment secrets and common token patterns are redacted before reports/prompts; this is defense in depth, not a guarantee that arbitrary secret formats in source are detectable.

## Verification and status

```powershell
npm run check
npm test
```

Tests exercise revision/evidence validation, credential exclusion, targeting transforms, SQLite deduplication, worker ownership, concurrent API retries, order pricing, late-session events and React search/cart/checkout against the real HTTP backend. DOM interaction tests use jsdom; they do not establish visual browser QA. These do **not** replace live Flagsmith proofs. Runtime reports expire after 24 hours for gate purposes. See `docs/SPRINTS.md` for subsequent requirements.

Configuration failure exits nonzero with a repair hint. Codex limits/unavailability produce a persisted failed analysis; no fabricated or cached result is presented as new. Stop foreground commands with Ctrl+C; after a write-probe interruption, run restoration before another probe.

Official references: [Codex automation](https://learn.chatgpt.com/docs/non-interactive-mode), [Flagsmith SDK](https://docs.flagsmith.com/integrating-with-flagsmith/sdks/server-side), [management authentication](https://docs.flagsmith.com/integrating-with-flagsmith/flagsmith-api-overview/management-api/authentication), [targeting segments](https://docs.flagsmith.com/flagsmith-concepts/segments).
