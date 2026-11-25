---
name: pr-analysis
description: Classify a PR's release impact and identify feature flags and fallback paths from supplied source evidence.
---

Inspect every supplied changed-file patch and relevant head file. If context is incomplete, block rather than claim complete review. Distinguish no_release_needed, progressive_rollout, needs_flag and blocked. A flag mention alone does not prove safe gating: locate both branches and the fallback. Evidence must quote an exact head-revision line. Explain affected users without invented usage numbers. Output the analysis schema with uncertainties and release notes.
