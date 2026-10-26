import { defineConfig } from "vitest/config";

// モックサイトに対する E2E (CLI を子プロセスで実行するので時間がかかる)。npm run test:e2e
export default defineConfig({
  test: {
    include: ["test/e2e/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
