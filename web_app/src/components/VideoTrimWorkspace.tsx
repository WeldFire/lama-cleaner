import { Download, Scissors } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { trimVideo } from "@/lib/videoApi"

type Props = { file: File }

const formatTime = (seconds: number) => new Date(seconds * 1000).toISOString().slice(11, 19)

export default function VideoTrimWorkspace({ file }: Props) {
  const [duration, setDuration] = useState(0)
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const source = useMemo(() => URL.createObjectURL(file), [file])

  useEffect(() => () => URL.revokeObjectURL(source), [source])
  const onMetadata = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    const value = event.currentTarget.duration
    setDuration(value); setEnd(value)
  }
  const download = async () => {
    setBusy(true); setError("")
    try {
      const blob = await trimVideo(file, start, end)
      const link = document.createElement("a")
      link.href = URL.createObjectURL(blob); link.download = `${file.name.replace(/\.[^.]+$/, "")}_trimmed.mp4`; link.click()
      URL.revokeObjectURL(link.href)
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to trim this video.") }
    finally { setBusy(false) }
  }

  return <main className="mx-auto grid min-h-screen w-full max-w-6xl gap-6 p-8 pt-24 lg:grid-cols-[1fr_340px]">
    <section className="space-y-5"><div><p className="text-sm text-muted-foreground">Video trim</p><h1 className="text-3xl font-semibold">{file.name}</h1></div><video className="aspect-video w-full rounded-xl bg-black" controls src={source} onLoadedMetadata={onMetadata} /><input className="w-full" type="range" min="0" max={duration} step="0.01" value={start} onChange={(event) => setStart(Math.min(Number(event.target.value), end - 0.01))} /><input className="w-full" type="range" min="0" max={duration} step="0.01" value={end} onChange={(event) => setEnd(Math.max(Number(event.target.value), start + 0.01))} /></section>
    <aside className="rounded-xl border bg-background p-6 shadow-sm"><h2 className="font-semibold">Trim settings</h2><p className="mt-1 text-sm text-muted-foreground">Set exact timestamps.</p><label className="mt-6 block text-sm font-medium">Start<input className="mt-2 w-full rounded border bg-muted px-3 py-2 font-mono" type="number" min="0" max={end - 0.01} step="0.01" value={start} onChange={(event) => setStart(Number(event.target.value))} /></label><label className="mt-4 block text-sm font-medium">End<input className="mt-2 w-full rounded border bg-muted px-3 py-2 font-mono" type="number" min={start + 0.01} max={duration} step="0.01" value={end} onChange={(event) => setEnd(Number(event.target.value))} /></label><div className="mt-5 rounded-md bg-muted p-3 text-sm"><span className="text-muted-foreground">Output length</span><strong className="block text-lg">{formatTime(Math.max(0, end - start))}</strong></div>{error && <p className="mt-4 text-sm text-destructive">{error}</p>}<button disabled={busy || end <= start} onClick={download} className="mt-6 flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground"><Scissors className="h-4 w-4" />{busy ? "Trimming…" : <><Download className="h-4 w-4" />Download MP4</>}</button></aside>
  </main>
}
