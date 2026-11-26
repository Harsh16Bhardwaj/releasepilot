import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { githubCredential } from "../src/credentials.js";
const { values } = parseArgs({
  options: {
    repo: { type: "string" },
    head: { type: "string" },
    title: { type: "string" },
    body: { type: "string" },
  },
});
if (!values.repo || !values.head || !values.title || !values.body)
  throw new Error("Pass --repo --head --title --body FILE");
if (!/^[\w.-]+\/[\w.-]+$/.test(values.repo))
  throw new Error("Invalid repository");
const token = githubCredential();
if (!token) throw new Error("GitHub local authentication is unavailable");
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "ReleasePilot",
  "Content-Type": "application/json",
};
const existing = await fetch(
  `https://api.github.com/repos/${values.repo}/pulls?state=open&head=${encodeURIComponent(values.repo.split("/")[0] + ":" + values.head)}`,
  { headers, redirect: "error" },
);
if (!existing.ok) throw new Error(`GitHub lookup HTTP ${existing.status}`);
const prs = (await existing.json()) as any[];
if (prs.length) {
  console.log(
    JSON.stringify({
      number: prs[0].number,
      url: prs[0].html_url,
      reused: true,
    }),
  );
} else {
  const r = await fetch(`https://api.github.com/repos/${values.repo}/pulls`, {
    method: "POST",
    headers,
    redirect: "error",
    body: JSON.stringify({
      base: "main",
      head: values.head,
      title: values.title,
      body: readFileSync(values.body, "utf8"),
    }),
  });
  if (!r.ok) throw new Error(`GitHub create PR HTTP ${r.status}`);
  const p = (await r.json()) as any;
  console.log(JSON.stringify({ number: p.number, url: p.html_url }));
}
