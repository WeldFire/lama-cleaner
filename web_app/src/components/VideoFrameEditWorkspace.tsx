import { Check, ChevronLeft, ChevronRight, Download, Edit3, Loader2, Pause, Pencil, Play, Save, Trash2, Video, Volume2, VolumeX, X } from "lucide-react"
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type PointerEvent } from "react"

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
  discardDraftVideoProject,
  deleteProjectFrameEdit,
  deleteVideoProject,
  getProjectFrame,
  getVideoProject,
  saveProjectSession,
  saveProjectFrameEdit,
  renameVideoProject,
  type VideoProject,
} from "@/lib/projectApi"
import { useStore } from "@/lib/states"
import { blobToImage, generateMask } from "@/lib/utils"
import { trimVideo } from "@/lib/videoApi"
import { resolveVideoHotkey } from "@/lib/videoHotkeys"

const PRECISE_SEEK_DELAY_MS = 500
const PREVIEW_SEEK_INTERVAL_MS = 100
const LARGE_DRAG_FRACTION = 0.1
const FAST_PREVIEW_STEP_SECONDS = 0.25
const VIDEO_VOLUME_KEY = "iopaint.video-volume"
const VIDEO_MUTED_KEY = "iopaint.video-muted"

const editorSnapshot = (state: ReturnType<typeof useStore.getState>) => JSON.stringify({
  renders: state.editorState.renders.length,
  lines: state.editorState.lineGroups,
  currentLine: state.editorState.curLineGroup,
  extraMasks: state.editorState.extraMasks.map((mask) => mask.src),
  history: state.editorState.historyActions.length,
  brush: [state.editorState.baseBrushSize, state.editorState.brushSizeScale],
  crop: state.cropperState,
})

const storedVideoVolume = () => {
  const stored = Number(localStorage.getItem(VIDEO_VOLUME_KEY))
  return Number.isFinite(stored) && stored >= 0 && stored <= 1 ? stored : 1
}

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
  const [volume, setVolume] = useState(storedVideoVolume)
  const [muted, setMuted] = useState(() => localStorage.getItem(VIDEO_MUTED_KEY) === "true")
  const lastAudibleVolumeRef = useRef(volume > 0 ? volume : 1)
  const setFile = useStore((state) => state.setFile)
  const getCurrentTargetFile = useStore((state) => state.getCurrentTargetFile)
  const imageWidth = useStore((state) => state.imageWidth)
  const imageHeight = useStore((state) => state.imageHeight)
  const editorState = useStore((state) => state.editorState)
  const cropperState = useStore((state) => state.cropperState)
  const settings = useStore((state) => state.settings)
  const editActivity = useStore(editorSnapshot)
  const openedActivity = useRef("")
  const documentRevisionRef = useRef(0)
  const activeEditIdRef = useRef<string | null>(null)
  const frameEditSaveQueueRef = useRef(Promise.resolve())
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
  const [renamingProject, setRenamingProject] = useState(false)
  const [projectName, setProjectName] = useState("")
  const projectLifecycleRef = useRef<{ id: string; durable: boolean } | null>(null)

  useEffect(() => () => URL.revokeObjectURL(source), [source])

  useEffect(() => {
    if (volume > 0) lastAudibleVolumeRef.current = volume
    localStorage.setItem(VIDEO_VOLUME_KEY, String(volume))
    localStorage.setItem(VIDEO_MUTED_KEY, String(muted))
    if (videoRef.current) {
      videoRef.current.volume = volume
      videoRef.current.muted = muted
    }
  }, [muted, volume])

  const toggleMuted = () => {
    if (muted || volume === 0) {
      if (volume === 0) setVolume(lastAudibleVolumeRef.current)
      setMuted(false)
    } else {
      setMuted(true)
    }
  }

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
        projectLifecycleRef.current = { id: created.id, durable: created.durable }
        setProjectName(created.name)
        dispatch({
          type: "HYDRATE",
          frameCount: created.frames.length,
          session: created.sessionState,
        })
        sessionHydrated.current = true
        if (created.durable) onProjectReady?.(created)
      })
      .catch((reason) => live && setError(reason instanceof Error ? reason.message : "Unable to open project"))
      .finally(() => live && setBusy(false))
    return () => { live = false }
  }, [file, onProjectReady, projectId])

  useEffect(() => () => {
    const lifecycle = projectLifecycleRef.current
    if (lifecycle && !lifecycle.durable) {
      void discardDraftVideoProject(lifecycle.id, true).catch(() => undefined)
    }
  }, [])

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
      if (event.defaultPrevented || busy ||
          target?.isContentEditable || target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return
      const action = resolveVideoHotkey(session.mode, event.key, event.metaKey || event.ctrlKey || event.altKey)
      if (action === "previous-frame" || action === "next-frame") {
        event.preventDefault()
        requestNavigation(session.currentOrdinal + (action === "previous-frame" ? -1 : 1))
      } else if (action === "toggle-playback") {
        event.preventDefault()
        if (videoRef.current?.paused) void videoRef.current.play()
        else videoRef.current?.pause()
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

  const downloadCanonicalFrame = async () => {
    if (!project) return
    setBusy(true)
    setError("")
    try {
      const frame = await getProjectFrame(project.id, session.currentOrdinal)
      const link = document.createElement("a")
      link.href = URL.createObjectURL(frame)
      link.download = `${file.name.replace(/\.[^.]+$/, "")}_frame-${session.currentOrdinal + 1}.png`
      link.click()
      URL.revokeObjectURL(link.href)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save this frame")
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
      if (edit?.compatibility === "resumable" && edit.document && edit.maskUrl) {
        const maskResponse = await fetch(edit.maskUrl)
        if (!maskResponse.ok) throw new Error("Unable to restore the editable frame mask")
        const maskImage = await blobToImage(await maskResponse.blob())
        const document = edit.document
        const state = useStore.getState()
        state.updateAppState({ imageWidth: document.canvas.width, imageHeight: document.canvas.height })
        state.updateEditorState({
          baseBrushSize: document.tools.baseBrushSize,
          brushSizeScale: document.tools.brushSizeScale,
          // The persisted PNG is the authoritative composite; retaining the
          // vector commands in the document aids compatibility without applying
          // their pixels twice during subsequent edits.
          lineGroups: [],
          curLineGroup: [],
          extraMasks: [maskImage],
          prevExtraMasks: [],
          temporaryMasks: [],
        })
        state.setCropperX(document.crop.x)
        state.setCropperY(document.crop.y)
        state.setCropperWidth(document.crop.width)
        state.setCropperHeight(document.crop.height)
        state.updateSettings(document.operation.settings)
        const restoredModel = state.serverConfig.modelInfos.find((model) => model.name === document.operation.model)
        if (restoredModel) state.updateSettings({ model: restoredModel })
        documentRevisionRef.current = document.revision
        activeEditIdRef.current = edit.id
      } else {
        documentRevisionRef.current = 0
        activeEditIdRef.current = null
      }
      openedActivity.current = editorSnapshot(useStore.getState())
      // Flattened legacy edits are opened as a new editable copy so saving can
      // never overwrite the only surviving render from the older format.
      dispatch({ type: "OPEN", ordinal, editId: edit?.compatibility === "resumable" ? edit.id : undefined })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to open frame")
    } finally {
      setBusy(false)
    }
  }

  const refreshProject = async () => {
    if (project) setProject(await getVideoProject(project.id))
  }

  const persistCurrentDocument = useCallback(async () => {
    if (!project) throw new Error("Video project is unavailable")
    const render = await getCurrentTargetFile()
    // The PNG is the complete composite mask for robust recovery; the vector
    // commands are also retained so brush geometry remains editable on reopen.
    const maskCanvas = generateMask(
      imageWidth,
      imageHeight,
      [...editorState.lineGroups, editorState.curLineGroup],
      editorState.extraMasks
    )
    const maskBlob = await new Promise<Blob>((resolve, reject) => maskCanvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("Unable to serialize the editable mask")),
      "image/png"
    ))
    const mask = new File([maskBlob], `frame-${session.currentOrdinal + 1}-mask.png`, { type: "image/png" })
    const frameKey = project.frames[session.currentOrdinal]
    if (!frameKey) throw new Error("Canonical frame identity is unavailable")
    const documentBase = {
      schemaVersion: 2 as const,
      frameKey,
      canonicalImage: { ordinal: session.currentOrdinal },
      canvas: { width: imageWidth, height: imageHeight },
      crop: cropperState,
      mask: { format: "image/png" as const, coordinateSpace: "canvas" as const },
      lines: { committed: editorState.lineGroups, current: editorState.curLineGroup },
      tools: { baseBrushSize: editorState.baseBrushSize, brushSizeScale: editorState.brushSizeScale },
      operation: {
        kind: "image-edit" as const,
        model: settings.model.name,
        settings: {
          prompt: settings.prompt,
          negativePrompt: settings.negativePrompt,
          seed: settings.seed,
          cv2Radius: settings.cv2Radius,
          cv2Flag: settings.cv2Flag,
          sdStrength: settings.sdStrength,
        },
      },
    }
    // Revision and edit identity are reserved inside the queue. An autosave and
    // an immediate manual save therefore cannot race into duplicate revisions
    // or create two Frame Edits for the same initial document.
    const save = frameEditSaveQueueRef.current.then(async () => {
      const revision = documentRevisionRef.current + 1
      const saved = await saveProjectFrameEdit(
        project.id,
        session.currentOrdinal,
        render,
        { ...documentBase, revision },
        mask,
        activeEditIdRef.current
      )
      documentRevisionRef.current = revision
      activeEditIdRef.current = saved.id
      return saved
    })
    frameEditSaveQueueRef.current = save.then(() => undefined, () => undefined)
    return save
  }, [cropperState, editorState, getCurrentTargetFile, imageHeight, imageWidth, project, session.currentOrdinal, settings])

  const saveAndReturn = async () => {
    if (!project) return
    setBusy(true)
    setError("")
    try {
      await persistCurrentDocument()
      const queued = session.pending
      const refreshed = await getVideoProject(project.id)
      setProject(refreshed)
      projectLifecycleRef.current = { id: refreshed.id, durable: refreshed.durable }
      onProjectReady?.(refreshed)
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

  useEffect(() => {
    if (session.mode !== "image" || !session.dirty || busy) return
    const savedSnapshot = editActivity
    const timeout = window.setTimeout(() => {
      void persistCurrentDocument().then(async (saved) => {
        const refreshed = project ? await getVideoProject(project.id) : null
        if (refreshed) {
          setProject(refreshed)
          projectLifecycleRef.current = { id: refreshed.id, durable: refreshed.durable }
          onProjectReady?.(refreshed)
        }
        // Persisting does not reset the editor store, so its undo/redo history
        // remains available for as long as this Frame Edit stays mounted.
        if (editorSnapshot(useStore.getState()) === savedSnapshot) {
          openedActivity.current = savedSnapshot
          dispatch({ type: "AUTOSAVE_COMPLETE", editId: saved.id })
        }
      }).catch((reason) => {
        setError(reason instanceof Error ? `Frame Edit autosave failed: ${reason.message}` : "Frame Edit autosave failed")
      })
    }, 1500)
    return () => window.clearTimeout(timeout)
  }, [busy, editActivity, onProjectReady, persistCurrentDocument, project, session.dirty, session.mode])

  const discard = async () => {
    const pending = session.pending
    dispatch({ type: "DISCARD" })
    if (pending?.kind === "open" && pending.ordinal !== undefined) {
      // State is clean after discard, so the queued frame can now hydrate.
      await openFrame(pending.ordinal, project?.frameEdits.find((item) => item.id === pending.editId), true)
    } else if (pending?.kind === "navigate" && pending.ordinal !== undefined) {
      seek(pending.ordinal)
    } else if (pending?.kind === "close") {
      await closeProject()
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
      void closeProject()
    } else {
      setDeleteProjectRequested(true)
    }
  }

  const closeProject = async () => {
    if (project && !project.durable) {
      projectLifecycleRef.current = null
      try {
        await discardDraftVideoProject(project.id)
      } catch {
        // Draft cleanup is best-effort; it is never exposed in Recent Projects.
      }
    }
    onClose()
  }

  const saveProjectName = async () => {
    if (!project) return
    const normalized = projectName.trim()
    if (!normalized || normalized === project.name) {
      setProjectName(project.name)
      setRenamingProject(false)
      return
    }
    try {
      setBusy(true)
      const renamed = await renameVideoProject(project.id, normalized)
      setProject(renamed)
      projectLifecycleRef.current = { id: renamed.id, durable: renamed.durable }
      setProjectName(renamed.name)
      if (renamed.durable) onProjectReady?.(renamed)
      setRenamingProject(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to rename this project")
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="fixed left-6 top-20 z-40 flex gap-2">
        <button className="rounded border bg-background/95 px-3 py-2 text-sm shadow" onClick={() => requestProjectExit("close")} type="button">
          <ChevronLeft className="mr-1 inline h-4 w-4" />Back to projects
        </button>
        <button className="rounded border border-red-500 bg-red-950 px-3 py-2 text-sm font-medium text-red-100 shadow hover:bg-red-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400" onClick={() => requestProjectExit("delete-project")} type="button">
          <Trash2 className="mr-1 inline h-4 w-4" />Delete project
        </button>
        {renamingProject ? (
          <form className="flex items-center rounded border bg-background/95 shadow" onSubmit={(event) => { event.preventDefault(); void saveProjectName() }}>
            <label className="sr-only" htmlFor="active-project-name">Project name</label>
            <input autoFocus className="w-56 bg-transparent px-3 py-2 text-sm outline-none" id="active-project-name" maxLength={120} onChange={(event) => setProjectName(event.target.value)} value={projectName} />
            <button aria-label="Save project name" className="p-2 text-emerald-500" disabled={busy} type="submit"><Check className="h-4 w-4" /></button>
            <button aria-label="Cancel project rename" className="p-2 text-muted-foreground" onClick={() => { setProjectName(project.name); setRenamingProject(false) }} type="button"><X className="h-4 w-4" /></button>
          </form>
        ) : (
          <button className="rounded border bg-background/95 px-3 py-2 text-sm shadow hover:bg-accent" onClick={() => setRenamingProject(true)} type="button">
            <Pencil className="mr-1 inline h-4 w-4" />{project.name}
          </button>
        )}
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
            onLoadedMetadata={(event) => { setDuration(event.currentTarget.duration); event.currentTarget.currentTime = currentSeconds; event.currentTarget.volume = volume; event.currentTarget.muted = muted }}
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
            <>
              <div className="ml-auto flex items-center gap-2 text-sm">
                <button aria-label={muted || volume === 0 ? "Unmute video" : "Mute video"} className="rounded p-1 hover:bg-muted" onClick={toggleMuted} type="button">
                  {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </button>
                <input aria-label="Video volume" className="w-24 accent-blue-500" max="1" min="0" onChange={(event) => { const next = Number(event.target.value); setVolume(next); if (videoRef.current) videoRef.current.volume = next }} step="0.05" type="range" value={volume} />
              </div>
              <button className="flex items-center gap-2 rounded border px-3 py-2 text-sm" disabled={busy} onClick={downloadCanonicalFrame} type="button"><Download className="h-4 w-4" />Save Frame</button>
              <button className="flex items-center gap-2 rounded bg-primary px-3 py-2 text-sm text-primary-foreground" disabled={busy} onClick={() => openFrame(session.currentOrdinal)} type="button"><Edit3 className="h-4 w-4" />Edit frame</button>
            </>
          ) : (
            <>
              <button className="ml-auto rounded border px-3 py-2 text-sm" onClick={() => dispatch({ type: "REQUEST_RETURN" })} type="button"><Video className="mr-2 inline h-4 w-4" />Return to video</button>
              <button className="flex items-center gap-2 rounded border px-3 py-2 text-sm" disabled={busy} onClick={downloadCurrentFrame} type="button"><Download className="h-4 w-4" />Download frame</button>
              <button className="flex items-center gap-2 rounded bg-primary px-3 py-2 text-sm text-primary-foreground" disabled={busy} onClick={saveAndReturn} type="button"><Save className="h-4 w-4" />Save & return</button>
            </>
          )}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <label className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">Trim start <input aria-label="Trim start timecode" className="w-28 rounded border bg-background px-2 py-1 font-mono disabled:opacity-50" disabled={session.mode === "image"} onBlur={(event) => applyTimecode("start", event.currentTarget.value)} onChange={(event) => setStartTimecode(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur() }} value={startTimecode} /></label>
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
            <div className="absolute top-3 h-2 bg-blue-600" style={{ left: `${percentFor(session.trimStartOrdinal)}%`, right: `${100 - outPercent}%` }} />
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
          <label className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">Trim end <input aria-label="Trim end timecode" className="w-28 rounded border bg-background px-2 py-1 font-mono disabled:opacity-50" disabled={session.mode === "image"} onBlur={(event) => applyTimecode("end", event.currentTarget.value)} onChange={(event) => setEndTimecode(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur() }} value={endTimecode} /></label>
          <button aria-label="Download Trimmed Video" className="flex shrink-0 items-center gap-1 rounded border px-2 py-1.5 text-xs disabled:opacity-50" disabled={busy || !duration} onClick={downloadTrim} title="Downloads the trimmed original video. Saved frame edits are not composited into this Phase 1 output." type="button"><Download className="h-4 w-4" />Download Trimmed Video</button>
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
              {edit.compatibility === "flattened" && <span className="pr-2 text-[10px] text-muted-foreground" title="This older render remains untouched; saving opens it as a new resumable Frame Edit.">Legacy render · copies on save</span>}
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
