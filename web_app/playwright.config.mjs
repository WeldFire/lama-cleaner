import process from "node:process"

import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./tests",
  testMatch: ["frame-editing.spec.mjs", "frame-editing.docker.spec.mjs"],
  outputDir: "../.scratch/playwright-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: process.env.GITHUB_ACTIONS ? [["github"], ["list"]] : [["list"]],
  webServer: process.env.FRAME_EDIT_E2E_START_SERVER
    ? {
        command: "npm run dev -- --host 127.0.0.1 --port 8088",
        url: "http://127.0.0.1:8088",
        reuseExistingServer: true,
        timeout: 120_000,
      }
    : undefined,
  use: {
    actionTimeout: 8_000,
    baseURL: process.env.FRAME_EDIT_E2E_BASE_URL || "http://127.0.0.1:8088",
    browserName: "chromium",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
    headless: true,
    acceptDownloads: true,
    viewport: { width: 1440, height: 900 },
  },
})
