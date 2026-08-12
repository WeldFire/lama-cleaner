import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
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

const composeOverride = join(repositoryRoot, "docker", "qualification-compose.yml")
const volumeSuffix = `${process.pid}-${Date.now()}`
const qualificationEnvironment = {
  ...process.env,
  TICKET27_MODELS_VOLUME: `iopaint-ticket27-models-${volumeSuffix}`,
  TICKET27_FRONTEND_VOLUME: `iopaint-ticket27-frontend-${volumeSuffix}`,
}

function compose(arguments_) {
  return execFileSync("docker", ["compose", "-f", "docker-compose.yml", "-f", composeOverride, ...arguments_], {
    cwd: repositoryRoot,
    env: qualificationEnvironment,
    stdio: "pipe",
  })
}

function copyVolume(source, destination) {
  execFileSync("docker", [
    "run", "--rm", "-v", `${source}:/source:ro`, "-v", `${destination}:/destination`,
    "node:20-slim", "sh", "-ec", "cp -a /source/. /destination/",
  ], { cwd: repositoryRoot, stdio: "pipe" })
}

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
  if (!runDockerQualification) return
  // Always restore the developer's ordinary Compose mounts, even after a
  // qualification assertion fails midway through service recreation.
  try {
    execFileSync("docker", ["compose", "up", "-d", "--force-recreate", "app", "frontend"], { cwd: repositoryRoot, stdio: "pipe" })
  } finally {
    for (const volume of [qualificationEnvironment.TICKET27_MODELS_VOLUME, qualificationEnvironment.TICKET27_FRONTEND_VOLUME]) {
      try {
        execFileSync("docker", ["volume", "rm", volume], { cwd: repositoryRoot, stdio: "pipe" })
      } catch {
        // A failed container teardown can leave a volume busy; it is uniquely
        // named and safe for a later Docker prune rather than hiding the result.
      }
    }
  }
})

test("@docker project data survives relink, service recreation, and auxiliary volume replacement", async ({ page }) => {
  test.skip(!runDockerQualification, "Set FRAME_EDIT_E2E_REAL_DOCKER=1 to restart and qualify the real Docker backend")
  test.setTimeout(120_000)
  await page.route("**/socket.io/**", (route) => route.abort())
  await expect.poll(async () => {
    try {
      return (await page.request.get("/api/v1/server-config")).ok()
    } catch {
      return false
    }
  }, { timeout: 45_000 }).toBe(true)
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
  const drawingCanvas = page.locator("canvas").last()
  const canvasBox = await drawingCanvas.boundingBox()
  if (!canvasBox) throw new Error("Editor canvas unavailable")
  await page.mouse.move(canvasBox.x + 20, canvasBox.y + 20)
  await page.mouse.down()
  await page.mouse.move(canvasBox.x + 30, canvasBox.y + 30)
  await page.mouse.up()
  await expect(page.getByRole("button", { name: "Save & return" })).toBeEnabled()
  await page.getByRole("button", { name: "Save & return" }).click()
  await expect(page.getByLabel("Open saved edit for frame 2")).toBeVisible()
  const projects = await (await page.request.get("/api/v1/projects")).json()
  const persisted = await (await page.request.get(`/api/v1/projects/${projects[0].id}`)).json()
  expect(persisted.frame_edits[0].document.schema_version).toBe(2)
  expect(persisted.frame_edits[0].mask_hash).toBeTruthy()
  expect(persisted.session_state.current_ordinal).toBe(1)
  const persistedMask = Buffer.from(await (await page.request.get(`/api/v1/projects/${projects[0].id}/frame-edits/${persisted.frame_edits[0].id}/mask`)).body())

  await page.getByLabel("Frame edits").getByRole("button", { name: "Frame 2" }).click()
  await expect(page.getByRole("button", { name: "Return to video" })).toBeVisible()
  await page.getByRole("button", { name: "Return to video" }).click()

  const sourceHash = persisted.source.asset_hash
  execFileSync("docker", ["compose", "exec", "-T", "app", "rm", "-f", `/data/projects/projects/${projects[0].id}/assets/${sourceHash.slice(0, 2)}/${sourceHash}`], { cwd: repositoryRoot, stdio: "pipe" })
  await page.reload({ waitUntil: "domcontentloaded" })
  await expect(page.getByText(/^Relink /)).toBeVisible()
  await page.getByLabel("Choose Trim Input").setInputFiles({ name: "moved-docker-phase1.webm", mimeType: "video/webm", buffer: videoBytes })
  await expect(page.getByRole("button", { name: projectName, exact: true })).toBeVisible({ timeout: 30_000 })

  const appContainer = execFileSync("docker", ["compose", "ps", "-q", "app"], { cwd: repositoryRoot, encoding: "utf8" }).trim()
  const frontendContainer = execFileSync("docker", ["compose", "ps", "-q", "frontend"], { cwd: repositoryRoot, encoding: "utf8" }).trim()
  const modelVolume = execFileSync("docker", ["inspect", "-f", "{{range .Mounts}}{{if eq .Destination \"/models\"}}{{.Name}}{{end}}{{end}}", appContainer], { encoding: "utf8" }).trim()
  const frontendVolume = execFileSync("docker", ["inspect", "-f", "{{range .Mounts}}{{if eq .Destination \"/app/node_modules\"}}{{.Name}}{{end}}{{end}}", frontendContainer], { encoding: "utf8" }).trim()
  execFileSync("docker", ["volume", "create", qualificationEnvironment.TICKET27_MODELS_VOLUME], { stdio: "pipe" })
  execFileSync("docker", ["volume", "create", qualificationEnvironment.TICKET27_FRONTEND_VOLUME], { stdio: "pipe" })
  copyVolume(modelVolume, qualificationEnvironment.TICKET27_MODELS_VOLUME)
  copyVolume(frontendVolume, qualificationEnvironment.TICKET27_FRONTEND_VOLUME)
  compose(["stop", "app", "frontend"])
  compose(["up", "-d", "--force-recreate", "app", "frontend"])
  await expect.poll(async () => {
    try {
      return (await page.request.get("/api/v1/projects")).ok()
    } catch {
      return false
    }
  }, { timeout: 45_000 }).toBe(true)
  await page.reload({ waitUntil: "domcontentloaded" })
  const activeProject = page.getByRole("button", { name: projectName, exact: true })
  const recentProject = page.getByRole("button", { name: `${projectName} Continue`, exact: true })
  await expect(activeProject.or(recentProject)).toBeVisible({ timeout: 30_000 })
  if (await recentProject.isVisible()) await recentProject.click()
  await expect(activeProject).toBeVisible({ timeout: 30_000 })
  await expect(page.getByLabel("Open saved edit for frame 2")).toBeVisible()
  const afterRecreate = await (await page.request.get(`/api/v1/projects/${projects[0].id}`)).json()
  expect(afterRecreate.frame_edits[0].document.schema_version).toBe(2)
  expect(afterRecreate.frame_edits[0].mask_hash).toBe(persisted.frame_edits[0].mask_hash)
  expect(afterRecreate.session_state.current_ordinal).toBe(1)
  expect(afterRecreate.relink_history.at(-1).result).toBe("relinked")
  const restoredMask = Buffer.from(await (await page.request.get(`/api/v1/projects/${projects[0].id}/frame-edits/${persisted.frame_edits[0].id}/mask`)).body())
  expect(createHash("sha256").update(restoredMask).digest("hex")).toBe(createHash("sha256").update(persistedMask).digest("hex"))
  compose(["exec", "-T", "app", "sh", "-ec", "test -w /data/projects"])
  await page.getByLabel("Frame edits").getByRole("button", { name: "Frame 2" }).click()
  await expect(page.getByRole("button", { name: "Return to video" })).toBeVisible()
  await page.getByRole("button", { name: "Return to video" }).click()

  await page.getByRole("button", { name: "Delete project" }).click()
  await page.getByRole("button", { name: "Delete project", exact: true }).click()
  await expect(page.getByLabel("Recent video projects")).toBeVisible()
  await expect(page.getByText(projectName)).toBeHidden()
})
