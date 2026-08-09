// PROTOTYPE — throwaway UI for "Tracking and correction interaction".
// Three variants on the existing video workspace, switchable via ?variant=.
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  StopCircle,
  Pause,
  Play,
  ScanSearch,
  Sparkles,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

type Variant = "A" | "B" | "C"
type JobStatus = "idle" | "running" | "cancelled" | "complete" | "stale"
type Correction = { timestamp: number; kind: "seed" | "correction" }

const VARIANTS: Array<{ key: Variant; name: string }> = [
  { key: "A", name: "Timeline first" },
  { key: "B", name: "Guided steps" },
  { key: "C", name: "Filmstrip review" },
]

const timecode = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(2).padStart(5, "0")}`

function Switcher({ variant, onChange }: { variant: Variant; onChange: (variant: Variant) => void }) {
  const index = VARIANTS.findIndex((item) => item.key === variant)
  const cycle = (offset: number) => onChange(VARIANTS[(index + offset + VARIANTS.length) % VARIANTS.length].key)
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target.matches("input, textarea, [contenteditable=true]")) return
      if (event.key === "ArrowLeft") cycle(-1)
      if (event.key === "ArrowRight") cycle(1)
    }
    window.addEventListener("keydown", listener)
    return () => window.removeEventListener("keydown", listener)
  })
  return <div className="fixed bottom-3 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-3 rounded-full bg-slate-950 px-3 py-2 text-white shadow-2xl ring-1 ring-white/20">
    <button aria-label="Previous prototype" className="rounded-full p-1 hover:bg-white/15" onClick={() => cycle(-1)}><ChevronLeft className="h-5 w-5" /></button>
    <span className="min-w-40 text-center text-xs font-semibold">{variant} — {VARIANTS[index].name}</span>
    <button aria-label="Next prototype" className="rounded-full p-1 hover:bg-white/15" onClick={() => cycle(1)}><ChevronRight className="h-5 w-5" /></button>
  </div>
}

export default function TrackingCorrectionPrototype({ file }: { file: File }) {
  const video = useRef<HTMLVideoElement>(null)
  const source = useMemo(() => URL.createObjectURL(file), [file])
  const queryVariant = new URLSearchParams(window.location.search).get("variant")
  const [variant, setVariant] = useState<Variant>(queryVariant === "B" || queryVariant === "C" ? queryVariant : "A")
  const [duration, setDuration] = useState(0)
  const [current, setCurrent] = useState(0)
  const [range, setRange] = useState<[number, number]>([0, 0])
  const [corrections, setCorrections] = useState<Correction[]>([])
  const [job, setJob] = useState<JobStatus>("idle")
  const [progress, setProgress] = useState(0)
  const [invalidated, setInvalidated] = useState<[number, number] | null>(null)
  const [approved, setApproved] = useState(false)
  const [showMask, setShowMask] = useState(true)

  useEffect(() => () => URL.revokeObjectURL(source), [source])
  useEffect(() => {
    if (job !== "running") return
    const timer = window.setInterval(() => setProgress((value) => {
      const next = Math.min(100, value + 4)
      if (next === 100) setJob("complete")
      return next
    }), 180)
    return () => window.clearInterval(timer)
  }, [job])

  const changeVariant = (next: Variant) => {
    const url = new URL(window.location.href)
    url.searchParams.set("prototype", "tracking-correction")
    url.searchParams.set("variant", next)
    window.history.replaceState({}, "", url)
    setVariant(next)
  }

  const seek = (value: number) => {
    if (video.current) video.current.currentTime = value
    setCurrent(value)
  }

  const ensureSeed = () => {
    const timestamp = Math.max(range[0], Math.min(range[1], current))
    setCorrections([{ timestamp, kind: "seed" }])
    seek(timestamp)
    setJob("idle")
    setProgress(0)
    setApproved(false)
  }

  const addCorrection = (timestamp = current) => {
    const ordered = [...corrections, { timestamp, kind: "correction" as const }].sort((a, b) => a.timestamp - b.timestamp)
    const index = ordered.findIndex((item) => item.timestamp === timestamp && item.kind === "correction")
    setCorrections(ordered)
    setInvalidated([ordered[index - 1]?.timestamp ?? range[0], ordered[index + 1]?.timestamp ?? range[1]])
    setJob("stale")
    setApproved(false)
  }

  const run = () => {
    if (!corrections.length) ensureSeed()
    setJob("running")
    setProgress(job === "cancelled" ? progress : 0)
    setInvalidated(null)
    setApproved(false)
  }

  const preview = <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg bg-black">
    <video ref={video} className="h-full w-full object-contain" src={source} onLoadedMetadata={(event) => {
      const nextDuration = event.currentTarget.duration
      setDuration(nextDuration)
      setRange([nextDuration * .15, nextDuration * .8])
      setCurrent(nextDuration * .35)
      event.currentTarget.currentTime = nextDuration * .35
    }} onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)} />
    {showMask && corrections.length > 0 && <div className="pointer-events-none absolute left-[42%] top-[33%] h-32 w-28 rounded-[45%] border-4 border-cyan-300 bg-cyan-400/25 shadow-[0_0_0_999px_rgba(0,0,0,.12)]" />}
    <div className="absolute left-3 top-3 flex gap-2"><span className="rounded bg-black/70 px-2 py-1 text-xs text-white">{timecode(current)}</span>{job === "stale" && <span className="rounded bg-amber-500 px-2 py-1 text-xs font-semibold text-black">Correction needs recompute</span>}</div>
  </div>

  const timeline = <div className="rounded-lg border bg-background p-3">
    <div className="flex items-center gap-2 text-xs"><button className="rounded bg-muted p-2" onClick={() => video.current?.paused ? video.current.play() : video.current?.pause()}>{video.current?.paused === false ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</button><strong>Tracking Range</strong><span>{timecode(range[0])}–{timecode(range[1])}</span><span className="ml-auto">{progress}% · {job}</span></div>
    <div className="relative mt-2 h-12">
      <div className="absolute inset-x-0 top-4 h-2 rounded bg-muted" />
      <div className="absolute top-4 h-2 bg-cyan-600/70" style={{ left: `${duration ? range[0] / duration * 100 : 0}%`, right: `${duration ? 100 - range[1] / duration * 100 : 0}%` }} />
      {invalidated && <div className="absolute top-3 h-4 bg-amber-400/80" style={{ left: `${duration ? invalidated[0] / duration * 100 : 0}%`, right: `${duration ? 100 - invalidated[1] / duration * 100 : 0}%` }} />}
      <input className="absolute inset-x-0 top-1 w-full accent-white" max={duration || 1} min={0} step=".01" type="range" value={current} onChange={(event) => seek(Number(event.target.value))} />
      {corrections.map((item, index) => <button aria-label={`${item.kind} at ${timecode(item.timestamp)}`} className={`absolute top-0 h-5 w-5 -translate-x-1/2 rotate-45 border-2 border-background ${item.kind === "seed" ? "bg-blue-500" : "bg-rose-500"}`} key={`${item.kind}-${index}`} style={{ left: `${duration ? item.timestamp / duration * 100 : 0}%` }} onClick={() => seek(item.timestamp)} />)}
    </div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><label className="text-[10px]">Range start<input className="mt-1 w-full" max={range[1]} min={0} step=".01" type="range" value={range[0]} onChange={(event) => setRange([Number(event.target.value), range[1]])} /></label><label className="text-[10px]">Range end<input className="mt-1 w-full" max={duration || 1} min={range[0]} step=".01" type="range" value={range[1]} onChange={(event) => setRange([range[0], Number(event.target.value)])} /></label></div>
  </div>

  const jobControls = <div className="flex flex-wrap items-center gap-2">
    {!corrections.length && <button className="rounded border px-3 py-2 text-xs" onClick={ensureSeed}>Use current mask as seed</button>}
    {job !== "running" && job !== "complete" && <button className="flex items-center gap-2 rounded bg-primary px-3 py-2 text-xs text-primary-foreground" onClick={run}><Sparkles className="h-4 w-4" />{job === "cancelled" ? "Resume" : job === "stale" ? "Recompute affected span" : "Track mask"}</button>}
    {job === "running" && <button className="flex items-center gap-2 rounded border px-3 py-2 text-xs" onClick={() => setJob("cancelled")}><StopCircle className="h-4 w-4" />Cancel after current frame</button>}
    {(job === "complete" || job === "stale") && <button className="rounded border px-3 py-2 text-xs" onClick={() => addCorrection()}>Add correction here</button>}
    {job === "complete" && <button className="ml-auto flex items-center gap-2 rounded bg-emerald-600 px-3 py-2 text-xs text-white" onClick={() => setApproved(true)}><Check className="h-4 w-4" />Approve for render</button>}
  </div>

  const VariantA = () => <div className="flex h-full flex-col gap-3"><div className="flex min-h-0 flex-1 gap-3">{preview}<aside className="hidden w-56 flex-col gap-3 rounded-lg border bg-background p-3 sm:flex"><strong className="text-sm">Track object</strong><p className="text-xs text-muted-foreground">Blue = seed · Red = correction · Amber = invalidated span</p><button className="rounded border px-3 py-2 text-xs" onClick={() => setShowMask(!showMask)}>{showMask ? "Hide" : "Show"} mask overlay</button><div className="mt-auto">{jobControls}</div></aside></div>{timeline}<div className="sm:hidden">{jobControls}</div></div>

  const steps = [
    { label: "Choose range", done: range[1] > range[0] },
    { label: "Confirm seed mask", done: corrections.length > 0 },
    { label: "Propagate", done: job === "complete" },
    { label: "Review & correct", done: job === "complete" && !invalidated },
    { label: "Approve", done: approved },
  ]
  const VariantB = () => <div className="flex h-full flex-col gap-3 md:flex-row"><aside className="flex w-full gap-2 overflow-x-auto rounded-lg border bg-background p-3 md:w-60 md:flex-col"><h2 className="hidden text-sm font-semibold md:block">Tracking workflow</h2>{steps.map((step, index) => <button className={`flex min-w-40 items-center gap-2 rounded border p-3 text-left text-xs ${step.done ? "border-emerald-500/50 bg-emerald-500/10" : ""}`} key={step.label}><span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted">{step.done ? <Check className="h-3 w-3" /> : index + 1}</span>{step.label}</button>)}</aside><div className="flex min-h-0 flex-1 flex-col gap-3">{preview}<div className="rounded-lg border bg-background p-3">{jobControls}</div>{timeline}</div></div>

  const samples = Array.from({ length: 8 }, (_, index) => {
    const timestamp = range[0] + ((range[1] - range[0]) * index / 7)
    const confidence = [96, 91, 83, 48, 57, 88, 94, 92][index]
    return { timestamp, confidence }
  })
  const VariantC = () => <div className="flex h-full flex-col gap-3"><div className="flex items-center gap-2 rounded-lg border bg-background p-3"><ScanSearch className="h-5 w-5" /><div><h2 className="text-sm font-semibold">Review tracked frames</h2><p className="text-xs text-muted-foreground">Low-confidence samples are surfaced for inspection; confidence never auto-approves a mask.</p></div><div className="ml-auto">{jobControls}</div></div><div className="grid min-h-0 flex-1 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-4">{samples.map((sample) => <button className={`relative min-h-28 overflow-hidden rounded-lg border bg-slate-900 text-left ${sample.confidence < 60 ? "border-amber-400 ring-1 ring-amber-400" : "border-slate-700"}`} key={sample.timestamp} onClick={() => { seek(sample.timestamp); if (sample.confidence < 60) addCorrection(sample.timestamp) }}><div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(34,211,238,.35)_0_18%,transparent_20%)]" /><span className="absolute left-2 top-2 rounded bg-black/70 px-2 py-1 text-[10px] text-white">{timecode(sample.timestamp)}</span><span className={`absolute bottom-2 right-2 rounded px-2 py-1 text-[10px] ${sample.confidence < 60 ? "bg-amber-400 text-black" : "bg-emerald-600 text-white"}`}>{sample.confidence}%</span>{sample.confidence < 60 && <AlertTriangle className="absolute bottom-2 left-2 h-4 w-4 text-amber-400" />}</button>)}</div>{timeline}</div>

  const debug = { variant, range: range.map((value) => Number(value.toFixed(2))), current: Number(current.toFixed(2)), corrections, job, progress, invalidated, approved }
  return <section className="absolute inset-x-3 bottom-14 top-20 sm:inset-x-6">{variant === "A" ? <VariantA /> : variant === "B" ? <VariantB /> : <VariantC />}<details className="fixed right-3 top-20 z-50 max-w-xs rounded border bg-background/95 p-2 text-[10px] shadow-xl"><summary className="cursor-pointer font-semibold">Prototype state</summary><pre className="mt-2 whitespace-pre-wrap">{JSON.stringify(debug, null, 2)}</pre></details>{import.meta.env.DEV && <Switcher variant={variant} onChange={changeVariant} />}</section>
}
