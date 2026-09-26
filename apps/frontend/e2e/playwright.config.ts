import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end suite for the LibrePhotos web app.
 *
 * It runs against a live stack: by default the proxy from
 * deploy/compose/docker-compose.e2e.yml on http://localhost:8080. Point
 * E2E_BASE_URL at any other frontend (for example a native Vite dev server
 * that proxies /api and /media to a native backend) to run it there.
 *
 * The specs share one backend and one user, so they run serially.
 */
const isCI = !!process.env.CI;

export const STORAGE_STATE = ".auth/admin.json";

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: isCI ? [["github"], ["list"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8080",
    // The UI picks its language from the browser; pin it so text selectors are stable.
    locale: "en-US",
    timezoneId: "UTC",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
      dependencies: ["setup"],
    },
  ],
});
