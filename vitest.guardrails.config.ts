import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tools/guardrails/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "tools/guardrails/fixtures/**",
    ],
  },
});
