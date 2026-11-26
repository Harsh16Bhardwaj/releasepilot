import { spawnSync } from "node:child_process";

/** Use existing local GitHub authentication; never serialize this return value. */
export function githubCredential(): string {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const r = spawnSync("git", ["credential", "fill"], {
    input: "protocol=https\nhost=github.com\n\n",
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
    env: { ...process.env, GCM_INTERACTIVE: "never", GIT_TERMINAL_PROMPT: "0" },
  });
  if (r.status !== 0) return "";
  const line = r.stdout.split(/\r?\n/).find((l) => l.startsWith("password="));
  return line?.slice("password=".length) || "";
}
