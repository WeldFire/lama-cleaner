export type VideoHotkeyAction = "previous-frame" | "next-frame" | "toggle-playback"

/** Keep video shortcuts inert while the image editor owns keyboard input. */
export function resolveVideoHotkey(
  mode: "video" | "image",
  key: string,
  modified = false
): VideoHotkeyAction | null {
  if (mode !== "video" || modified) return null
  if (key === "ArrowLeft") return "previous-frame"
  if (key === "ArrowRight") return "next-frame"
  if (key === " ") return "toggle-playback"
  return null
}
