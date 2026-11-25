# ReleasePilot

A local release agent for Flagsmith, with **Bite**, a working food-ordering website for testing interface releases. Sprint 1 agent foundations and independent Sprint 2 website work are implemented. Flagsmith's live proof and the autonomous rollout loop remain pending.

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

## Start from a fresh checkout (Windows / Node >=22.13)

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

Use a real public PR with <=40 changed text files and <=180KB context. GitHub's anonymous rate limit is small; optionally configure a read-only token. The analysis command reads metadata, diff and changed head files plus selected root documents. It rejects missing/binary patches and oversized bundles rather than inventing findings. Only analyze repositories you intend to inspect.

## Flagsmith setup and live proof

Use a dedicated disposable project/environment. **Self-hosted Flagsmith is now the owner's preferred setup**, with free Cloud as a fallback. For self-hosting set `FLAGSMITH_MANAGEMENT_URL=http://localhost:8000/api/v1/`. Do not add a card, enable overages or upgrade to unblock this project. Create the organization API key through the local dashboard and a **server-side SDK key** for local evaluation. Organization/environment keys are distinct. Never commit them.

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
