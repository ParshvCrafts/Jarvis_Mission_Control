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
    },
  },
});
