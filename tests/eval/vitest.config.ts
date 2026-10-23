// Separate config: the agent eval calls a real LLM and is never part of `npm test`.
// Run: npx vitest run --config tests/eval/vitest.config.ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("../../", import.meta.url)) } },
  test: {
    environment: "node",
    root: fileURLToPath(new URL("../../", import.meta.url)),
    include: ["tests/eval/**/*.eval.ts"],
    testTimeout: 180_000,
    hookTimeout: 60_000,
  },
});
