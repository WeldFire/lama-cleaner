// PROTOTYPE — throwaway UI for ticket "Workspace round-trip interaction".
// Three variants on the existing video workspace, switchable via ?variant=.
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Edit3,
  Pause,
  Play,
  Save,
  Trash2,
  X,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

type Variant = "A" | "B" | "C"
type FrameEdit = { timestamp: number; label: string }
type Mode = "video" | "image"

const VARIANTS: Array<{ key: Variant; name: string }> = [
  { key: "A", name: "Explicit handoff" },
  { key: "B", name: "Persistent timeline" },
  { key: "C", name: "Frame tray" },
]

const timecode = (seconds: number) => {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${(seconds % 60).toFixed(2).padStart(5, "0")}`
}

function PrototypeSwitcher({ variant, onChange }: { variant: Variant; onChange: (next: Variant) => void }) {
  const index = VARIANTS.findIndex((item) => item.key === variant)
  const cycle = (offset: number) => onChange(VARIANTS[(index + offset + VARIANTS.length) % VARIANTS.length].key)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target.matches("input, textarea, [contenteditable=true]")) return
      if (event.key === "ArrowLeft") cycle(-1)
      if (event.key === "ArrowRight") cycle(1)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  })

  return (
    <div className="fixed bottom-3 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-3 rounded-full bg-slate-950 px-3 py-2 text-white shadow-2xl ring-1 ring-white/20">
      <button aria-label="Previous prototype" className="rounded-full p-1 hover:bg-white/15" onClick={() => cycle(-1)}>
        <ChevronLeft className="h-5 w-5" />
      </button>
      <span className="min-w-40 text-center text-xs font-semibold">{variant} — {VARIANTS[index].name}</span>
      <button aria-label="Next prototype" className="rounded-full p-1 hover:bg-white/15" onClick={() => cycle(1)}>
        <ChevronRight className="h-5 w-5" />
      </button>
    </div>
  )
}

export default function VideoFrameRoundTripPrototype({ file }: { file: File }) {
  const video = useRef<HTMLVideoElement>(null)
  const source = useMemo(() => URL.createObjectURL(file), [file])
  const requestedVariant = new URLSearchParams(window.location.search).get("variant")
  const [variant, setVariant] = useState<Variant>(requestedVariant === "B" || requestedVariant === "C" ? requestedVariant : "A")
  const [mode, setMode] = useState<Mode>("video")
  const [duration, setDuration] = useState(0)
  const [current, setCurrent] = useState(0)
  const [trimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(0)
  const [wasPlaying, setWasPlaying] = useState(false)
  const [activeTimestamp, setActiveTimestamp] = useState<number | null>(null)
  const [dirty, setDirty] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [showLeaveGuard, setShowLeaveGuard] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<number | null>(null)
  const [edits, setEdits] = useState<FrameEdit[]>([
    { timestamp: 2.4, label: "Frame 1" },
    { timestamp: 7.85, label: "Frame 2" },
  ])

  useEffect(() => () => URL.revokeObjectURL(source), [source])

  const changeVariant = (next: Variant) => {
    const url = new URL(window.location.href)
    url.searchParams.set("prototype", "frame-round-trip")
    url.searchParams.set("variant", next)
    window.history.replaceState({}, "", url)
    setVariant(next)
  }

  const openFrame = (timestamp = video.current?.currentTime ?? current) => {
    const element = video.current
    setWasPlaying(Boolean(element && !element.paused))
    element?.pause()
    if (element) element.currentTime = timestamp
    setCurrent(timestamp)
    setActiveTimestamp(timestamp)
    setDirty(false)
    setMode("image")
  }

  const saveFrame = () => {
    if (activeTimestamp === null) return
    setProcessing(true)
    window.setTimeout(() => {
      setEdits((items) => {
        const others = items.filter((item) => Math.abs(item.timestamp - activeTimestamp) > 0.005)
        return [...others, { timestamp: activeTimestamp, label: `Frame ${others.length + 1}` }].sort((a, b) => a.timestamp - b.timestamp)
      })
      setDirty(false)
      setProcessing(false)
      setMode("video")
    }, 650)
  }

  const discardAndReturn = () => {
    setDirty(false)
    setShowLeaveGuard(false)
    setMode("video")
  }

  const requestReturn = () => dirty ? setShowLeaveGuard(true) : setMode("video")

  const seek = (timestamp: number) => {
    if (video.current) video.current.currentTime = timestamp
    setCurrent(timestamp)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target.matches("input, textarea, [contenteditable=true]")) return
      if (mode === "video" && event.key.toLowerCase() === "e") openFrame()
      if (mode === "image" && event.key === "Escape") requestReturn()
      if (mode === "image" && event.key.toLowerCase() === "s" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        saveFrame()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  })

  const media = (
    <video
      ref={video}
      className="h-full min-h-0 w-full rounded-lg bg-black object-contain"
      draggable={false}
      src={source}
      onLoadedMetadata={(event) => {
        setDuration(event.currentTarget.duration)
        setTrimEnd(event.currentTarget.duration)
      }}
      onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
    />
  )

  const timeline = (
    <div className="rounded-lg border bg-background p-3">
      <div className="mb-2 flex items-center gap-2 text-xs">
        <button className="rounded bg-muted p-2" onClick={() => video.current?.paused ? video.current.play() : video.current?.pause()}>
          {video.current?.paused === false ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <span>{timecode(current)}</span>
        <span className="text-muted-foreground">Trim {timecode(trimStart)}–{timecode(trimEnd)}</span>
        <span className="ml-auto hidden text-muted-foreground sm:block">Frame markers are diamonds</span>
      </div>
      <div className="relative h-10">
        <input className="absolute inset-x-0 top-2 w-full accent-blue-500" max={duration || 1} min={0} step="0.01" type="range" value={current} onChange={(event) => seek(Number(event.target.value))} />
        {edits.map((edit) => (
          <button
            aria-label={`Open edit at ${timecode(edit.timestamp)}`}
            className="absolute top-0 h-3 w-3 -translate-x-1/2 rotate-45 bg-amber-400 ring-2 ring-background"
            key={edit.timestamp}
            style={{ left: `${duration ? edit.timestamp / duration * 100 : 0}%` }}
            onClick={() => openFrame(edit.timestamp)}
          />
        ))}
      </div>
    </div>
  )

  const editorCanvas = (
    <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg bg-[radial-gradient(circle_at_center,_#334155,_#020617)]">
      <div className="relative aspect-video w-[82%] rounded border border-white/20 bg-slate-800 shadow-2xl">
        <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">Decoded frame at {timecode(activeTimestamp ?? current)}</div>
        <button className="absolute left-[46%] top-[38%] h-24 w-24 rounded-full border-4 border-dashed border-rose-400/80 bg-rose-400/20" onClick={() => setDirty(true)} aria-label="Simulate a mask stroke" />
      </div>
      <div className="absolute left-3 top-3 rounded bg-black/70 px-3 py-2 text-xs text-white">Click the red mask to simulate an edit</div>
    </div>
  )

  const editorTools = (
    <aside className="flex gap-2 rounded-lg border bg-background p-2 sm:w-44 sm:flex-col">
      {['Brush', 'Erase', 'Crop', 'Inpaint'].map((tool) => <button className="rounded border px-3 py-2 text-left text-xs hover:bg-accent" key={tool} onClick={() => setDirty(true)}>{tool}</button>)}
    </aside>
  )

  const editHeader = (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-background p-2">
      <button className="flex items-center gap-2 rounded px-3 py-2 text-sm hover:bg-accent" onClick={requestReturn}><ArrowLeft className="h-4 w-4" /> Back to video</button>
      <span className="text-xs text-muted-foreground">Frame {timecode(activeTimestamp ?? current)} · Trim preserved</span>
      {dirty && <span className="rounded-full bg-amber-500/15 px-2 py-1 text-xs text-amber-500">Unsaved changes</span>}
      <button className="ml-auto flex items-center gap-2 rounded bg-primary px-3 py-2 text-xs text-primary-foreground disabled:opacity-50" disabled={processing} onClick={saveFrame}><Save className="h-4 w-4" />{processing ? "Saving…" : "Save & return"}</button>
    </div>
  )

  const frameTray = (
    <aside className="flex w-full gap-2 overflow-x-auto rounded-lg border bg-background p-2 md:w-56 md:flex-col">
      <button className="min-w-32 rounded border border-dashed p-3 text-left text-xs" onClick={() => openFrame()}>+ Capture current frame</button>
      {edits.map((edit) => (
        <div className="flex min-w-36 items-center gap-2 rounded border p-2" key={edit.timestamp}>
          <button className="flex-1 text-left text-xs" onClick={() => openFrame(edit.timestamp)}><strong>{edit.label}</strong><br />{timecode(edit.timestamp)}</button>
          <button aria-label={`Delete ${edit.label}`} onClick={() => setPendingDelete(edit.timestamp)}><Trash2 className="h-4 w-4 text-muted-foreground" /></button>
        </div>
      ))}
    </aside>
  )

  const VariantA = () => mode === "video" ? (
    <div className="flex h-full flex-col gap-3">
      <div className="relative min-h-0 flex-1">{media}<button className="absolute bottom-4 right-4 flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-xl" onClick={() => openFrame()}><Edit3 className="h-4 w-4" />Edit current frame <kbd className="rounded bg-black/25 px-1">E</kbd></button></div>
      {timeline}
    </div>
  ) : <div className="flex h-full flex-col gap-3">{editHeader}<div className="flex min-h-0 flex-1 flex-col gap-2 sm:flex-row">{editorTools}{editorCanvas}</div></div>

  const VariantB = () => (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><button className="rounded px-2 py-1 hover:bg-accent" onClick={() => mode === "image" && requestReturn()}>Video</button><ChevronRight className="h-3 w-3" />{mode === "image" ? `Editing ${timecode(activeTimestamp ?? current)}` : "Playback"}</div>
      <div className="min-h-0 flex-1">{mode === "video" ? <div className="relative h-full">{media}<button className="absolute right-4 top-4 rounded-full bg-blue-600 p-3 text-white shadow-xl" onClick={() => openFrame()} aria-label="Edit current frame"><Edit3 /></button></div> : <div className="flex h-full flex-col gap-2 sm:flex-row">{editorCanvas}{editorTools}</div>}</div>
      {mode === "image" && <div className="flex items-center gap-2 rounded border bg-background px-3 py-2 text-xs"><CircleDot className="h-4 w-4 text-blue-500" />Timeline stays available while editing<button className="ml-auto rounded px-3 py-1 hover:bg-accent" onClick={requestReturn}>Cancel</button><button className="rounded bg-primary px-3 py-1 text-primary-foreground" onClick={saveFrame}>Commit frame</button></div>}
      {timeline}
    </div>
  )

  const VariantC = () => (
    <div className="flex h-full flex-col gap-3 md:flex-row">
      {frameTray}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        {mode === "video" ? <><div className="min-h-0 flex-1">{media}</div>{timeline}</> : <>{editHeader}<div className="flex min-h-0 flex-1 flex-col gap-2 sm:flex-row">{editorCanvas}{editorTools}</div></>}
      </div>
    </div>
  )

  const debugState = { variant, mode, current: Number(current.toFixed(2)), trim: [Number(trimStart.toFixed(2)), Number(trimEnd.toFixed(2))], activeTimestamp, dirty, processing, wasPlaying, edits }

  return (
    <section className="absolute inset-x-3 bottom-14 top-20 sm:inset-x-6">
      {variant === "A" ? <VariantA /> : variant === "B" ? <VariantB /> : <VariantC />}
      <details className="fixed right-3 top-20 z-50 max-w-xs rounded border bg-background/95 p-2 text-[10px] shadow-xl">
        <summary className="cursor-pointer font-semibold">Prototype state</summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap">{JSON.stringify(debugState, null, 2)}</pre>
      </details>
      {showLeaveGuard && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"><div className="w-full max-w-md rounded-lg border bg-background p-5 shadow-2xl"><h2 className="font-semibold">Save this Frame Edit?</h2><p className="mt-2 text-sm text-muted-foreground">You have changes at {timecode(activeTimestamp ?? current)}. Your video position and Trim Range are safe.</p><div className="mt-5 flex justify-end gap-2"><button className="rounded px-3 py-2 text-sm" onClick={() => setShowLeaveGuard(false)}>Keep editing</button><button className="rounded border px-3 py-2 text-sm" onClick={discardAndReturn}>Discard</button><button className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground" onClick={() => { setShowLeaveGuard(false); saveFrame() }}>Save & return</button></div></div></div>}
      {pendingDelete !== null && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"><div className="w-full max-w-sm rounded-lg border bg-background p-5"><div className="flex items-center justify-between"><h2 className="font-semibold">Remove Frame Edit?</h2><button onClick={() => setPendingDelete(null)}><X className="h-4 w-4" /></button></div><p className="mt-2 text-sm text-muted-foreground">The original video frame is never changed.</p><button className="mt-5 w-full rounded bg-destructive px-3 py-2 text-sm text-destructive-foreground" onClick={() => { setEdits((items) => items.filter((item) => item.timestamp !== pendingDelete)); setPendingDelete(null) }}>Remove edit</button></div></div>}
      {import.meta.env.DEV && <PrototypeSwitcher variant={variant} onChange={changeVariant} />}
    </section>
  )
}
