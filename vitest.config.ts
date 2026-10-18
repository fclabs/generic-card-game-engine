import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "games/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "tools/guardrails/**"],
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
    },
  },
});
