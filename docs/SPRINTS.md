# Sprint gates and implementation handoff

26 November Cloud milestone: isolated Cloud Free provisioning, SDK/management targeting proof and restoration passed. Fresh Codex analysis of this repository's PR #1 passed schema/evidence validation; its classification was blocked/manual because infrastructure changes are not safely covered by the menu flag. The foundation gate checks the current remote PR head before passing. Real Bite assignment and active-session recovery also passed; browser screenshot QA remains unavailable. Sprint 4's approved autonomous controller is not yet implemented or passed. This supersedes the initial pending Cloud status below.

Status: Sprint 1 foundation delivered; Flagsmith live gate remains pending. Owner authorized independent repository/site work while Docker downloads on 25 November 2026. Bite is implemented and locally verified, but its Flagsmith/browser integration gate is not marked passed. Evaluate live gate with `npm run gate -- --repo owner/repository`.

26 November continuation: independent Sprint 3 implementation now includes separate Traffic Lab, run controls/history, seeded HTTP visitors, scoped metrics and a local comparison board at `/lab`. These do not pass the blocked live Flagsmith gate. Browser-level simulation and full release orchestration remain pending.

| Sprint | Deliverable | Gate |
|---|---|---|
| 1 | Trusted agent workspace, SQLite records, discovery, Codex analysis, Flagsmith probe, diagnostics | Fresh real PR/AI proof and Flagsmith mutation/read-back/cohort/restore proof in the same configured scope |
| 2 | Bite food app, original and redesign branch, session events, build identity | Browser events persisted once with correct flag/build attribution |
| 3 | Seeded traffic simulator and completed-session metrics | Reproducible control/treatment behaviour; missing data recognized |
| 4 | Poller, approval, deployment gate, Flagsmith state machine | Real PR through approved progression and independently triggered verified rollback |
| 5 | Dashboard, restart/reconciliation, incident tools, clean setup | All negative scenarios and fresh-start acceptance pass |

## Sprint 1 evidence

The runtime directory is `.runtime/<owner>/<repository>/`. `pilot.sqlite` is authoritative. JSON reports are exports. Gate evidence expires after 24 hours. Flagsmith proofs are bound to a hash of the environment, SDK key, API origin, project, segment and feature. Do not edit gate artifacts to bypass checks.

## Subsequent implementation contract

The release service will be the only SQLite writer for operational events; collect through a queue with transactions and event-ID uniqueness. One durable worker lock owns each repo; only one configured environment/flag release can run. Changes in approval scope invalidate authorization. Persist action intent before every mutation, read back on ambiguous outcomes, and hold after restart until reconciliation is reviewed.

Events require event ID, session ID, timestamp, actual served version, deployment, release and stage. Complete sessions after 30s inactivity, retain original stage attribution and freeze finalized metric windows. Defaults: 5/25/50/100 percent, >=30s and >=50 completed sessions per available group, hold after 120s. Product breach is >=15 percentage-point cart-rate loss in two consecutive nonoverlapping qualified windows; technical breach is >5% errors after >=50 treatment requests. Missing/stale data holds. 100% uses a frozen baseline. These are demo rules, not statistical guarantees.

The AI proposes. Deterministic code approves nothing on the human's behalf. Human approval binds repo/PR/SHA/environment/flag/plan and separately permits progression and rollback. Verify merged build before starting. SDK propagation must be observed. Rollback restores a captured state and invalidates application session caches on the rollback revision; already rendered content updates on the next check.

Use actual generated HTTP/browser events, prominently labelled simulated. Traffic scenario controls stay separate from the evaluator. GitHub polling uses 15s intervals, conditional requests, pagination and bounded backoff; handlers are application events, not git hooks. Dashboard streams persisted service state and reloads on reconnect. No automatic PR merge/code changes, paid services or silent replay fallback.

Sprint 1 currently limits PR analysis to <=40 changed text files and <=180KB context. Unsupported changes block honestly. Continuous watching, approvals and release progression are not implemented yet. Bite now includes comparison previews, local sessions/events/orders, request measurements and frozen metric windows; actual release/stage attribution and rollback cache invalidation await the release engine. Discovery is an inventory, not a complete architecture understanding. Source context contains changed head files and selected root documentation; deeper dependency retrieval belongs to repository-context improvements before broad repository support.
