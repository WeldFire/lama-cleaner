import { API_ENDPOINT } from "@/lib/api"
import type { FrameEdit, FrameKey } from "@/lib/frameEditSession"

export type VideoProject = {
  id: string
  sourceName: string
  frames: FrameKey[]
  frameEdits: FrameEdit[]
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
  return {
    id: stringValue(data.id ?? data.project_id),
    sourceName: stringValue(data.source_name ?? data.sourceName, "video"),
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
      return {
        id: stringValue(edit.id ?? edit.edit_id),
        frameOrdinal: Number(edit.frame_ordinal ?? edit.frameOrdinal ?? 0),
        renderUrl: stringValue(edit.render_url ?? edit.renderUrl) || undefined,
        updatedAt: stringValue(edit.updated_at ?? edit.updatedAt) || undefined,
      }
    }),
  }
}

async function requireJson(response: Response) {
  if (!response.ok) {
    const message = await response.text()
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
  editId?: string | null
): Promise<FrameEdit> {
  const body = new FormData()
  body.append("render", render, render.name)
  body.append("ordinal", String(ordinal))
  body.append("document", JSON.stringify({ schema_version: 1 }))
  if (editId) body.append("frame_edit_id", editId)
  const data = record(await requireJson(await fetch(`${API_ENDPOINT}/projects/${projectId}/frame-edits`, { method: "POST", body })))
  return {
    id: stringValue(data.id ?? data.edit_id),
    frameOrdinal: Number(data.frame_ordinal ?? ordinal),
    renderUrl: stringValue(data.render_url) || undefined,
    updatedAt: stringValue(data.updated_at) || undefined,
  }
}

export async function deleteProjectFrameEdit(projectId: string, editId: string) {
  const response = await fetch(`${API_ENDPOINT}/projects/${projectId}/frame-edits/${editId}`, { method: "DELETE" })
  if (!response.ok) throw new Error(await response.text() || "Unable to delete this frame edit")
}
