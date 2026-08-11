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
  reporter: [["list"]],
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
