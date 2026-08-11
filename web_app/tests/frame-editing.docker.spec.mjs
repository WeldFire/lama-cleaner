import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

import { expect, test } from "@playwright/test"

const runDockerQualification = process.env.FRAME_EDIT_E2E_REAL_DOCKER === "1"
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
let fixtureDirectory
let videoBytes

test.beforeAll(() => {
  if (!runDockerQualification) return
  fixtureDirectory = mkdtempSync(join(tmpdir(), "iopaint-frame-docker-e2e-"))
  const videoPath = join(fixtureDirectory, "docker-phase1.webm")
  execFileSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc2=size=64x48:rate=4:duration=1",
    "-an", "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", videoPath,
  ])
  videoBytes = readFileSync(videoPath)
})

test.afterAll(() => {
  if (fixtureDirectory) rmSync(fixtureDirectory, { recursive: true, force: true })
})

test("@docker project data and a Frame Edit survive an application restart", async ({ page }) => {
  test.skip(!runDockerQualification, "Set FRAME_EDIT_E2E_REAL_DOCKER=1 to restart and qualify the real Docker backend")
  test.setTimeout(120_000)
  await page.route("**/socket.io/**", (route) => route.abort())
  await page.goto("/", { waitUntil: "domcontentloaded" })

  await page.getByLabel("Click here or drag an image").setInputFiles({
    name: "docker-phase1.webm",
    mimeType: "video/webm",
    buffer: videoBytes,
  })
  await expect(page.getByRole("button", { name: "Edit frame" })).toBeVisible({ timeout: 30_000 })
  const projectName = `Docker qualification ${Date.now()}`
  await page.getByRole("button", { name: "Untitled video project" }).click()
  await page.getByRole("textbox", { name: "Project name" }).fill(projectName)
  await page.getByRole("button", { name: "Save project name" }).click()
  await page.getByLabel("Next exact frame").click()
  await page.getByRole("button", { name: "Edit frame" }).click()
  await expect.poll(() => page.locator("canvas").last().evaluate((canvas) => canvas.width)).toBe(64)
  await page.getByRole("button", { name: "Save & return" }).click()
  await expect(page.getByLabel("Open saved edit for frame 2")).toBeVisible()

  execFileSync("docker", ["compose", "restart", "app"], { cwd: repositoryRoot, stdio: "pipe" })
  await expect.poll(async () => {
    const response = await page.request.get("/api/v1/projects")
    return response.ok()
  }, { timeout: 45_000 }).toBe(true)
  await page.reload({ waitUntil: "domcontentloaded" })
  await expect(page.getByRole("button", { name: projectName, exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByLabel("Open saved edit for frame 2")).toBeVisible()

  await page.getByRole("button", { name: "Delete project" }).click()
  await page.getByRole("button", { name: "Delete project", exact: true }).click()
  await expect(page.getByLabel("Recent video projects")).toBeVisible()
  await expect(page.getByText(projectName)).toBeHidden()
})
