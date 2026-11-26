import { redact, repository } from "./config.js";

export class GitHub {
  constructor(
    readonly repo: string,
    private token = "",
  ) {
    repository(repo);
  }
  async get(path: string): Promise<any> {
    if (
      path !== `/repos/${this.repo}` &&
      !path.startsWith(`/repos/${this.repo}/`)
    )
      throw new Error("Cross-repository request rejected");
    const response = await fetch(`https://api.github.com${path}`, {
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
      headers: {
        "User-Agent": "ReleasePilot/0.1",
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
    });
    if (!response.ok)
      throw new Error(
        `GitHub HTTP ${response.status}; remaining=${response.headers.get("x-ratelimit-remaining") ?? "unknown"}; reset=${response.headers.get("x-ratelimit-reset") ?? "unknown"}. Check token/repository or wait for rate-limit reset.`,
      );
    return response.json();
  }
  async listPRs() {
    return this.get(
      `/repos/${this.repo}/pulls?state=open&per_page=100&sort=updated&direction=desc`,
    );
  }
  async file(path: string, sha: string) {
    if (
      path !== ".env.example" &&
      /(^|\/)(\.env(?:\..*)?|auth\.json|credentials(?:\.(?:json|ya?ml|toml|ini|txt))?|[^/]*\.(?:pem|key|p12))$/i.test(
        path,
      )
    )
      throw new Error("Credential-like file excluded");
    const result = await this.get(
      `/repos/${this.repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(sha)}`,
    );
    if (
      result.type !== "file" ||
      result.encoding !== "base64" ||
      result.size > 100_000
    )
      throw new Error("Unsupported or oversized context file");
    const content = Buffer.from(result.content, "base64").toString("utf8");
    if (content.includes("\0")) throw new Error("Binary context file excluded");
    return { path, sha, content: redact(content) };
  }
  async profile() {
    const meta = await this.get(`/repos/${this.repo}`);
    const commit = await this.get(
      `/repos/${this.repo}/commits/${encodeURIComponent(meta.default_branch)}`,
    );
    const tree = await this.get(
      `/repos/${this.repo}/git/trees/${commit.sha}?recursive=1`,
    );
    const candidates = [
      "README.md",
      "package.json",
      "pyproject.toml",
      "docker-compose.yml",
    ];
    const paths = new Set<string>(
      tree.tree.filter((x: any) => x.type === "blob").map((x: any) => x.path),
    );
    const files = [];
    for (const path of candidates.filter((p) => paths.has(p)))
      files.push(await this.file(path, commit.sha));
    return {
      repository: this.repo,
      commit: commit.sha,
      defaultBranch: meta.default_branch,
      treeTruncated: !!tree.truncated,
      paths: [...paths].slice(0, 10_000),
      files,
      observedAt: new Date().toISOString(),
      unknowns: [
        "Application routes, flag mapping, metrics and deployment must be established from source/configuration.",
      ],
    };
  }
  async bundle(number: number) {
    if (!Number.isSafeInteger(number) || number < 1)
      throw new Error("Invalid PR number");
    const pr = await this.get(`/repos/${this.repo}/pulls/${number}`);
    if (pr.changed_files > 40)
      throw new Error(
        "PR exceeds supported 40-file analysis limit; manual review required.",
      );
    const changes = await this.get(
      `/repos/${this.repo}/pulls/${number}/files?per_page=100`,
    );
    if (changes.length !== pr.changed_files)
      throw new Error("Incomplete PR file list; analysis blocked.");
    const files: {path:string;status:string;patch:string;head:{path:string;sha:string;content:string}|null}[] = [];
    for (const change of changes) {
      if (!change.patch)
        throw new Error(
          `Missing/truncated/binary diff: ${change.filename}; manual review required.`,
        );
      const head =
        change.status === "removed"
          ? null
          : await this.file(change.filename, pr.head.sha);
      files.push({
        path: change.filename,
        status: change.status,
        patch: redact(change.patch),
        head,
      });
    }
    const profile = await this.profile();
    const result = {
      repository: this.repo,
      pr: number,
      title: redact(pr.title),
      description: redact(pr.body || ""),
      baseSha: pr.base.sha,
      headSha: pr.head.sha,
      merged: pr.merged,
      mergeSha: pr.merge_commit_sha,
      profile: {
        ...profile,
        files: profile.files.filter(
          (f) => !files.some((changed) => changed.path === f.path),
        ),
        paths: profile.paths.slice(0, 300),
        pathInventoryLimited: profile.paths.length > 300,
      },
      files,
      flags: [],
      policy: {
        stages: [5, 25, 50, 100],
        observeSeconds: 30,
        minSessions: 50,
        maxWaitSeconds: 120,
      },
      unknowns: [
        "No Flagsmith inventory supplied to this analysis until live connection is configured.",
      ],
    };
    const bytes = Buffer.byteLength(JSON.stringify(result), "utf8");
    if (bytes > 320_000)
      throw new Error(
        `Context is ${bytes} bytes, above the 320KB supported budget; manual review required.`,
      );
    return result;
  }
}
