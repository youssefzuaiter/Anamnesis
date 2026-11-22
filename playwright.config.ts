import { defineConfig, devices } from "@playwright/test";
import "dotenv/config";

const PORT = 3100;

/**
 * Runs against the ordinary dev server and the ordinary database — this app
 * has one deployment and no test environment, so the suite creates its own
 * throwaway account per run and deletes it in teardown rather than pretending
 * to be isolated.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  // Serial: every spec drives the same account, and a shared workspace is the
  // thing being tested. Parallel workers would race each other's fixtures.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? "list" : [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    storageState: "tests/e2e/.auth/state.json",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "pnpm dev",
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: true,
    timeout: 120_000,
    // The pasted-post spec must not depend on whether a model is running: rules read the post.
    env: { POST_INTAKE_ENGINE: "code" },
  },
});
