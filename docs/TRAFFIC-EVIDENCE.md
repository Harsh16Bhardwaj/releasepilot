# Traffic Lab — 26 November 2026

Independent work authorized while Docker remains unavailable. This is not a completed live Flagsmith or autonomous-release gate.

## Implemented

- Separate local simulator service on port 3200, with persistent run history, one active run, cancellation and interrupted-run recovery.
- Standalone command and `/lab` comparison UI served by Bite. The UI controls the separate service through a bounded local proxy.
- Seeded visitor identities and healthy/neutral/degraded behaviour. Identical seed/scenario/version repeats interaction choices; HTTP latency is measured and not deterministic.
- Actual requests to session/menu/events/session-end endpoints. Application-assigned version, preview and simulation labels are stored on each session. Explicit synthetic session completion avoids fabricating time acceleration.
- Read-only metrics with time/run/build/release/stage filters, default preview exclusion, unique completed-session conversions, bounce and checkout rates, measured request P95 and 5xx rates.
- Missing, collecting and single-cohort states; source eligibility, freshness and frozen historical windows. No automatic advance/rollback decisions yet.
- Additive migrations preserve existing Bite sessions. No database deletion or destructive schema reset.

## Verified

TypeScript, production build and 19 tests pass. Tests include a 20-session real local HTTP comparison run, stable seed behaviour, unchanged control behaviour across scenarios, preview/run isolation, late-event rejection, session-based denominators, snapshot freezing/freshness, concurrent start rejection, stop and actual hard-kill/restart recovery.

The local run service is tested independently of the evaluator. The metrics endpoint receives observed events and scope identifiers, not scenario probabilities or precomputed outcome numbers.

Live local smoke verification (`npm.cmd run traffic:verify`) completed two 160-session runs, 80 sessions per page, with zero failed visitors. With seed 42 the control cart rate was 48.75% in both runs; healthy redesign was 67.5% (+18.75 percentage points), degraded redesign was 6.25% (-42.5 points). Both windows froze and remained ineligible for rollout decisions. These are generated scenario outcomes, not evidence of real user preference. Run IDs and exact timestamps are retained locally in `.runtime/traffic/smoke-latest.json` and the lab history.

## Limits

Docker was not found on PATH or the checked standard installation paths. No live Flagsmith environment was created or mutated. Comparison mode explicitly bypasses assignment; Flagsmith mode safely remains original-only until connected. Browser-driven load and screenshot QA are still pending because local browser automation is disabled in Work settings. Traffic is HTTP simulation, not demonstrated human engagement.

Release IDs/stage IDs are reserved persisted fields with filters; the pending approved release engine must populate them. Metrics are snapshots of completed sessions and request observations; this is a hackathon-scale local service, not a production statistical decision system.
