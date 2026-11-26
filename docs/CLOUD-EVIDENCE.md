# Flagsmith Cloud integration — 26 November 2026

An isolated ReleasePilot organisation was created with subscription `free`, a separate project and `ReleasePilot Demo` environment. Existing projects were not modified. No billing, paid trial, card, overage or subscription changes were requested. Generated server SDK/environment credentials remain local in ignored runtime configuration.

The environment uses v2 feature versioning. Segment overrides are published through the numeric environment feature-version API, with typed `unicode` values. Existing override detection uses the full feature-state endpoint so setup reruns do not create duplicates or reset percentages. A missing override on a nonzero segment is refused.

## Live configuration proof

`npm.cmd run flagsmith:probe -- --repo Harsh16Bhardwaj/releasepilot`

The dedicated flag progressed through 5/25/50/100 percent. Official SDK evaluation of 1000 fixed identities observed 62/235/487/1000 enabled identities. Earlier cohorts remained included. Every rule change was read back, the SDK rule matched the requested percentage, and the captured original state was restored and verified. Initial management-host SDK-document lag was diagnosed; Cloud SDK evaluation now uses its separate Edge endpoint and bounded propagation waits. Failed attempts were not recorded as passes.

## Real application proof

`npm.cmd run flagsmith:verify-app`

The isolated menu flag moved from 0% to 50%, then back to 0%. Two hundred simulated visitors sent real requests without preview headers. Actual SDK assignments yielded 93 original and 107 redesigned sessions, zero failed visitors. Metrics reported Flagsmith source and excluded previews. Original/redesign request P95s were approximately 2.71/2.90 ms in this one local run; these are observations, not production performance claims.

A retained treatment session was kept active during restoration. After propagation it ended with reason `flag_disabled`, a new original session was issued, and prior events retained their treatment variant. The artifact records `activeSessionRecovery: true`, `restored: true`, and `rolloutOrchestrationProof: false`.

Runtime evidence: `.runtime/harsh16bhardwaj/releasepilot/flagsmith-proof.json`, `.runtime/flagsmith/app-proof.json` and recovery journals. No credential values are included here.

## Agent and remaining gates

PR #1 contains the Cloud integration. A fresh ChatGPT-authenticated Codex session inspected its actual source and returned validated head-line evidence. It correctly blocked automatic rollout of infrastructure changes and identified prerequisites; that is analysis success, not release approval. Source fixes address credential-helper filename filtering, nonzero override adoption and active-session recovery. Revised PR heads require fresh analysis. No PR was automatically merged.

Human-approved rollout engine, deployment/merge verification, release/stage attribution, policy-driven progression and incident rollback remain Sprint 4 work. This controlled integration probe does not replace that live gate. Real-browser acceptance remains pending because Work disables local browser automation.
