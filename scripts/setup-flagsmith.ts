import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config, root } from "../src/config.js";
import { FlagsmithManagement } from "../src/flagsmith.js";

// Provisioning owns its generated connection file. Credentials never leave process memory/local config.
const cfg = config();
if (!cfg.flagsmith.apiKey)
  throw new Error("Configure a management credential in local .env first");
const api = new FlagsmithManagement(cfg);
const rows = (r: any): any[] => (Array.isArray(r) ? r : (r.results ?? []));
async function all(path: string) {
  const result = [];
  for (let page = 1; page <= 20; page++) {
    const response = await api.request(
      path + (path.includes("?") ? "&" : "?") + "page=" + page,
    );
    result.push(...rows(response));
    if (Array.isArray(response) || !response.next) return result;
  }
  throw new Error("Provisioning list exceeds supported size");
}
let organisations = await all("organisations/");
let org = organisations.find((o) => o.name === "ReleasePilot");
if (!org)
  org = await api.request("organisations/", "POST", { name: "ReleasePilot" });
org = await api.request(`organisations/${org.id}/`);
if (org.subscription?.plan !== "free")
  throw new Error(
    "ReleasePilot provisioning requires a verified Free organisation; no billing changes will be made",
  );
console.log(
  JSON.stringify({
    step: "organisation",
    id: org.id,
    name: org.name,
    plan: "free",
  }),
);
const projects = await all("projects/");
let project = projects.find(
  (p) => p.name === "ReleasePilot" && p.organisation === org.id,
);
if (!project)
  project = await api.request("projects/", "POST", {
    name: "ReleasePilot",
    organisation: org.id,
  });
console.log(
  JSON.stringify({ step: "project", id: project.id, name: project.name }),
);
const environments = await all(`environments/?project=${project.id}`);
let env = environments.find((e) => e.name === "ReleasePilot Demo");
if (!env)
  env = await api.request("environments/", "POST", {
    name: "ReleasePilot Demo",
    project: project.id,
  });
if (!env.api_key)
  throw new Error("Environment response did not contain its configuration key");
const keys = await all(`environments/${env.api_key}/api-keys/`);
let sdk = keys.find(
  (k) =>
    k.name === "ReleasePilot local evaluation" && k.active && !k.expires_at,
);
if (!sdk)
  sdk = await api.request(`environments/${env.api_key}/api-keys/`, "POST", {
    name: "ReleasePilot local evaluation",
    active: true,
  });
if (!sdk.key)
  throw new Error("SDK key unavailable; configuration remains incomplete");
const segments: Record<string, number> = {};
for (const name of ["releasepilot_probe", "menu_redesign"]) {
  const features = await all(`projects/${project.id}/features/`);
  let feature = features.find((f) => f.name === name);
  if (!feature)
    feature = await api.request(`projects/${project.id}/features/`, "POST", {
      name,
      description:
        "ReleasePilot isolated demonstration flag; disabled by default.",
      default_enabled: false,
      initial_value: null,
    });
  const existing = await all(
    `projects/${project.id}/segments/?include_feature_specific=true`,
  );
  const segmentName = `releasepilot_${name}_cohort`;
  let segment = existing.find(
    (s) => s.name === segmentName && s.feature === feature.id,
  );
  if (!segment)
    segment = await api.request(`projects/${project.id}/segments/`, "POST", {
      name: segmentName,
      description:
        "Dedicated ReleasePilot demo cohort. Controlled by approved demo operations only.",
      feature: feature.id,
      rules: [
        {
          type: "ALL",
          conditions: [
            {
              operator: "PERCENTAGE_SPLIT",
              property: "$.identity.identifier",
              value: "0",
            },
          ],
          rules: [],
        },
      ],
    });
  // Existing configuration is read, never silently reset on a rerun.
  const states = await all(
    `features/featurestates/?environment=${env.id}&feature=${feature.id}`,
  );
  for (const state of states)
    if (typeof state.feature_segment === "number")
      state.feature_segment = await api.request(
        `features/feature-segments/${state.feature_segment}/`,
      );
  const state = states.find(
    (s) =>
      s.feature_segment?.segment === segment.id ||
      s.feature_segment?.segment?.id === segment.id,
  );
  if (!state) {
    const override = {
      enabled: true,
      feature_state_value: { type: "unicode", string_value: "redesign" },
      feature_segment: { segment: segment.id, priority: 0 },
    };
    if (env.use_v2_feature_versioning)
      await api.request(
        `environments/${env.id}/features/${feature.id}/versions/`,
        "POST",
        {
          feature_states_to_create: [override],
          feature_states_to_update: [],
          segment_ids_to_delete_overrides: [],
          publish_immediately: true,
        },
      );
    else
      await api.request(
        `environments/${env.api_key}/features/${feature.id}/create-segment-override/`,
        "POST",
        { ...override, feature_state_value: null },
      );
  }
  segments[name] = segment.id;
  console.log(
    JSON.stringify({
      step: "flag",
      name,
      featureId: feature.id,
      segmentId: segment.id,
    }),
  );
}
const dir = join(root, ".runtime", "flagsmith");
mkdirSync(dir, { recursive: true });
const connection = {
  FLAGSMITH_PROJECT_ID: String(project.id),
  FLAGSMITH_ENVIRONMENT_KEY: env.api_key,
  FLAGSMITH_SDK_KEY: sdk.key,
  FLAGSMITH_PROBE_SEGMENT_ID: String(segments.releasepilot_probe),
  FLAGSMITH_ROLLOUT_SEGMENT_ID: String(segments.menu_redesign),
  BITE_DEPLOYMENT_URL: "http://127.0.0.1:3100/api/health",
  METRICS_URL: "http://127.0.0.1:3100/api/metrics",
};
writeFileSync(
  join(dir, "connection.env"),
  Object.entries(connection)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n") + "\n",
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    step: "complete",
    projectId: project.id,
    environmentName: env.name,
    connection: "Stored locally in ignored runtime configuration",
    liveProof: "Not yet run",
  }),
);
