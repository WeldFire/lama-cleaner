import { Download, Pause, Play } from "lucide-react"
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react"

import { trimVideo } from "@/lib/videoApi"

type Handle = "start" | "end" | null

const MIN_TRIM_DURATION = 0.01

export default function VideoTrimTimeline({ file }: { file: File }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const dragHandleRef = useRef<Handle>(null)
  const startRef = useRef(0)
  const endRef = useRef(0)
  const source = useMemo(() => URL.createObjectURL(file), [file])
  const [duration, setDuration] = useState(0)
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(0)
  const [current, setCurrent] = useState(0)
  const [dragging, setDragging] = useState<Handle>(null)
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => () => URL.revokeObjectURL(source), [source])

  const timeAt = (clientX: number) => {
    const box = trackRef.current?.getBoundingClientRect()
    if (!box || !duration) return 0
    return Math.max(0, Math.min(duration, ((clientX - box.left) / box.width) * duration))
  }

  const seek = (time: number) => {
    if (videoRef.current) videoRef.current.currentTime = time
    setCurrent(time)
  }

  const updateDraggedBoundary = (clientX: number) => {
    const handle = dragHandleRef.current
    if (!handle) return

    const proposedTime = timeAt(clientX)
    const boundary =
      handle === "start"
        ? Math.min(proposedTime, endRef.current - MIN_TRIM_DURATION)
        : Math.max(proposedTime, startRef.current + MIN_TRIM_DURATION)

    if (handle === "start") {
      startRef.current = boundary
      setStart(boundary)
    } else {
      endRef.current = boundary
      setEnd(boundary)
    }

    // The moving boundary is the preview while dragging. This also keeps the
    // playhead inside the Trim Range when a boundary passes its old position.
    seek(boundary)
  }

  const finishHandleDrag = (event?: PointerEvent<HTMLDivElement>) => {
    if (event?.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragHandleRef.current = null
    setDragging(null)
  }

  const startHandleDrag = (handle: Exclude<Handle, null>, event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const track = trackRef.current
    if (!track) return

    // Capture on the timeline, not the narrow handle, so vertical pointer
    // movement cannot escape into the app-wide native drag-and-drop handler.
    track.setPointerCapture(event.pointerId)
    dragHandleRef.current = handle
    setDragging(handle)
    videoRef.current?.pause()
    updateDraggedBoundary(event.clientX)
  }

  const download = async () => {
    try {
      const blob = await trimVideo(file, start, end)
      const link = document.createElement("a")
      link.href = URL.createObjectURL(blob)
      link.download = `${file.name.replace(/\.[^.]+$/, "")}_trimmed.mp4`
      link.click()
      URL.revokeObjectURL(link.href)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to trim video.")
    }
  }

  const startPosition = duration ? (start / duration) * 100 : 0
  const endPosition = duration ? (end / duration) * 100 : 0
  const currentPosition = duration ? (current / duration) * 100 : 0

  return (
    <section className="absolute inset-x-6 bottom-6 top-20 flex flex-col gap-4">
      <video
        ref={videoRef}
        className="min-h-0 flex-1 rounded-lg bg-black object-contain"
        draggable={false}
        src={source}
        onLoadedMetadata={(event) => {
          setDuration(event.currentTarget.duration)
          startRef.current = 0
          endRef.current = event.currentTarget.duration
          setStart(0)
          setEnd(event.currentTarget.duration)
        }}
        onTimeUpdate={(event) => {
          const time = event.currentTarget.currentTime
          setCurrent(time)
          if (time >= end) {
            event.currentTarget.pause()
            seek(start)
          }
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
      <div className="rounded-lg border bg-background p-4">
        <div className="mb-2 flex justify-between text-sm">
          <span>{file.name}</span>
          <span>{current.toFixed(2)} / {duration.toFixed(2)}</span>
        </div>
        <div
          ref={trackRef}
          className="relative h-10 touch-none select-none"
          onDragStart={(event) => event.preventDefault()}
          onPointerDown={(event) => {
            if (!dragHandleRef.current) seek(timeAt(event.clientX))
          }}
          onPointerMove={(event) => updateDraggedBoundary(event.clientX)}
          onPointerUp={finishHandleDrag}
          onPointerCancel={finishHandleDrag}
          onLostPointerCapture={() => {
            dragHandleRef.current = null
            setDragging(null)
          }}
        >
          <div className="absolute inset-x-0 top-4 h-2 rounded bg-muted" />
          <div
            className="absolute top-4 h-2 rounded bg-primary"
            style={{ left: `${startPosition}%`, right: `${100 - endPosition}%` }}
          />
          <button
            aria-label="Trim start"
            className="absolute top-0 h-10 w-4 cursor-ew-resize rounded bg-white"
            draggable={false}
            style={{ left: `${startPosition}%` }}
            type="button"
            onPointerDown={(event) => startHandleDrag("start", event)}
          />
          <button
            aria-label="Trim end"
            className="absolute top-0 h-10 w-4 cursor-ew-resize rounded bg-white"
            draggable={false}
            style={{ left: `${endPosition}%` }}
            type="button"
            onPointerDown={(event) => startHandleDrag("end", event)}
          />
          <i
            className="absolute top-1 h-8 w-0.5 bg-foreground"
            style={{ left: `${currentPosition}%` }}
          />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            className="rounded bg-muted p-2"
            onClick={() => (videoRef.current?.paused ? videoRef.current.play() : videoRef.current?.pause())}
            type="button"
          >
            {playing ? <Pause /> : <Play />}
          </button>
          <span className="text-sm">Trim {start.toFixed(2)} → {end.toFixed(2)}</span>
          <button
            className="ml-auto flex items-center gap-2 rounded bg-primary px-3 py-2 text-primary-foreground"
            onClick={download}
            type="button"
          >
            <Download className="h-4 w-4" />
            Download MP4
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        {dragging && <p className="sr-only">Adjusting trim {dragging}</p>}
      </div>
    </section>
  )
}
