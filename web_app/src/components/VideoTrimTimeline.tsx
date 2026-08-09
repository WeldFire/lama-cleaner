import { ChevronLeft, ChevronRight, Download, Loader2, Pause, Play } from "lucide-react"
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react"

import { probeVideoFrameRate, trimVideo } from "@/lib/videoApi"

type Handle = "start" | "end" | null

const MIN_TRIM_DURATION = 0.01
const PRECISE_SEEK_DELAY_MS = 500
const LARGE_DRAG_FRACTION = 0.1
const PREVIEW_SEEK_INTERVAL_MS = 100
const FAST_PREVIEW_STEP_SECONDS = 0.25
const DEFAULT_FRAME_RATE = 30

function formatTimecode(seconds: number) {
  const milliseconds = Math.round(seconds * 1000)
  const hours = Math.floor(milliseconds / 3_600_000)
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000)
  const wholeSeconds = Math.floor((milliseconds % 60_000) / 1000)
  const remainderMilliseconds = milliseconds % 1000
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${wholeSeconds.toString().padStart(2, "0")}.${remainderMilliseconds.toString().padStart(3, "0")}`
}

function parseTimecode(value: string) {
  const parts = value.trim().split(":")
  if (parts.length < 1 || parts.length > 3 || parts.some((part) => part === "")) return null
  const seconds = Number(parts.pop())
  const minutes = parts.length ? Number(parts.pop()) : 0
  const hours = parts.length ? Number(parts.pop()) : 0
  if (![seconds, minutes, hours].every(Number.isFinite) || seconds < 0 || minutes < 0 || hours < 0) return null
  return hours * 3600 + minutes * 60 + seconds
}

export default function VideoTrimTimeline({ file }: { file: File }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const dragHandleRef = useRef<Handle>(null)
  const startRef = useRef(0)
  const endRef = useRef(0)
  const preDragCurrentRef = useRef(0)
  const lastDraggedBoundaryRef = useRef(0)
  const precisionModeRef = useRef(false)
  const preciseSeekTimerRef = useRef<number | null>(null)
  const previewSeekTimerRef = useRef<number | null>(null)
  const pendingPreviewTimeRef = useRef(0)
  const pendingPreviewExactRef = useRef(false)
  const lastPreviewSeekAtRef = useRef(0)
  const currentRef = useRef(0)
  const frameRateOverriddenRef = useRef(false)
  const source = useMemo(() => URL.createObjectURL(file), [file])
  const [duration, setDuration] = useState(0)
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(0)
  const [current, setCurrent] = useState(0)
  const [dragging, setDragging] = useState<Handle>(null)
  const [playing, setPlaying] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState("")
  const [frameRate, setFrameRate] = useState(DEFAULT_FRAME_RATE)
  const [frameRateInput, setFrameRateInput] = useState(String(DEFAULT_FRAME_RATE))
  const [startTimecode, setStartTimecode] = useState(formatTimecode(0))
  const [endTimecode, setEndTimecode] = useState(formatTimecode(0))

  useEffect(() => {
    return () => {
      if (preciseSeekTimerRef.current !== null) window.clearTimeout(preciseSeekTimerRef.current)
      if (previewSeekTimerRef.current !== null) window.clearTimeout(previewSeekTimerRef.current)
      URL.revokeObjectURL(source)
    }
  }, [source])

  useEffect(() => {
    let mounted = true
    frameRateOverriddenRef.current = false
    setFrameRate(DEFAULT_FRAME_RATE)
    setFrameRateInput(String(DEFAULT_FRAME_RATE))
    probeVideoFrameRate(file).then((detectedFrameRate) => {
      if (mounted && detectedFrameRate && !frameRateOverriddenRef.current) {
        setFrameRate(detectedFrameRate)
        setFrameRateInput(String(detectedFrameRate))
      }
    })
    return () => {
      mounted = false
    }
  }, [file])

  const timeAt = (clientX: number) => {
    const box = trackRef.current?.getBoundingClientRect()
    if (!box || !duration) return 0
    return Math.max(0, Math.min(duration, ((clientX - box.left) / box.width) * duration))
  }

  const seek = (time: number) => {
    if (videoRef.current) videoRef.current.currentTime = time
    currentRef.current = time
    setCurrent(time)
  }

  const setTrimStart = (time: number) => {
    const nextStart = Math.max(0, Math.min(time, endRef.current - MIN_TRIM_DURATION))
    startRef.current = nextStart
    setStart(nextStart)
    if (currentRef.current < nextStart) seek(nextStart)
  }

  const setTrimEnd = (time: number) => {
    const nextEnd = Math.min(duration, Math.max(time, startRef.current + MIN_TRIM_DURATION))
    endRef.current = nextEnd
    setEnd(nextEnd)
    if (currentRef.current > nextEnd) seek(nextEnd)
  }

  const schedulePreviewSeek = (time: number, exact: boolean) => {
    pendingPreviewTimeRef.current = time
    pendingPreviewExactRef.current = exact
    if (previewSeekTimerRef.current !== null) return

    const delay = Math.max(0, PREVIEW_SEEK_INTERVAL_MS - (performance.now() - lastPreviewSeekAtRef.current))
    previewSeekTimerRef.current = window.setTimeout(() => {
      previewSeekTimerRef.current = null
      lastPreviewSeekAtRef.current = performance.now()
      const previewTime = pendingPreviewExactRef.current
        ? pendingPreviewTimeRef.current
        : Math.round(pendingPreviewTimeRef.current / FAST_PREVIEW_STEP_SECONDS) * FAST_PREVIEW_STEP_SECONDS
      seek(previewTime)
    }, delay)
  }

  const seekExactly = (time: number) => {
    if (previewSeekTimerRef.current !== null) window.clearTimeout(previewSeekTimerRef.current)
    previewSeekTimerRef.current = null
    seek(time)
  }

  const schedulePreciseSeek = (time: number) => {
    if (preciseSeekTimerRef.current !== null) window.clearTimeout(preciseSeekTimerRef.current)
    preciseSeekTimerRef.current = window.setTimeout(() => {
      if (!dragHandleRef.current) return
      precisionModeRef.current = true
      seekExactly(time)
    }, PRECISE_SEEK_DELAY_MS)
  }

  const updateDraggedBoundary = (clientX: number) => {
    const handle = dragHandleRef.current
    if (!handle) return

    const proposedTime = timeAt(clientX)
    const boundary =
      handle === "start"
        ? Math.min(proposedTime, endRef.current - MIN_TRIM_DURATION)
        : Math.max(proposedTime, startRef.current + MIN_TRIM_DURATION)

    if (handle === "start") setTrimStart(boundary)
    else setTrimEnd(boundary)

    const movedFar = Math.abs(boundary - lastDraggedBoundaryRef.current) >= duration * LARGE_DRAG_FRACTION
    if (movedFar) precisionModeRef.current = false
    lastDraggedBoundaryRef.current = boundary

    // This browser does not expose fastSeek. Coalesce pointer movement so the
    // decoder gets at most ten preview requests a second. Once idle, precision
    // mode remains exact until the user makes a large jump.
    schedulePreviewSeek(boundary, precisionModeRef.current)
    setCurrent(boundary)
    schedulePreciseSeek(boundary)
  }

  const finishHandleDrag = (event?: PointerEvent<HTMLDivElement>) => {
    if (!dragHandleRef.current) return
    const restoredCurrent = Math.max(startRef.current, Math.min(endRef.current, preDragCurrentRef.current))
    dragHandleRef.current = null
    if (event?.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (preciseSeekTimerRef.current !== null) window.clearTimeout(preciseSeekTimerRef.current)
    if (previewSeekTimerRef.current !== null) window.clearTimeout(previewSeekTimerRef.current)
    previewSeekTimerRef.current = null
    precisionModeRef.current = false
    seekExactly(restoredCurrent)
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
    preDragCurrentRef.current = videoRef.current?.currentTime ?? currentRef.current
    lastDraggedBoundaryRef.current = handle === "start" ? startRef.current : endRef.current
    precisionModeRef.current = false
    setDragging(handle)
    videoRef.current?.pause()
  }

  const download = async () => {
    setError("")
    setIsExporting(true)
    try {
      const blob = await trimVideo(file, start, end)
      const link = document.createElement("a")
      link.href = URL.createObjectURL(blob)
      link.download = `${file.name.replace(/\.[^.]+$/, "")}_trimmed.mp4`
      link.click()
      URL.revokeObjectURL(link.href)
    } catch (caughtError) {
      setError(`Export failed: ${caughtError instanceof Error ? caughtError.message : "Unable to trim video."}`)
    } finally {
      setIsExporting(false)
    }
  }

  const stepFrame = (direction: -1 | 1) => {
    videoRef.current?.pause()
    seek(Math.max(start, Math.min(end, currentRef.current + direction / frameRate)))
  }

  const applyTimecode = (boundary: "start" | "end", value: string) => {
    const time = parseTimecode(value)
    if (time === null || time > duration) {
      setError("Enter a timecode within the video duration.")
      boundary === "start" ? setStartTimecode(formatTimecode(start)) : setEndTimecode(formatTimecode(end))
      return
    }
    setError("")
    if (boundary === "start") setTrimStart(time)
    else setTrimEnd(time)
  }

  const togglePlayback = () => {
    if (videoRef.current?.paused) videoRef.current.play()
    else videoRef.current?.pause()
  }

  const applyFrameRate = (value: string) => {
    const nextFrameRate = Number(value)
    if (!Number.isFinite(nextFrameRate) || nextFrameRate <= 0 || nextFrameRate > 240) {
      setError("Enter a frame rate between 1 and 240 fps.")
      setFrameRateInput(String(frameRate))
      return
    }
    frameRateOverriddenRef.current = true
    setError("")
    setFrameRate(nextFrameRate)
    setFrameRateInput(String(nextFrameRate))
  }

  useEffect(() => setStartTimecode(formatTimecode(start)), [start])
  useEffect(() => setEndTimecode(formatTimecode(end)), [end])

  useEffect(() => {
    const handleKeyboardShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return
      if (event.key === " ") {
        event.preventDefault()
        togglePlayback()
      } else if (event.key === "ArrowLeft") {
        event.preventDefault()
        stepFrame(-1)
      } else if (event.key === "ArrowRight") {
        event.preventDefault()
        stepFrame(1)
      }
    }
    window.addEventListener("keydown", handleKeyboardShortcut)
    return () => window.removeEventListener("keydown", handleKeyboardShortcut)
  }, [duration, end, frameRate, start])

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
          // Fast seeking resolves to a nearby keyframe. Keep the timeline on
          // the requested boundary until an exact seek completes.
          if (dragHandleRef.current) return
          const time = event.currentTarget.currentTime
          currentRef.current = time
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
          onLostPointerCapture={finishHandleDrag}
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
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Trim start
            <input
              aria-label="Trim start timecode"
              className="h-9 rounded border border-input bg-background px-2 font-mono text-sm text-foreground"
              onBlur={(event) => applyTimecode("start", event.currentTarget.value)}
              onChange={(event) => setStartTimecode(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur()
              }}
              value={startTimecode}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Trim end
            <input
              aria-label="Trim end timecode"
              className="h-9 rounded border border-input bg-background px-2 font-mono text-sm text-foreground"
              onBlur={(event) => applyTimecode("end", event.currentTarget.value)}
              onChange={(event) => setEndTimecode(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur()
              }}
              value={endTimecode}
            />
          </label>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            aria-label={playing ? "Pause video" : "Play video"}
            className="rounded bg-muted p-2"
            onClick={togglePlayback}
            type="button"
          >
            {playing ? <Pause /> : <Play />}
          </button>
          <button
            aria-label="Previous frame"
            className="rounded bg-muted p-2"
            onClick={() => stepFrame(-1)}
            type="button"
          >
            <ChevronLeft />
          </button>
          <button
            aria-label="Next frame"
            className="rounded bg-muted p-2"
            onClick={() => stepFrame(1)}
            type="button"
          >
            <ChevronRight />
          </button>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            FPS
            <input
              aria-label="Frame rate"
              className="h-8 w-16 rounded border border-input bg-background px-2 text-sm text-foreground"
              min="1"
              onBlur={(event) => applyFrameRate(event.currentTarget.value)}
              onChange={(event) => setFrameRateInput(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur()
              }}
              step="0.001"
              type="number"
              value={frameRateInput}
            />
          </label>
          <span className="text-sm">Trim {start.toFixed(2)} → {end.toFixed(2)}</span>
          <button
            aria-busy={isExporting}
            className="ml-auto flex items-center gap-2 rounded bg-primary px-3 py-2 text-primary-foreground disabled:cursor-wait disabled:opacity-70"
            disabled={isExporting}
            onClick={download}
            type="button"
          >
            {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {isExporting ? "Exporting…" : "Download MP4"}
          </button>
        </div>
        {isExporting && <p className="mt-2 text-sm text-muted-foreground">Transcoding video…</p>}
        {error && <p className="mt-2 text-sm text-destructive" role="alert">{error}</p>}
        {dragging && <p className="sr-only">Adjusting trim {dragging}</p>}
      </div>
    </section>
  )
}
