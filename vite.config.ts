import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
export default defineConfig({
  root: resolve(import.meta.dirname, "apps/bite"),
  plugins: [
    react(),
    {
      name: "bite-build-identity",
      generateBundle() {
        let commit = "uncommitted",
          dirty = true;
        try {
          commit = execFileSync("git", ["rev-parse", "HEAD"], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
          }).trim();
          dirty = !!execFileSync("git", ["status", "--porcelain"], {
            encoding: "utf8",
          }).trim();
        } catch {}
        this.emitFile({
          type: "asset",
          fileName: "build.json",
          source: JSON.stringify({
            commit,
            dirty,
            mode: "production",
            builtAt: new Date().toISOString(),
          }),
        });
      },
    },
  ],
  build: {
    outDir: resolve(import.meta.dirname, "dist/bite"),
    emptyOutDir: true,
  },
  server: { host: "127.0.0.1", allowedHosts: ["localhost", "127.0.0.1"] },
});
