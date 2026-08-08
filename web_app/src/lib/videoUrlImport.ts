import { API_ENDPOINT } from "@/lib/api"

export async function importVideoUrl(url: string, signal?: AbortSignal): Promise<File> {
  const response = await fetch(`${API_ENDPOINT}/video/import?url=${encodeURIComponent(url)}`, {
    method: "POST",
    signal,
  })
  if (!response.ok) {
    const error = await response.json().catch(() => null)
    throw new Error(error?.detail ?? "Unable to import this video URL.")
  }
  const blob = await response.blob()
  const name = response.headers.get("Content-Disposition")?.match(/filename="?([^";]+)"?/)?.[1] ?? "imported.mp4"
  return new File([blob], name, { type: response.headers.get("Content-Type") ?? "video/mp4" })
}
