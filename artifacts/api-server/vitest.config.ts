import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
    globals: false,
    // Run tests serially to avoid DB race conditions between integration test files
    pool: "forks",
    singleFork: true,
    fileParallelism: false,
    env: {
      NODE_ENV: "test",
      // Test-only auth bypass (was a shared workspace env var — review M6).
      // security.test.ts deletes it per-test to exercise the 401/403 matrix.
      DEV_SKIP_AUTH: "true",
      // The owner check now fails closed (review M2), so the dev-user
      // bypass must BE the configured owner for ordinary tests to pass.
      OWNER_USER_ID: "dev-user",
    },
  },
});
