const supportedVideoTypes = new Set(["video/mp4", "video/quicktime", "video/webm"])
const supportedVideoExtensions = new Set([".mp4", ".mov", ".webm"])

export const mediaFileAccept = "image/png, image/jpeg, image/webp, image/bmp, image/tiff, .mp4, .mov, .webm"

export function isSupportedMediaFile(file: File): boolean {
  if (file.type.startsWith("image/") || supportedVideoTypes.has(file.type)) {
    return true
  }
  const dot = file.name.lastIndexOf(".")
  return dot >= 0 && supportedVideoExtensions.has(file.name.slice(dot).toLowerCase())
}

export function isVideoFile(file: File): boolean {
  return supportedVideoTypes.has(file.type) || supportedVideoExtensions.has(file.name.slice(file.name.lastIndexOf(".")).toLowerCase())
}
