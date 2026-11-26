ReleasePilot can now provision its own isolated Flagsmith Cloud Free organisation and demo environment without altering existing projects. Setup creates disabled probe/menu flags, feature-specific percentage segments and a local-evaluation SDK key, with generated credentials kept in ignored runtime configuration.

The management and SDK endpoints are separate: writes use the management API, while application identity verification uses the SDK's Edge API. The adapter supports user-token authentication, current v2 feature-version overrides, read-back verification and snapshot restoration. Setup reruns reuse existing resources instead of resetting live targeting.

GitHub discovery reuses local Credential Manager authentication, keeping the credential out of Codex subprocesses. Live proof results are recorded separately from unit tests; rollout approval and deployment gates remain required. No PR is automatically merged.

Validation: TypeScript and the local test suite; actual Cloud provisioning; percentage/identity/read-back/restoration probe. Runtime evidence is local and contains no credentials in this PR.
