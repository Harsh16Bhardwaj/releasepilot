import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { GitHub } from "../src/github.js";
import { config } from "../src/config.js";
import { FlagsmithManagement } from "../src/flagsmith.js";

test("GitHub context permits credential-helper source but excludes actual credential files", async () => {
  const client = new GitHub("owner/repo");
  let calls = 0;
  client.get = async () => {
    calls++;
    return {
      type: "file",
      encoding: "base64",
      size: 15,
      content: Buffer.from("export const x=1;").toString("base64"),
    };
  };
  await client.file("src/credentials.ts", "sha");
  await client.file(".env.example", "sha");
  assert.equal(calls, 2);
  for (const path of [
    ".env",
    "auth.json",
    "credentials.json",
    "credentials",
    "nested/private.key",
  ])
    await assert.rejects(() => client.file(path, "sha"), /Credential-like/);
  assert.equal(calls, 2);
});
test("Management adapter uses configured token scheme, rejects foreign URLs and redacts API failures", async () => {
  const key = "unit-test-secret-only",
    cfg = config({ FLAGSMITH_API_KEY: key, FLAGSMITH_AUTH_SCHEME: "Token" });
  const api = new FlagsmithManagement(cfg);
  let authorization = "";
  const replacement = mock.method(
    globalThis,
    "fetch",
    async (_url: any, options: any) => {
      authorization = options.headers.Authorization;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  );
  try {
    await api.request("organisations/");
    assert.equal(authorization, `Token ${key}`);
    await assert.rejects(
      () => api.request("https://example.com/steal"),
      /inside/,
    );
    await assert.rejects(() => api.request("../steal"), /inside/);
    replacement.mock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ detail: key }), { status: 403 }),
    );
    await assert.rejects(
      () => api.request("organisations/"),
      (e) => String(e).includes("403") && !String(e).includes(key),
    );
  } finally {
    replacement.mock.restore();
  }
});
