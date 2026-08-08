import { API_ENDPOINT } from "@/lib/api"

export async function trimVideo(file: File, start: number, end: number): Promise<Blob> {
  const body = new FormData()
  body.append("file", file)
  const response = await fetch(`${API_ENDPOINT}/video/trim?start=${start}&end=${end}`, { method: "POST", body })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.detail ?? "Unable to trim this video.")
  }
  return response.blob()
}

export async function probeVideoFrameRate(file: File): Promise<number | null> {
  const body = new FormData()
  body.append("file", file)
  const response = await fetch(`${API_ENDPOINT}/video/probe`, { method: "POST", body })
  if (!response.ok) return null
  const payload = await response.json()
  return typeof payload.frame_rate === "number" && payload.frame_rate > 0 ? payload.frame_rate : null
}
