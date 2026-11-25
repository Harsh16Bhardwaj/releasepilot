// Read credentials into process memory only. Never print/store the credential response.
import { spawnSync } from "node:child_process";
const created = process.argv.includes("--create");
const result = spawnSync("git", ["credential", "fill"], {
  input: "protocol=https\nhost=github.com\n\n",
  encoding: "utf8",
  env: { ...process.env, GCM_INTERACTIVE: "never", GIT_TERMINAL_PROMPT: "0" },
  windowsHide: true,
});
if (result.status !== 0) {
  console.error(
    "GitHub authentication is unavailable. Sign in using Git Credential Manager; no password/token should be shared in chat.",
  );
  process.exit(2);
}
const credentials = Object.fromEntries(
  result.stdout
    .trim()
    .split(/\r?\n/)
    .map((x) => {
      const i = x.indexOf("=");
      return [x.slice(0, i), x.slice(i + 1)];
    }),
);
const token = credentials.password;
if (!token) {
  console.error("No saved GitHub credential.");
  process.exit(2);
}
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "ReleasePilot-setup",
  "X-GitHub-Api-Version": "2022-11-28",
};
try {
  const userResponse = await fetch("https://api.github.com/user", {
    headers,
    redirect: "error",
  });
  if (!userResponse.ok)
    throw new Error(`GitHub auth HTTP ${userResponse.status}`);
  const user = (await userResponse.json()) as any;
  const name = "releasepilot";
  const existing = await fetch(
    `https://api.github.com/repos/${user.login}/${name}`,
    { headers, redirect: "error" },
  );
  console.log(
    JSON.stringify({
      account: user.login,
      repository: `${user.login}/${name}`,
      exists: existing.ok,
    }),
  );
  if (!created) process.exit();
  if (existing.status === 404) {
    const response = await fetch("https://api.github.com/user/repos", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        description:
          "Human-approved progressive releases with Flagsmith, plus Bite: a local food-ordering demo.",
        private: false,
        auto_init: false,
      }),
      redirect: "error",
    });
    if (!response.ok)
      throw new Error(`Repository creation HTTP ${response.status}`);
    const repo = (await response.json()) as any;
    console.log(JSON.stringify({ created: repo.html_url }));
  } else if (!existing.ok)
    throw new Error(`Repository lookup HTTP ${existing.status}`);
  else console.log("Existing repository retained; no files overwritten.");
} catch (e) {
  console.error(e instanceof Error ? e.message : "GitHub setup failed");
  process.exitCode = 1;
}
