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
