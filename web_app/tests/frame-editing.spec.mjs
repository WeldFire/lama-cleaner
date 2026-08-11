import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { expect, test } from "@playwright/test"

const model = {
  name: "cv2",
  path: "cv2",
  model_type: "inpaint",
  support_strength: false,
  support_outpainting: false,
  support_controlnet: false,
  support_brushnet: false,
  support_powerpaint_v2: false,
  controlnets: [],
  brushnets: [],
  support_lcm_lora: false,
  need_prompt: false,
  is_single_file_diffusers: false,
}

const serverConfig = {
  plugins: [],
  modelInfos: [model],
  removeBGModel: "",
  removeBGModels: [],
  realesrganModel: "",
  realesrganModels: [],
  interactiveSegModel: "",
  interactiveSegModels: [],
  enableFileManager: false,
  enableAutoSaving: false,
  enableControlnet: false,
  controlnetMethod: "",
  disableModelSwitch: true,
  isDesktop: false,
  samplers: [],
}

let fixtureDirectory
let videoBytes
let pngBytes

test.beforeAll(() => {
  fixtureDirectory = mkdtempSync(join(tmpdir(), "iopaint-frame-e2e-"))
  const videoPath = join(fixtureDirectory, "phase1.webm")
  execFileSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc2=size=64x48:rate=4:duration=1",
    "-an", "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", videoPath,
  ])
  videoBytes = readFileSync(videoPath)
  const imagePath = join(fixtureDirectory, "frame.png")
  execFileSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=blue:size=64x48", "-frames:v", "1", imagePath,
  ])
  pngBytes = readFileSync(imagePath)
})

test.afterAll(() => rmSync(fixtureDirectory, { recursive: true, force: true }))

function newBackendState() {
  return {
    project: null,
    deleted: false,
    session: { current_ordinal: 0, trim_start_ordinal: 0, trim_end_ordinal: 3 },
    frameEdits: [],
    nextEdit: 1,
    frameEditPosts: 0,
    trimRequests: [],
  }
}

function rawProject(state) {
  return {
    project_id: "project-1",
    name: state.project?.name || "Untitled video project",
    source: { filename: "phase1.webm" },
    frames: [0, 1, 2, 3].map((ordinal) => ({
      presentation_ordinal: ordinal,
      project_time_num: String(ordinal),
      project_time_den: "4",
    })),
    frame_edits: state.frameEdits.map((edit) => ({
      id: edit.id,
      frame_ordinal: edit.ordinal,
      render_hash: `render-${edit.id}`,
      updated_at: edit.updatedAt,
    })),
    session_state: state.session,
  }
}

async function json(route, payload, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) })
}

async function installMockBackend(page, state) {
  await page.route("**/socket.io/**", (route) => route.abort())
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace(/^\/api\/v1/, "")
    const method = request.method()

    if (path === "/server-config") return json(route, serverConfig)
    if (path === "/model") return json(route, model)
    if (path === "/inputimage") return route.fulfill({ status: 404 })
    if (path === "/projects" && method === "GET") {
      return json(route, state.project && !state.deleted
        ? [{ project_id: "project-1", name: state.project.name, updated_at: "2026-08-11T12:00:00Z" }]
        : [])
    }
    if (path === "/projects" && method === "POST") {
      state.project = { name: "Untitled video project" }
      state.deleted = false
      return json(route, rawProject(state))
    }
    if (path === "/projects/project-1" && method === "GET") return json(route, rawProject(state))
    if (path === "/projects/project-1" && method === "PATCH") {
      state.project.name = request.postDataJSON().name
      return json(route, rawProject(state))
    }
    if (path === "/projects/project-1" && method === "DELETE") {
      state.deleted = true
      return json(route, { project_id: "project-1", deleted: true })
    }
    if (path === "/projects/project-1/source") {
      return route.fulfill({
        status: 200,
        contentType: "video/webm",
        headers: { "Content-Disposition": 'attachment; filename="phase1.webm"' },
        body: videoBytes,
      })
    }
    if (path === "/projects/project-1/session" && method === "PUT") {
      state.session = request.postDataJSON()
      return json(route, state.session)
    }
    if (/^\/projects\/project-1\/frames\/\d+\/image$/.test(path)) {
      return route.fulfill({ status: 200, contentType: "image/png", body: pngBytes })
    }
    if (path === "/projects/project-1/frame-edits" && method === "POST") {
      state.frameEditPosts += 1
      const multipart = request.postDataBuffer()?.toString("utf8") || ""
      const ordinalMatch = multipart.match(/name="ordinal"\r?\n\r?\n(\d+)/)
      if (!ordinalMatch) throw new Error("Frame-edit upload omitted its canonical ordinal")
      const ordinal = Number(ordinalMatch[1])
      const existing = state.frameEdits.find((edit) => edit.ordinal === ordinal)
      const edit = existing || { id: `edit-${state.nextEdit++}`, ordinal }
      edit.updatedAt = new Date().toISOString()
      if (!existing) state.frameEdits.push(edit)
      return json(route, { id: edit.id, frame_ordinal: edit.ordinal, updated_at: edit.updatedAt })
    }
    const editMatch = path.match(/^\/projects\/project-1\/frame-edits\/(edit-\d+)(\/image)?$/)
    if (editMatch?.[2]) return route.fulfill({ status: 200, contentType: "image/png", body: pngBytes })
    if (editMatch && method === "DELETE") {
      state.frameEdits = state.frameEdits.filter((edit) => edit.id !== editMatch[1])
      return json(route, { id: editMatch[1], deleted: true })
    }
    if (path === "/video/trim" && method === "POST") {
      state.trimRequests.push({ start: url.searchParams.get("start"), end: url.searchParams.get("end") })
      return route.fulfill({ status: 200, contentType: "video/mp4", body: videoBytes })
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: '{"detail":"Unhandled E2E route"}' })
  })
}

async function createProjectFromTrimInput(page) {
  let navigationError
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto("/", { waitUntil: "domcontentloaded" })
      navigationError = null
      break
    } catch (error) {
      navigationError = error
      await page.waitForTimeout(500)
    }
  }
  if (navigationError) throw navigationError
  await page.getByLabel("Click here or drag an image").setInputFiles({
    name: "phase1.webm",
    mimeType: "video/webm",
    buffer: videoBytes,
  })
  await expect(page.getByRole("button", { name: "Edit frame" })).toBeVisible()
  await page.locator("video").evaluate((video) => {
    Object.defineProperty(video, "duration", { configurable: true, value: 1 })
    video.dispatchEvent(new Event("loadedmetadata"))
  })
  await expect(page.getByLabel("Download Trimmed Video")).toBeEnabled()
  await expect(page.getByLabel("Trim end timecode")).toHaveValue("00:00:01.000")
}

async function drawOnCurrentFrame(page) {
  const drawingCanvas = page.locator("canvas").last()
  await expect.poll(() => drawingCanvas.evaluate((canvas) => canvas.width)).toBe(64)
  const canvasBox = await drawingCanvas.boundingBox()
  if (!canvasBox) throw new Error("Editor canvas unavailable")
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(canvasBox.x + canvasBox.width / 2 + 8, canvasBox.y + canvasBox.height / 2 + 8)
  await page.mouse.up()
}

async function cropCurrentFrame(page) {
  await expect.poll(() => page.locator("canvas").last().evaluate((canvas) => canvas.width)).toBe(64)
  await page.evaluate(() => {
    document.body.tabIndex = -1
    document.body.focus()
  })
  await page.keyboard.press("KeyC")
  const corner = page.locator('[data-ord="topleft"]')
  const cornerBox = await corner.boundingBox()
  if (!cornerBox) throw new Error("Crop handle unavailable")
  await page.mouse.move(cornerBox.x + cornerBox.width / 2, cornerBox.y + cornerBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(cornerBox.x + cornerBox.width / 2 + 6, cornerBox.y + cornerBox.height / 2 + 6)
  await page.mouse.up()
  await page.keyboard.press("Enter")
  await expect(corner).toBeHidden()
}

test("project lifecycle survives reload and supports rename, selection, and confirmed deletion", async ({ page }) => {
  const state = newBackendState()
  await installMockBackend(page, state)
  await createProjectFromTrimInput(page)

  await page.getByRole("button", { name: "Untitled video project" }).click()
  await page.getByRole("textbox", { name: "Project name" }).fill("Qualified project")
  await page.getByRole("button", { name: "Save project name" }).click()
  await expect(page.getByRole("button", { name: "Qualified project", exact: true })).toBeVisible()

  await page.reload()
  await expect(page.getByRole("button", { name: "Qualified project", exact: true })).toBeVisible()
  const restartedPage = await page.context().newPage()
  await installMockBackend(restartedPage, state)
  await restartedPage.goto("/", { waitUntil: "domcontentloaded" })
  await expect(restartedPage.getByRole("button", { name: "Qualified project", exact: true })).toBeVisible()
  await restartedPage.close()
  await page.getByRole("button", { name: /Back to projects/ }).click()
  await expect(page.getByLabel("Recent video projects")).toBeVisible()
  await page.getByRole("button", { name: /Qualified project.*Continue/ }).click()
  await expect(page.getByRole("button", { name: "Qualified project", exact: true })).toBeVisible()

  await page.getByRole("button", { name: /Back to projects/ }).click()
  await page.getByLabel("Delete project Qualified project").click()
  await expect(page.getByRole("alertdialog")).toContainText("Delete this video project?")
  await page.getByRole("button", { name: "Delete project", exact: true }).click()
  await expect(page.getByLabel("Recent video projects")).toBeHidden()
  expect(state.deleted).toBe(true)
})

test("trim, exact-frame, frame-edit, guard, marker, tray, and downloads round trip", async ({ page }) => {
  const state = newBackendState()
  await installMockBackend(page, state)
  await createProjectFromTrimInput(page)

  await page.getByLabel("Next exact frame").click()
  await expect(page.getByText(/Frame 2 \/ 4/)).toBeVisible()
  await page.getByLabel("Previous exact frame").click()
  await expect(page.getByText(/Frame 1 \/ 4/)).toBeVisible()

  const timeline = page.getByLabel("Exact frame timeline")
  const startHandle = page.getByLabel("Drag trim start handle")
  const endHandle = page.getByLabel("Drag trim end handle")
  await expect(endHandle).toBeEnabled()
  const timelineBox = await timeline.boundingBox()
  const startBox = await startHandle.boundingBox()
  if (!timelineBox || !startBox) throw new Error("Timeline geometry unavailable")
  await page.mouse.move(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2)
  await page.mouse.down()
  await expect(page.getByText("Adjusting trim start…")).toBeVisible()
  await page.mouse.move(timelineBox.x + timelineBox.width * 0.25, timelineBox.y + timelineBox.height / 2)
  await expect(page.getByLabel("Trim start timecode")).toHaveValue("00:00:00.250")
  await page.mouse.up()

  const endBox = await endHandle.boundingBox()
  if (!endBox) throw new Error("Trim end handle geometry unavailable")
  await page.mouse.move(endBox.x + endBox.width / 2, endBox.y + endBox.height / 2)
  await page.mouse.down()
  await expect(page.getByText("Adjusting trim end…")).toBeVisible()
  await page.mouse.move(timelineBox.x + timelineBox.width * 0.75, timelineBox.y + timelineBox.height / 2)
  await expect(page.getByLabel("Trim end timecode")).toHaveValue("00:00:00.750")
  await page.mouse.up()

  await page.getByLabel("Trim start timecode").fill("00:00:00.000")
  await page.getByLabel("Trim start timecode").press("Enter")
  await page.getByLabel("Trim end timecode").fill("00:00:01.000")
  await page.getByLabel("Trim end timecode").press("Enter")
  await expect(page.getByLabel("Trim end timecode")).toHaveValue("00:00:01.000")
  await page.getByLabel("Trim end timecode").fill("00:00:00.500")
  await page.getByLabel("Trim end timecode").press("Enter")
  await expect(page.getByLabel("Trim end timecode")).toHaveValue("00:00:00.500")

  const trimmedDownload = page.waitForEvent("download")
  await page.getByLabel("Download Trimmed Video").click()
  expect((await trimmedDownload).suggestedFilename()).toBe("phase1_trimmed.mp4")
  expect(state.trimRequests).toHaveLength(1)

  await page.getByLabel("Trim end timecode").fill("00:00:01.000")
  await page.getByLabel("Trim end timecode").press("Enter")
  await expect(page.getByLabel("Next exact frame")).toBeEnabled()

  await page.getByRole("button", { name: "Edit frame" }).click()
  await expect(page.getByRole("button", { name: "Return to video" })).toBeVisible()
  const frameDownload = page.waitForEvent("download")
  await page.getByRole("button", { name: "Download frame" }).click()
  expect((await frameDownload).suggestedFilename()).toBe("phase1_frame-2.png")

  await drawOnCurrentFrame(page)

  await page.getByLabel("Next exact frame").click()
  await expect(page.getByRole("alertdialog")).toContainText("Save this frame edit?")
  await page.getByRole("button", { name: "Keep editing" }).click()
  await expect(page.getByRole("button", { name: "Return to video" })).toBeVisible()
  await page.getByLabel("Next exact frame").click()
  await page.getByRole("button", { name: "Save", exact: true }).click()
  await expect(page.getByText(/Frame 3 \/ 4/)).toBeVisible()
  await expect(page.getByLabel("Trim start timecode")).toHaveValue("00:00:00.000")
  await expect(page.getByLabel("Trim end timecode")).toHaveValue("00:00:01.000")
  await expect(page.getByLabel("Frame edits").getByRole("button", { name: "Frame 2" })).toBeVisible()

  await page.getByRole("button", { name: "Edit frame" }).click()
  await cropCurrentFrame(page)
  await page.getByLabel("Next exact frame").click()
  await page.getByRole("button", { name: "Discard" }).click()
  await expect(page.getByText(/Frame 4 \/ 4/)).toBeVisible()
  await expect(page.getByLabel("Open saved edit for frame 2")).toBeVisible()
  await page.getByLabel("Open saved edit for frame 2").click()
  await page.getByRole("button", { name: "Save & return" }).click()
  await expect(page.getByText(/Frame 2 \/ 4/)).toBeVisible()
  expect(state.frameEdits).toHaveLength(1)
  expect(state.frameEditPosts).toBe(2)

  await page.getByLabel("Delete frame edit 2").click()
  await expect(page.getByRole("alertdialog")).toContainText("Delete this frame edit?")
  await page.getByRole("button", { name: "Delete frame edit", exact: true }).click()
  await expect(page.getByLabel("Open saved edit for frame 2")).toBeHidden()
})

test("hotkeys are mode-owned and ignore focused inputs", async ({ page }) => {
  const state = newBackendState()
  await installMockBackend(page, state)
  await createProjectFromTrimInput(page)

  await page.keyboard.press("ArrowRight")
  await expect(page.getByText(/Frame 2 \/ 4/)).toBeVisible()
  await page.getByLabel("Trim start timecode").focus()
  await page.keyboard.press("ArrowRight")
  await expect(page.getByText(/Frame 2 \/ 4/)).toBeVisible()
  const videoTrimBefore = await page.getByLabel("Trim start timecode").inputValue()
  await page.getByText(/Frame 2 \/ 4/).click()
  await page.keyboard.press("[")
  await page.keyboard.press("]")
  await expect(page.getByLabel("Trim start timecode")).toHaveValue(videoTrimBefore)
  await page.keyboard.press("h")
  await expect(page.getByRole("dialog", { name: "Hotkeys" })).toBeVisible()
  await page.keyboard.press("h")

  await page.getByRole("button", { name: "Edit frame" }).click()
  const trimBefore = await page.getByLabel("Trim start timecode").inputValue()
  await expect.poll(() => page.locator("canvas").last().evaluate((canvas) => canvas.width)).toBe(64)
  await page.evaluate(() => {
    document.body.tabIndex = -1
    document.body.focus()
  })
  await page.keyboard.press("KeyC")
  await expect(page.locator('[data-ord="topleft"]')).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.locator('[data-ord="topleft"]')).toBeHidden()
  await page.keyboard.press("ArrowRight")
  await expect(page.getByLabel("Trim start timecode")).toHaveValue(trimBefore)
  await expect(page.getByRole("button", { name: "Return to video" })).toBeVisible()
  await expect(page.getByText(/Frame 2 \/ 4/)).toBeVisible()
  await page.getByRole("button", { name: "Untitled video project" }).click()
  await page.getByRole("textbox", { name: "Project name" }).focus()
  await page.keyboard.press("KeyC")
  await expect(page.locator('[data-ord="topleft"]')).toBeHidden()
  await page.getByLabel("Cancel project rename").click()

  await page.keyboard.press("h")
  await expect(page.getByRole("tab", { name: "General" })).toHaveAttribute("data-state", "active")
  await expect(page.getByText("Undo", { exact: true })).toBeVisible()
  await page.getByRole("tab", { name: "Video editing" }).click()
  await expect(page.getByText("Previous exact frame", { exact: true })).toBeVisible()
  await page.getByRole("tab", { name: "Image editing" }).click()
  await expect(page.getByText("Decrease Brush Size", { exact: true })).toBeVisible()
})
