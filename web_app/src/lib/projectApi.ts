import { API_ENDPOINT } from "@/lib/api"
import type { FrameEdit, FrameEditDocument, FrameKey } from "@/lib/frameEditSession"

export type VideoProject = {
  id: string
  name: string
  durable: boolean
  sourceName: string
  frames: FrameKey[]
  frameEdits: FrameEdit[]
  sessionState?: ProjectSessionState
}

export type ProjectSessionState = {
  currentOrdinal: number
  trimStartOrdinal: number
  trimEndOrdinal: number
}

export type VideoProjectSummary = {
  id: string
  name: string
  updatedAt: string
}

type JsonObject = Record<string, unknown>

const record = (value: unknown): JsonObject =>
  value !== null && typeof value === "object" ? (value as JsonObject) : {}

const stringValue = (value: unknown, fallback = "") =>
  typeof value === "string" || typeof value === "number" ? String(value) : fallback

function normalizeProject(payload: unknown): VideoProject {
  const data = record(payload)
  const rawFrames = Array.isArray(data.frames)
    ? data.frames
    : Array.isArray(data.frame_table)
      ? data.frame_table
      : []
  const rawEdits = Array.isArray(data.frame_edits)
    ? data.frame_edits
    : Array.isArray(data.frameEdits)
      ? data.frameEdits
      : []
  const source = record(data.source)
  const rawSession = record(data.session_state ?? data.sessionState)
  const hasSession = Object.keys(rawSession).length > 0
  return {
    id: stringValue(data.id ?? data.project_id),
    name: stringValue(data.name, "Untitled video project"),
    durable: Boolean(data.durable ?? rawEdits.length > 0),
    sourceName: stringValue(source.filename ?? data.source_name ?? data.sourceName, "video"),
    frames: rawFrames.map((item, index) => {
      const frame = record(item)
      return {
        ordinal: Number(frame.ordinal ?? frame.presentation_ordinal ?? index),
        projectTimeNum: stringValue(frame.project_time_num ?? frame.projectTimeNum ?? frame.pts_ticks, String(index)),
        projectTimeDen: stringValue(frame.project_time_den ?? frame.projectTimeDen ?? frame.time_base_den, "1"),
      }
    }),
    frameEdits: rawEdits.map((item) => {
      const edit = record(item)
      const editId = stringValue(edit.id ?? edit.edit_id)
      const explicitRenderUrl = stringValue(edit.render_url ?? edit.renderUrl)
      const document = record(edit.document)
      const normalizedDocument = normalizeFrameEditDocument(document)
      const resumable = Boolean(normalizedDocument && edit.mask_hash)
      return {
        id: editId,
        frameOrdinal: Number(edit.ordinal ?? edit.frame_ordinal ?? edit.frameOrdinal ?? 0),
        renderUrl: explicitRenderUrl || (edit.render_hash && editId
          ? `${API_ENDPOINT}/projects/${stringValue(data.id ?? data.project_id)}/frame-edits/${editId}/image`
          : undefined),
        maskUrl: edit.mask_hash && editId
          ? `${API_ENDPOINT}/projects/${stringValue(data.id ?? data.project_id)}/frame-edits/${editId}/mask`
          : undefined,
        document: resumable ? normalizedDocument : undefined,
        compatibility: resumable ? "resumable" : "flattened",
        updatedAt: stringValue(edit.updated_at ?? edit.updatedAt) || undefined,
      }
    }),
    sessionState: hasSession ? {
      currentOrdinal: Number(rawSession.current_ordinal ?? rawSession.currentOrdinal ?? 0),
      trimStartOrdinal: Number(rawSession.trim_start_ordinal ?? rawSession.trimStartOrdinal ?? 0),
      trimEndOrdinal: Number(rawSession.trim_end_ordinal ?? rawSession.trimEndOrdinal ?? Math.max(0, rawFrames.length - 1)),
    } : undefined,
  }
}

function normalizeFrameEditDocument(value: JsonObject): FrameEditDocument | undefined {
  const canvas = record(value.canvas)
  const crop = record(value.crop)
  const lines = record(value.lines)
  const tools = record(value.tools)
  const operation = record(value.operation)
  const frameKey = record(value.frame_key ?? value.frameKey)
  const canonicalImage = record(value.canonical_image ?? value.canonicalImage)
  const numbers = [canvas.width, canvas.height, crop.x, crop.y, crop.width, crop.height,
    tools.base_brush_size ?? tools.baseBrushSize, tools.brush_size_scale ?? tools.brushSizeScale]
    .map(Number)
  if (Number(value.schema_version ?? value.schemaVersion) !== 2 || numbers.some((item) => !Number.isFinite(item)) ||
      !Array.isArray(lines.committed) || !Array.isArray(lines.current) || !stringValue(frameKey.project_time_num ?? frameKey.projectTimeNum) ||
      !stringValue(frameKey.project_time_den ?? frameKey.projectTimeDen)) return undefined
  return {
    schemaVersion: 2,
    revision: Math.max(1, Number(value.revision) || 1),
    frameKey: {
      ordinal: Number(frameKey.ordinal),
      projectTimeNum: stringValue(frameKey.project_time_num ?? frameKey.projectTimeNum),
      projectTimeDen: stringValue(frameKey.project_time_den ?? frameKey.projectTimeDen),
    },
    canonicalImage: { ordinal: Number(canonicalImage.ordinal) },
    canvas: { width: Number(canvas.width), height: Number(canvas.height) },
    crop: { x: Number(crop.x), y: Number(crop.y), width: Number(crop.width), height: Number(crop.height) },
    mask: { format: "image/png", coordinateSpace: "canvas" },
    lines: {
      committed: Array.isArray(lines.committed) ? lines.committed as FrameEditDocument["lines"]["committed"] : [],
      current: Array.isArray(lines.current) ? lines.current as FrameEditDocument["lines"]["current"] : [],
    },
    tools: { baseBrushSize: Number(tools.base_brush_size ?? tools.baseBrushSize), brushSizeScale: Number(tools.brush_size_scale ?? tools.brushSizeScale) },
    operation: { kind: "image-edit", model: stringValue(operation.model), settings: record(operation.settings) },
  }
}

async function requireJson(response: Response) {
  if (!response.ok) {
    const body = await response.text()
    let message = body
    try {
      const payload = record(JSON.parse(body))
      message = stringValue(payload.detail ?? payload.message, body)
    } catch {
      // Non-JSON responses already contain the most useful server message.
    }
    throw new Error(message || `Project request failed (${response.status})`)
  }
  return response.json()
}

export async function createVideoProject(file: File): Promise<VideoProject> {
  const body = new FormData()
  body.append("file", file)
  return normalizeProject(await requireJson(await fetch(`${API_ENDPOINT}/projects`, { method: "POST", body })))
}

export async function getVideoProject(projectId: string): Promise<VideoProject> {
  return normalizeProject(await requireJson(await fetch(`${API_ENDPOINT}/projects/${projectId}`)))
}

export async function listVideoProjects(): Promise<VideoProjectSummary[]> {
  const payload = await requireJson(await fetch(`${API_ENDPOINT}/projects`))
  return (Array.isArray(payload) ? payload : []).map((item) => {
    const data = record(item)
    return {
      id: stringValue(data.id ?? data.project_id),
      name: stringValue(data.name, "Untitled video project"),
      updatedAt: stringValue(data.updated_at ?? data.updatedAt),
    }
  })
}

export async function getProjectSource(projectId: string, sourceName = "video"): Promise<File> {
  const response = await fetch(`${API_ENDPOINT}/projects/${projectId}/source`)
  if (!response.ok) throw new Error(await response.text() || "Unable to restore the project source")
  return new File([await response.blob()], sourceName, {
    type: response.headers.get("content-type") || "video/mp4",
  })
}

export async function saveProjectSession(projectId: string, session: ProjectSessionState) {
  await requireJson(await fetch(`${API_ENDPOINT}/projects/${projectId}/session`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      current_ordinal: session.currentOrdinal,
      trim_start_ordinal: session.trimStartOrdinal,
      trim_end_ordinal: session.trimEndOrdinal,
    }),
  }))
}

export async function getProjectFrame(projectId: string, ordinal: number): Promise<File> {
  const response = await fetch(`${API_ENDPOINT}/projects/${projectId}/frames/${ordinal}/image`)
  if (!response.ok) throw new Error(await response.text() || "Unable to open this frame")
  const blob = await response.blob()
  return new File([blob], `frame-${ordinal}.png`, { type: "image/png" })
}

export async function saveProjectFrameEdit(
  projectId: string,
  ordinal: number,
  render: File,
  document: FrameEditDocument,
  mask: File,
  editId?: string | null
): Promise<FrameEdit> {
  const body = new FormData()
  body.append("render", render, render.name)
  body.append("ordinal", String(ordinal))
  body.append("document", JSON.stringify({
    ...document,
    schema_version: document.schemaVersion,
    frame_key: {
      ordinal: document.frameKey.ordinal,
      project_time_num: document.frameKey.projectTimeNum,
      project_time_den: document.frameKey.projectTimeDen,
    },
    canonical_image: document.canonicalImage,
    tools: { base_brush_size: document.tools.baseBrushSize, brush_size_scale: document.tools.brushSizeScale },
  }))
  body.append("mask", mask, mask.name)
  if (editId) body.append("frame_edit_id", editId)
  const data = record(await requireJson(await fetch(`${API_ENDPOINT}/projects/${projectId}/frame-edits`, { method: "POST", body })))
  return {
    id: stringValue(data.id ?? data.edit_id),
    frameOrdinal: Number(data.ordinal ?? data.frame_ordinal ?? ordinal),
    renderUrl: stringValue(data.render_url) || undefined,
    maskUrl: stringValue(data.mask_url) || undefined,
    document,
    compatibility: "resumable",
    updatedAt: stringValue(data.updated_at) || undefined,
  }
}

export async function deleteProjectFrameEdit(projectId: string, editId: string) {
  const response = await fetch(`${API_ENDPOINT}/projects/${projectId}/frame-edits/${editId}`, { method: "DELETE" })
  if (!response.ok) throw new Error(await response.text() || "Unable to delete this frame edit")
}

export async function deleteVideoProject(projectId: string, keepalive = false) {
  await requireJson(await fetch(`${API_ENDPOINT}/projects/${projectId}`, { method: "DELETE", keepalive }))
}

export async function discardDraftVideoProject(projectId: string, keepalive = false) {
  await requireJson(await fetch(`${API_ENDPOINT}/projects/${projectId}?draft_only=true`, { method: "DELETE", keepalive }))
}

export async function renameVideoProject(projectId: string, name: string): Promise<VideoProject> {
  return normalizeProject(await requireJson(await fetch(`${API_ENDPOINT}/projects/${projectId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  })))
}
