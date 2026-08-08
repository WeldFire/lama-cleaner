import { API_ENDPOINT } from "@/lib/api"

export async function importVideoUrl(url: string): Promise<File> {
  const response = await fetch(`${API_ENDPOINT}/video/import?url=${encodeURIComponent(url)}`, { method: "POST" })
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.detail ?? "Unable to import this video URL.")
  }
  const blob = await response.blob()
  const name = response.headers.get("Content-Disposition")?.match(/filename="?([^";]+)"?/)?.[1] ?? "imported.mp4"
  return new File([blob], name, { type: "video/mp4" })
}
