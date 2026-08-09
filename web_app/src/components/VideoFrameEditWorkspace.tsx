import { ChevronLeft, ChevronRight, Download, Edit3, Loader2, Pause, Play, Save, Trash2, Video } from "lucide-react"
import { useEffect, useMemo, useReducer, useRef, useState } from "react"

import Workspace from "@/components/Workspace"
import { reduceFrameEditSession, createFrameEditSession, type FrameEdit } from "@/lib/frameEditSession"
import {
  createVideoProject,
  deleteProjectFrameEdit,
  getProjectFrame,
  getVideoProject,
  saveProjectFrameEdit,
  type VideoProject,
} from "@/lib/projectApi"
import { useStore } from "@/lib/states"
import { trimVideo } from "@/lib/videoApi"

const secondsFor = (project: VideoProject, ordinal: number) => {
  const frame = project.frames[ordinal]
  if (!frame) return 0
  const denominator = Number(frame.projectTimeDen)
  return denominator ? Number(frame.projectTimeNum) / denominator : 0
}

export default function VideoFrameEditWorkspace({ file, onClose }: { file: File; onClose: () => void }) {
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

  useEffect(() => () => URL.revokeObjectURL(source), [source])

  useEffect(() => {
    let live = true
    setBusy(true)
    createVideoProject(file)
      .then((created) => {
        if (!live) return
        setProject(created)
        dispatch({ type: "HYDRATE", frameCount: created.frames.length })
      })
      .catch((reason) => live && setError(reason instanceof Error ? reason.message : "Unable to open project"))
      .finally(() => live && setBusy(false))
    return () => { live = false }
  }, [file])

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

  const downloadTrim = async () => {
    setBusy(true)
    setError("")
    try {
      const blob = await trimVideo(file, trimStartSeconds, trimEndSeconds)
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
  const trimEndSeconds = secondsFor(project, session.trimEndOrdinal)

  return (
    <>
      {session.mode === "image" ? (
        <Workspace />
      ) : (
        <section className="absolute inset-x-6 bottom-52 top-20 flex flex-col">
          <video
            ref={videoRef}
            className="min-h-0 flex-1 rounded-lg bg-black object-contain"
            draggable={false}
            src={source}
            onLoadedMetadata={(event) => { event.currentTarget.currentTime = currentSeconds }}
            onPause={() => setPlaying(false)}
            onPlay={() => setPlaying(true)}
            onTimeUpdate={(event) => dispatch({ type: "SEEK", ordinal: nearestOrdinal(event.currentTarget.currentTime) })}
          />
        </section>
      )}

      <section className="fixed inset-x-4 bottom-4 z-30 rounded-xl border bg-background/95 p-3 shadow-xl backdrop-blur md:inset-x-6">
        <div className="flex items-center gap-2">
          <button className="rounded bg-muted p-2 disabled:opacity-50" disabled={session.mode === "image"} onClick={() => videoRef.current?.paused ? videoRef.current.play() : videoRef.current?.pause()} type="button">
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <button aria-label="Previous exact frame" className="rounded bg-muted p-2" onClick={() => seek(session.currentOrdinal - 1)} type="button"><ChevronLeft className="h-4 w-4" /></button>
          <button aria-label="Next exact frame" className="rounded bg-muted p-2" onClick={() => seek(session.currentOrdinal + 1)} type="button"><ChevronRight className="h-4 w-4" /></button>
          <span className="min-w-0 truncate text-sm">Frame {session.currentOrdinal + 1} / {project.frames.length} · {currentSeconds.toFixed(3)}s</span>
          {session.mode === "video" ? (
            <button className="ml-auto flex items-center gap-2 rounded bg-primary px-3 py-2 text-sm text-primary-foreground" disabled={busy} onClick={() => openFrame(session.currentOrdinal)} type="button"><Edit3 className="h-4 w-4" />Edit frame</button>
          ) : (
            <>
              <button className="ml-auto rounded border px-3 py-2 text-sm" onClick={() => dispatch({ type: "REQUEST_RETURN" })} type="button"><Video className="mr-2 inline h-4 w-4" />Return to video</button>
              <button className="flex items-center gap-2 rounded bg-primary px-3 py-2 text-sm text-primary-foreground" disabled={busy} onClick={saveAndReturn} type="button"><Save className="h-4 w-4" />Save & return</button>
            </>
          )}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <label className="text-xs text-muted-foreground">In <input className="w-20 rounded border bg-background px-2 py-1" max={session.trimEndOrdinal} min={0} onChange={(event) => dispatch({ type: "SET_TRIM", start: Number(event.target.value), end: session.trimEndOrdinal })} type="number" value={session.trimStartOrdinal} /></label>
          <input aria-label="Exact frame timeline" className="min-w-24 flex-1" max={Math.max(0, project.frames.length - 1)} min={0} onChange={(event) => seek(Number(event.target.value))} step={1} type="range" value={session.currentOrdinal} />
          <label className="text-xs text-muted-foreground">Out <input className="w-20 rounded border bg-background px-2 py-1" max={project.frames.length - 1} min={session.trimStartOrdinal} onChange={(event) => dispatch({ type: "SET_TRIM", start: session.trimStartOrdinal, end: Number(event.target.value) })} type="number" value={session.trimEndOrdinal} /></label>
          <span className="hidden text-xs text-muted-foreground lg:inline">Trim {trimStartSeconds.toFixed(3)}–{trimEndSeconds.toFixed(3)}s</span>
          <button aria-label="Download trimmed video" className="rounded border p-1.5 disabled:opacity-50" disabled={busy} onClick={downloadTrim} type="button"><Download className="h-4 w-4" /></button>
        </div>
        <div className="mt-2 flex gap-2 overflow-x-auto border-t pt-2" aria-label="Frame edits">
          <span className="shrink-0 self-center text-xs font-medium">Frame Edit tray</span>
          {project.frameEdits.length === 0 && <span className="text-xs text-muted-foreground">Saved edits appear here.</span>}
          {project.frameEdits.map((edit) => (
            <div className="flex shrink-0 items-center rounded border bg-muted/50" key={edit.id}>
              <button className="px-3 py-1.5 text-xs" onClick={() => openFrame(edit.frameOrdinal, edit)} type="button">Frame {edit.frameOrdinal + 1}</button>
              <button aria-label={`Delete frame edit ${edit.frameOrdinal + 1}`} className="border-l p-1.5 text-destructive" onClick={async () => { await deleteProjectFrameEdit(project.id, edit.id); await refreshProject() }} type="button"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
          <button className="ml-auto shrink-0 text-xs text-muted-foreground" onClick={onClose} type="button">Close project</button>
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
    </>
  )
}
