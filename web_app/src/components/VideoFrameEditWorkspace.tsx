import { ChevronLeft, ChevronRight, Download, Edit3, Loader2, Pause, Play, Save, Trash2, Video } from "lucide-react"
import { useEffect, useMemo, useReducer, useRef, useState, type PointerEvent } from "react"

import Workspace from "@/components/Workspace"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { reduceFrameEditSession, createFrameEditSession, type FrameEdit } from "@/lib/frameEditSession"
import {
  createVideoProject,
  deleteProjectFrameEdit,
  deleteVideoProject,
  getProjectFrame,
  getVideoProject,
  saveProjectSession,
  saveProjectFrameEdit,
  type VideoProject,
} from "@/lib/projectApi"
import { useStore } from "@/lib/states"
import { trimVideo } from "@/lib/videoApi"

const PRECISE_SEEK_DELAY_MS = 500
const PREVIEW_SEEK_INTERVAL_MS = 100
const LARGE_DRAG_FRACTION = 0.1
const FAST_PREVIEW_STEP_SECONDS = 0.25

const formatTimecode = (seconds: number) => {
  const milliseconds = Math.round(seconds * 1000)
  const hours = Math.floor(milliseconds / 3_600_000)
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000)
  const wholeSeconds = Math.floor((milliseconds % 60_000) / 1000)
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}.${String(milliseconds % 1000).padStart(3, "0")}`
}

const parseTimecode = (value: string) => {
  const parts = value.trim().split(":")
  if (!parts.length || parts.length > 3 || parts.some((part) => part === "")) return null
  const seconds = Number(parts.pop())
  const minutes = parts.length ? Number(parts.pop()) : 0
  const hours = parts.length ? Number(parts.pop()) : 0
  return [seconds, minutes, hours].every(Number.isFinite) && seconds >= 0 && minutes >= 0 && hours >= 0
    ? hours * 3600 + minutes * 60 + seconds : null
}

const secondsFor = (project: VideoProject, ordinal: number) => {
  const frame = project.frames[ordinal]
  if (!frame) return 0
  const denominator = Number(frame.projectTimeDen)
  return denominator ? Number(frame.projectTimeNum) / denominator : 0
}

const inclusiveOutBoundarySeconds = (project: VideoProject, ordinal: number, duration: number) =>
  ordinal >= project.frames.length - 1 ? duration : secondsFor(project, ordinal + 1)

export default function VideoFrameEditWorkspace({
  file,
  projectId,
  onClose,
  onProjectReady,
}: {
  file: File
  projectId?: string
  onClose: () => void
  onProjectReady?: (project: VideoProject) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const source = useMemo(() => URL.createObjectURL(file), [file])
  const [project, setProject] = useState<VideoProject | null>(null)
  const [session, dispatch] = useReducer(reduceFrameEditSession, createFrameEditSession(0))
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState("")
  const [playing, setPlaying] = useState(false)
  const setFile = useStore((state) => state.setFile)
  const getCurrentTargetFile = useStore((state) => state.getCurrentTargetFile)
  const editActivity = useStore((state) =>
    state.editorState.renders.length +
    state.editorState.curLineGroup.length +
    state.editorState.extraMasks.length +
    state.editorState.historyActions.length
  )
  const openedActivity = useRef(0)
  const timelineRef = useRef<HTMLDivElement>(null)
  const draggedTrimHandle = useRef<"start" | "end" | null>(null)
  const trimStartRef = useRef(0)
  const trimEndRef = useRef(0)
  const currentOrdinalRef = useRef(0)
  const preDragCurrentRef = useRef(0)
  const preciseSeekTimerRef = useRef<number | null>(null)
  const previewSeekTimerRef = useRef<number | null>(null)
  const pendingPreviewOrdinalRef = useRef(0)
  const precisionModeRef = useRef(false)
  const lastDraggedBoundaryRef = useRef(0)
  const lastPreviewSeekAtRef = useRef(0)
  const sessionSaveQueueRef = useRef(Promise.resolve())
  const sessionSaveRevisionRef = useRef(0)
  const [deleteCandidate, setDeleteCandidate] = useState<FrameEdit | null>(null)
  const [deleteProjectRequested, setDeleteProjectRequested] = useState(false)
  const sessionHydrated = useRef(false)
  const [dragging, setDragging] = useState<"start" | "end" | null>(null)
  const [duration, setDuration] = useState(0)
  const [startTimecode, setStartTimecode] = useState(formatTimecode(0))
  const [endTimecode, setEndTimecode] = useState(formatTimecode(0))
  const [sessionSaveError, setSessionSaveError] = useState("")

  useEffect(() => () => URL.revokeObjectURL(source), [source])

  useEffect(() => {
    trimStartRef.current = session.trimStartOrdinal
    trimEndRef.current = session.trimEndOrdinal
    currentOrdinalRef.current = session.currentOrdinal
  }, [session.currentOrdinal, session.trimEndOrdinal, session.trimStartOrdinal])

  useEffect(() => {
    if (!project) return
    setStartTimecode(formatTimecode(secondsFor(project, session.trimStartOrdinal)))
    setEndTimecode(formatTimecode(inclusiveOutBoundarySeconds(project, session.trimEndOrdinal, duration)))
  }, [duration, project, session.trimEndOrdinal, session.trimStartOrdinal])

  useEffect(() => () => {
    if (preciseSeekTimerRef.current !== null) window.clearTimeout(preciseSeekTimerRef.current)
    if (previewSeekTimerRef.current !== null) window.clearTimeout(previewSeekTimerRef.current)
  }, [])

  useEffect(() => {
    let live = true
    setBusy(true)
    const loadProject = projectId ? getVideoProject(projectId) : createVideoProject(file)
    loadProject
      .then((created) => {
        if (!live) return
        setProject(created)
        dispatch({
          type: "HYDRATE",
          frameCount: created.frames.length,
          session: created.sessionState,
        })
        sessionHydrated.current = true
        onProjectReady?.(created)
      })
      .catch((reason) => live && setError(reason instanceof Error ? reason.message : "Unable to open project"))
      .finally(() => live && setBusy(false))
    return () => { live = false }
  }, [file, onProjectReady, projectId])

  useEffect(() => {
    if (!project || !sessionHydrated.current) return
    const revision = ++sessionSaveRevisionRef.current
    const last = project.frames.length - 1
    const start = Math.max(0, Math.min(last, session.trimStartOrdinal))
    const end = Math.max(start, Math.min(last, session.trimEndOrdinal))
    const current = Math.max(start, Math.min(end, session.currentOrdinal))
    const timeout = window.setTimeout(() => {
      sessionSaveQueueRef.current = sessionSaveQueueRef.current.then(() =>
        saveProjectSession(project.id, { currentOrdinal: current, trimStartOrdinal: start, trimEndOrdinal: end })
      ).then(() => {
        if (revision === sessionSaveRevisionRef.current) setSessionSaveError("")
      }).catch((reason) => {
        if (revision === sessionSaveRevisionRef.current) setSessionSaveError(reason instanceof Error ? reason.message : "Unable to save project position")
      })
    }, 250)
    return () => window.clearTimeout(timeout)
  }, [project, session.currentOrdinal, session.trimEndOrdinal, session.trimStartOrdinal])

  useEffect(() => {
    if (session.mode === "image" && editActivity !== openedActivity.current) {
      dispatch({ type: "MARK_DIRTY" })
    }
  }, [editActivity, session.mode])

  const seek = (ordinal: number) => {
    if (!project?.frames.length) return
    const bounded = Math.max(session.trimStartOrdinal, Math.min(session.trimEndOrdinal, ordinal))
    dispatch({ type: "SEEK", ordinal: bounded })
    if (videoRef.current) videoRef.current.currentTime = secondsFor(project, bounded)
  }

  const boundedOrdinal = (ordinal: number) =>
    Math.max(session.trimStartOrdinal, Math.min(session.trimEndOrdinal, ordinal))

  const requestNavigation = (ordinal: number) => {
    if (!project?.frames.length || busy) return
    const bounded = boundedOrdinal(ordinal)
    dispatch({ type: "REQUEST_NAVIGATE", ordinal: bounded })
    if (session.mode === "video" || !session.dirty) {
      if (videoRef.current) videoRef.current.currentTime = secondsFor(project, bounded)
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || busy ||
          target?.isContentEditable || target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault()
        requestNavigation(session.currentOrdinal + (event.key === "ArrowLeft" ? -1 : 1))
      } else if (event.key === " " && session.mode === "video") {
        event.preventDefault()
        if (videoRef.current?.paused) void videoRef.current.play()
        else videoRef.current?.pause()
      } else if (event.key === "[" && session.mode === "video") {
        event.preventDefault()
        dispatch({ type: "SET_TRIM", start: Math.min(session.currentOrdinal, Math.max(0, session.trimEndOrdinal - (project && project.frames.length > 1 ? 1 : 0))), end: session.trimEndOrdinal })
      } else if (event.key === "]" && session.mode === "video") {
        event.preventDefault()
        dispatch({ type: "SET_TRIM", start: session.trimStartOrdinal, end: Math.max(session.currentOrdinal, session.trimStartOrdinal + (project && project.frames.length > 1 ? 1 : 0)) })
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  })

  const nearestOrdinal = (time: number) => {
    if (!project) return session.currentOrdinal
    let nearest = session.currentOrdinal
    let distance = Number.POSITIVE_INFINITY
    project.frames.forEach((_frame, ordinal) => {
      const nextDistance = Math.abs(secondsFor(project, ordinal) - time)
      if (nextDistance < distance) {
        nearest = ordinal
        distance = nextDistance
      }
    })
    return nearest
  }

  const nearestOutOrdinal = (time: number) => {
    if (!project) return session.trimEndOrdinal
    return project.frames.reduce((nearest, _frame, candidate) =>
      Math.abs(inclusiveOutBoundarySeconds(project, candidate, duration) - time) <
        Math.abs(inclusiveOutBoundarySeconds(project, nearest, duration) - time) ? candidate : nearest, 0)
  }

  const applyTimecode = (boundary: "start" | "end", value: string) => {
    if (session.mode === "image") return
    const time = parseTimecode(value)
    if (time === null || time > duration) {
      setError("Enter a timecode within the video duration.")
      setStartTimecode(formatTimecode(secondsFor(project!, session.trimStartOrdinal)))
      setEndTimecode(formatTimecode(inclusiveOutBoundarySeconds(project!, session.trimEndOrdinal, duration)))
      return
    }
    setError("")
    const ordinal = boundary === "start" ? nearestOrdinal(time) : nearestOutOrdinal(time)
    const minimumGap = project && project.frames.length > 1 ? 1 : 0
    dispatch(boundary === "start"
      ? { type: "SET_TRIM", start: Math.min(ordinal, session.trimEndOrdinal - minimumGap), end: session.trimEndOrdinal }
      : { type: "SET_TRIM", start: session.trimStartOrdinal, end: Math.max(ordinal, session.trimStartOrdinal + minimumGap) })
  }

  const downloadTrim = async () => {
    setBusy(true)
    setError("")
    try {
      const blob = await trimVideo(file, trimStartSeconds, trimEndExportSeconds)
      const link = document.createElement("a")
      link.href = URL.createObjectURL(blob)
      link.download = `${file.name.replace(/\.[^.]+$/, "")}_trimmed.mp4`
      link.click()
      URL.revokeObjectURL(link.href)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to trim video")
    } finally {
      setBusy(false)
    }
  }

  const downloadCurrentFrame = async () => {
    setBusy(true)
    setError("")
    try {
      const frame = await getCurrentTargetFile()
      const link = document.createElement("a")
      link.href = URL.createObjectURL(frame)
      link.download = `${file.name.replace(/\.[^.]+$/, "")}_frame-${session.currentOrdinal + 1}.png`
      link.click()
      URL.revokeObjectURL(link.href)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to download this frame")
    } finally {
      setBusy(false)
    }
  }

  const openFrame = async (ordinal: number, edit?: FrameEdit, force = false) => {
    if (!project) return
    if (!force && session.mode === "image" && session.dirty) {
      dispatch({ type: "OPEN", ordinal, editId: edit?.id })
      return
    }
    setBusy(true)
    setError("")
    try {
      let frameFile: File
      if (edit?.renderUrl) {
        const response = await fetch(edit.renderUrl)
        if (!response.ok) throw new Error("Unable to reopen saved frame edit")
        frameFile = new File([await response.blob()], `frame-${ordinal}-edit.png`, { type: "image/png" })
      } else {
        frameFile = await getProjectFrame(project.id, ordinal)
      }
      videoRef.current?.pause()
      await setFile(frameFile)
      openedActivity.current = useStore.getState().editorState.renders.length
      dispatch({ type: "OPEN", ordinal, editId: edit?.id })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to open frame")
    } finally {
      setBusy(false)
    }
  }

  const refreshProject = async () => {
    if (project) setProject(await getVideoProject(project.id))
  }

  const saveAndReturn = async () => {
    if (!project) return
    setBusy(true)
    setError("")
    try {
      const render = await getCurrentTargetFile()
      await saveProjectFrameEdit(project.id, session.currentOrdinal, render, session.activeEditId)
      const queued = session.pending
      const refreshed = await getVideoProject(project.id)
      setProject(refreshed)
      dispatch({ type: "SAVE_COMPLETE" })
      if (queued?.kind === "open" && queued.ordinal !== undefined) {
        await openFrame(queued.ordinal, refreshed.frameEdits.find((item) => item.id === queued.editId), true)
      } else if (queued?.kind === "navigate" && queued.ordinal !== undefined) {
        seek(queued.ordinal)
      } else if (queued?.kind === "close") {
        onClose()
      } else if (queued?.kind === "delete-project") {
        setDeleteProjectRequested(true)
      } else {
        seek(session.currentOrdinal)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save frame edit")
    } finally {
      setBusy(false)
    }
  }

  const discard = async () => {
    const pending = session.pending
    dispatch({ type: "DISCARD" })
    if (pending?.kind === "open" && pending.ordinal !== undefined) {
      // State is clean after discard, so the queued frame can now hydrate.
      await openFrame(pending.ordinal, project?.frameEdits.find((item) => item.id === pending.editId), true)
    } else if (pending?.kind === "navigate" && pending.ordinal !== undefined) {
      seek(pending.ordinal)
    } else if (pending?.kind === "close") {
      onClose()
    } else if (pending?.kind === "delete-project") {
      setDeleteProjectRequested(true)
    } else {
      seek(session.currentOrdinal)
    }
  }

  if (busy && !project) {
    return <div className="absolute inset-0 flex items-center justify-center gap-3"><Loader2 className="animate-spin" />Preparing exact frames…</div>
  }
  if (!project) {
    return <div className="absolute inset-0 flex items-center justify-center text-destructive">{error || "Unable to open video project"}</div>
  }

  const currentSeconds = secondsFor(project, session.currentOrdinal)
  const trimStartSeconds = secondsFor(project, session.trimStartOrdinal)
  const trimEndSeconds = inclusiveOutBoundarySeconds(project, session.trimEndOrdinal, duration)
  const trimEndExportSeconds = trimEndSeconds
  const lastOrdinal = Math.max(0, project.frames.length - 1)
  const percentFor = (ordinal: number) => duration
    ? Math.max(0, Math.min(100, (secondsFor(project, ordinal) / duration) * 100))
    : (lastOrdinal ? (ordinal / lastOrdinal) * 100 : 0)
  const outPercent = duration
    ? Math.max(0, Math.min(100, (trimEndSeconds / duration) * 100))
    : percentFor(session.trimEndOrdinal)


  const ordinalAtPointer = (clientX: number) => {
    const bounds = timelineRef.current?.getBoundingClientRect()
    if (!bounds || !lastOrdinal) return 0
    const fraction = Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width))
    // Preserve the historical time-based timeline. Canonical ordinals are the
    // session boundary, not the visual coordinate system (important for VFR).
    return nearestOrdinal(fraction * duration)
  }

  const outOrdinalAtPointer = (clientX: number) => {
    const bounds = timelineRef.current?.getBoundingClientRect()
    if (!bounds || !lastOrdinal) return 0
    return nearestOutOrdinal(Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width)) * duration)
  }

  const updateTrimFromPointer = (clientX: number) => {
    if (session.mode === "image") return
    const ordinal = draggedTrimHandle.current === "end" ? outOrdinalAtPointer(clientX) : ordinalAtPointer(clientX)
    let start = trimStartRef.current
    let end = trimEndRef.current
    if (draggedTrimHandle.current === "start") {
      start = Math.min(ordinal, Math.max(0, end - (lastOrdinal > 0 ? 1 : 0)))
    } else if (draggedTrimHandle.current === "end") {
      end = Math.max(ordinal, Math.min(lastOrdinal, start + (lastOrdinal > 0 ? 1 : 0)))
    } else {
      return
    }
    trimStartRef.current = start
    trimEndRef.current = end
    currentOrdinalRef.current = Math.max(start, Math.min(end, currentOrdinalRef.current))
    dispatch({ type: "SET_TRIM", start, end })

    const boundary = draggedTrimHandle.current === "start" ? start : end
    pendingPreviewOrdinalRef.current = boundary
    const boundarySeconds = secondsFor(project, boundary)
    const movedFar = Math.abs(boundarySeconds - lastDraggedBoundaryRef.current) >= duration * LARGE_DRAG_FRACTION
    if (movedFar) precisionModeRef.current = false
    lastDraggedBoundaryRef.current = boundarySeconds
    if (previewSeekTimerRef.current === null) {
      const delay = Math.max(0, PREVIEW_SEEK_INTERVAL_MS - (performance.now() - lastPreviewSeekAtRef.current))
      previewSeekTimerRef.current = window.setTimeout(() => {
        previewSeekTimerRef.current = null
        lastPreviewSeekAtRef.current = performance.now()
        if (videoRef.current && project) {
          const exact = secondsFor(project, pendingPreviewOrdinalRef.current)
          videoRef.current.currentTime = precisionModeRef.current
            ? exact
            : Math.round(exact / FAST_PREVIEW_STEP_SECONDS) * FAST_PREVIEW_STEP_SECONDS
        }
      }, delay)
    }
    if (preciseSeekTimerRef.current !== null) window.clearTimeout(preciseSeekTimerRef.current)
    preciseSeekTimerRef.current = window.setTimeout(() => {
      if (draggedTrimHandle.current && videoRef.current && project) {
        precisionModeRef.current = true
        videoRef.current.currentTime = secondsFor(project, boundary)
      }
    }, PRECISE_SEEK_DELAY_MS)
  }

  const beginTrimDrag = (handle: "start" | "end", event: PointerEvent<HTMLButtonElement>) => {
    if (session.mode === "image") return
    event.preventDefault()
    event.stopPropagation()
    const timeline = timelineRef.current
    if (!timeline) return
    // Capture on the full timeline, as the original trim workspace did, so
    // vertical movement cannot escape into the app-wide drag/drop handler.
    timeline.setPointerCapture(event.pointerId)
    draggedTrimHandle.current = handle
    preDragCurrentRef.current = currentOrdinalRef.current
    lastDraggedBoundaryRef.current = secondsFor(project, handle === "start" ? trimStartRef.current : trimEndRef.current)
    precisionModeRef.current = false
    setDragging(handle)
    videoRef.current?.pause()
  }

  const finishTrimDrag = (event?: PointerEvent<HTMLDivElement>) => {
    if (!draggedTrimHandle.current) return
    draggedTrimHandle.current = null
    if (event?.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (preciseSeekTimerRef.current !== null) window.clearTimeout(preciseSeekTimerRef.current)
    if (previewSeekTimerRef.current !== null) window.clearTimeout(previewSeekTimerRef.current)
    preciseSeekTimerRef.current = null
    previewSeekTimerRef.current = null
    precisionModeRef.current = false
    setDragging(null)
    const restored = Math.max(trimStartRef.current, Math.min(trimEndRef.current, preDragCurrentRef.current))
    currentOrdinalRef.current = restored
    dispatch({ type: "SEEK", ordinal: restored })
    if (videoRef.current) videoRef.current.currentTime = secondsFor(project, restored)
  }

  const requestProjectExit = (kind: "close" | "delete-project") => {
    if (session.mode === "image" && session.dirty) {
      dispatch({ type: "REQUEST_EXIT", kind })
    } else if (kind === "close") {
      onClose()
    } else {
      setDeleteProjectRequested(true)
    }
  }

  return (
    <>
      <div className="fixed left-6 top-20 z-40 flex gap-2">
        <button className="rounded border bg-background/95 px-3 py-2 text-sm shadow" onClick={() => requestProjectExit("close")} type="button">
          <ChevronLeft className="mr-1 inline h-4 w-4" />Back to projects
        </button>
        <button className="rounded border border-destructive/50 bg-background/95 px-3 py-2 text-sm text-destructive shadow" onClick={() => requestProjectExit("delete-project")} type="button">
          <Trash2 className="mr-1 inline h-4 w-4" />Delete project
        </button>
      </div>
      {session.mode === "image" ? (
        <Workspace />
      ) : (
        <section className="absolute inset-x-6 bottom-52 top-20 flex flex-col">
          <video
            ref={videoRef}
            className="min-h-0 flex-1 rounded-lg bg-black object-contain"
            draggable={false}
            src={source}
            onLoadedMetadata={(event) => { setDuration(event.currentTarget.duration); event.currentTarget.currentTime = currentSeconds }}
            onPause={() => setPlaying(false)}
            onPlay={() => setPlaying(true)}
            onTimeUpdate={(event) => {
              // Boundary previews must not move the persisted playhead. The
              // pre-drag playhead is restored when pointer capture ends.
              if (!draggedTrimHandle.current) {
                dispatch({ type: "SEEK", ordinal: nearestOrdinal(event.currentTarget.currentTime) })
              }
            }}
          />
        </section>
      )}

      <section className="fixed inset-x-4 bottom-4 z-30 rounded-xl border bg-background/95 p-3 shadow-xl backdrop-blur md:inset-x-6">
        <div className="flex items-center gap-2">
          <button className="rounded bg-muted p-2 disabled:opacity-50" disabled={session.mode === "image"} onClick={() => videoRef.current?.paused ? videoRef.current.play() : videoRef.current?.pause()} type="button">
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <button aria-label="Previous exact frame" className="rounded bg-muted p-2 disabled:opacity-50" disabled={busy || session.currentOrdinal <= session.trimStartOrdinal} onClick={() => requestNavigation(session.currentOrdinal - 1)} type="button"><ChevronLeft className="h-4 w-4" /></button>
          <button aria-label="Next exact frame" className="rounded bg-muted p-2 disabled:opacity-50" disabled={busy || session.currentOrdinal >= session.trimEndOrdinal} onClick={() => requestNavigation(session.currentOrdinal + 1)} type="button"><ChevronRight className="h-4 w-4" /></button>
          <span className="min-w-0 truncate text-sm">Frame {session.currentOrdinal + 1} / {project.frames.length} · {currentSeconds.toFixed(3)}s</span>
          {session.mode === "video" ? (
            <button className="ml-auto flex items-center gap-2 rounded bg-primary px-3 py-2 text-sm text-primary-foreground" disabled={busy} onClick={() => openFrame(session.currentOrdinal)} type="button"><Edit3 className="h-4 w-4" />Edit frame</button>
          ) : (
            <>
              <button className="ml-auto rounded border px-3 py-2 text-sm" onClick={() => dispatch({ type: "REQUEST_RETURN" })} type="button"><Video className="mr-2 inline h-4 w-4" />Return to video</button>
              <button className="flex items-center gap-2 rounded border px-3 py-2 text-sm" disabled={busy} onClick={downloadCurrentFrame} type="button"><Download className="h-4 w-4" />Download frame</button>
              <button className="flex items-center gap-2 rounded bg-primary px-3 py-2 text-sm text-primary-foreground" disabled={busy} onClick={saveAndReturn} type="button"><Save className="h-4 w-4" />Save & return</button>
            </>
          )}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <label className="text-xs text-muted-foreground">In <input className="w-20 rounded border bg-background px-2 py-1 disabled:opacity-50" disabled={session.mode === "image"} max={Math.max(0, session.trimEndOrdinal - (lastOrdinal > 0 ? 1 : 0))} min={0} onChange={(event) => dispatch({ type: "SET_TRIM", start: Math.max(0, Math.min(Number(event.target.value), session.trimEndOrdinal - (lastOrdinal > 0 ? 1 : 0))), end: session.trimEndOrdinal })} type="number" value={session.trimStartOrdinal} /></label>
          <div
            aria-label="Exact frame timeline"
            className="relative mx-2 h-10 min-w-24 flex-1 cursor-pointer touch-none select-none"
            onDragStart={(event) => event.preventDefault()}
            onPointerDown={(event) => {
              if (!draggedTrimHandle.current) requestNavigation(ordinalAtPointer(event.clientX))
            }}
            onPointerMove={(event) => draggedTrimHandle.current && updateTrimFromPointer(event.clientX)}
            onPointerUp={finishTrimDrag}
            onPointerCancel={finishTrimDrag}
            onLostPointerCapture={finishTrimDrag}
            ref={timelineRef}
            role="slider"
            tabIndex={0}
            aria-valuemax={lastOrdinal}
            aria-valuemin={0}
            aria-valuenow={session.currentOrdinal}
          >
            <div className="absolute inset-x-0 top-3 h-2 rounded bg-muted" />
            <div className="absolute top-3 h-2 bg-primary/35" style={{ left: `${percentFor(session.trimStartOrdinal)}%`, right: `${100 - outPercent}%` }} />
            {project.frameEdits.map((edit) => (
              <button
                aria-label={`Open saved edit for frame ${edit.frameOrdinal + 1}`}
                className="absolute top-1 z-20 h-3 w-3 -translate-x-1/2 rounded-full border-2 border-background bg-amber-500 shadow"
                key={edit.id}
                onClick={(event) => { event.stopPropagation(); openFrame(edit.frameOrdinal, edit) }}
                style={{ left: `${percentFor(edit.frameOrdinal)}%` }}
                type="button"
              />
            ))}
            <div className="absolute top-2 h-4 w-0.5 -translate-x-1/2 bg-foreground" style={{ left: `${percentFor(session.currentOrdinal)}%` }} />
            {(["start", "end"] as const).map((handle) => {
              const ordinal = handle === "start" ? session.trimStartOrdinal : session.trimEndOrdinal
              return <button
                aria-label={`Drag trim ${handle} handle`}
                className="absolute top-0 z-30 h-10 w-4 -translate-x-1/2 cursor-ew-resize rounded bg-white shadow"
                key={handle}
                disabled={session.mode === "image"}
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => beginTrimDrag(handle, event)}
                style={{ left: `${handle === "end" ? outPercent : percentFor(ordinal)}%` }}
                type="button"
              />
            })}
          </div>
          <label className="text-xs text-muted-foreground">Out <input className="w-20 rounded border bg-background px-2 py-1 disabled:opacity-50" disabled={session.mode === "image"} max={project.frames.length - 1} min={Math.min(lastOrdinal, session.trimStartOrdinal + (lastOrdinal > 0 ? 1 : 0))} onChange={(event) => dispatch({ type: "SET_TRIM", start: session.trimStartOrdinal, end: Math.min(lastOrdinal, Math.max(Number(event.target.value), session.trimStartOrdinal + (lastOrdinal > 0 ? 1 : 0))) })} type="number" value={session.trimEndOrdinal} /></label>
          <span className="hidden text-xs text-muted-foreground lg:inline">Trim {trimStartSeconds.toFixed(3)}–{trimEndSeconds.toFixed(3)}s</span>
          <button aria-label="Trim original video" className="flex shrink-0 items-center gap-1 rounded border px-2 py-1.5 text-xs disabled:opacity-50" disabled={busy || !duration} onClick={downloadTrim} title="Downloads the trimmed original video. Saved frame edits are not composited into this Phase 1 output." type="button"><Download className="h-4 w-4" />Trim original video</button>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">Trim start
            <input aria-label="Trim start timecode" className="h-8 rounded border bg-background px-2 font-mono text-sm disabled:opacity-50" disabled={session.mode === "image"} onBlur={(event) => applyTimecode("start", event.currentTarget.value)} onChange={(event) => setStartTimecode(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur() }} value={startTimecode} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">Trim end
            <input aria-label="Trim end timecode" className="h-8 rounded border bg-background px-2 font-mono text-sm disabled:opacity-50" disabled={session.mode === "image"} onBlur={(event) => applyTimecode("end", event.currentTarget.value)} onChange={(event) => setEndTimecode(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur() }} value={endTimecode} />
          </label>
        </div>
        {project.frameEdits.length > 0 && <p className="mt-1 text-xs text-muted-foreground">Saved frame edits remain standalone images and are not included in the trimmed original video.</p>}
        {dragging && <p className="mt-1 text-xs text-muted-foreground">Adjusting trim {dragging}…</p>}
        {sessionSaveError && <p className="mt-1 text-xs text-destructive" role="status">Project position not saved: {sessionSaveError}</p>}
        <div className="mt-2 flex gap-2 overflow-x-auto border-t pt-2" aria-label="Frame edits">
          <span className="shrink-0 self-center text-xs font-medium">Frame Edit tray</span>
          {project.frameEdits.length === 0 && <span className="text-xs text-muted-foreground">Saved edits appear here.</span>}
          {project.frameEdits.map((edit) => (
            <div className="flex shrink-0 items-center rounded border bg-muted/50" key={edit.id}>
              <button className="px-3 py-1.5 text-xs" onClick={() => openFrame(edit.frameOrdinal, edit)} type="button">Frame {edit.frameOrdinal + 1}</button>
              <button aria-label={`Delete frame edit ${edit.frameOrdinal + 1}`} className="border-l p-1.5 text-destructive" onClick={() => setDeleteCandidate(edit)} type="button"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </section>

      {session.pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-lg border bg-background p-5 shadow-xl" role="alertdialog" aria-modal="true">
            <h2 className="font-semibold">Save this frame edit?</h2>
            <p className="mt-1 text-sm text-muted-foreground">You have unsaved image changes.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button className="rounded border px-3 py-2 text-sm" onClick={() => dispatch({ type: "KEEP_EDITING" })} type="button">Keep editing</button>
              <button className="rounded border px-3 py-2 text-sm" onClick={discard} type="button">Discard</button>
              <button className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground" onClick={saveAndReturn} type="button">Save</button>
            </div>
          </div>
        </div>
      )}

      <AlertDialog open={Boolean(deleteCandidate)} onOpenChange={(open) => !open && setDeleteCandidate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this frame edit?</AlertDialogTitle>
            <AlertDialogDescription>The saved edit for frame {(deleteCandidate?.frameOrdinal ?? 0) + 1} will be removed. The source video and trim range will not change.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={async () => {
              if (!deleteCandidate) return
              try {
                await deleteProjectFrameEdit(project.id, deleteCandidate.id)
                setDeleteCandidate(null)
                await refreshProject()
              } catch (reason) {
                setError(reason instanceof Error ? reason.message : "Unable to delete this frame edit")
              }
            }}>Delete frame edit</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteProjectRequested} onOpenChange={setDeleteProjectRequested}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this video project?</AlertDialogTitle>
            <AlertDialogDescription>The project will be removed from the project selector. Its data remains recoverable in project storage.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={async () => {
              try {
                setBusy(true)
                await deleteVideoProject(project.id)
                onClose()
              } catch (reason) {
                setError(reason instanceof Error ? reason.message : "Unable to delete this project")
              } finally {
                setBusy(false)
              }
            }}>Delete project</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
