export type FrameKey = {
  ordinal: number
  projectTimeNum: string
  projectTimeDen: string
}

export type FrameEdit = {
  id: string
  frameOrdinal: number
  renderUrl?: string
  maskUrl?: string
  document?: FrameEditDocument
  compatibility: "resumable" | "flattened"
  updatedAt?: string
}

export type FrameEditDocument = {
  schemaVersion: 2
  revision: number
  frameKey: FrameKey
  canonicalImage: { ordinal: number }
  canvas: { width: number; height: number }
  crop: { x: number; y: number; width: number; height: number }
  mask: { format: "image/png"; coordinateSpace: "canvas" }
  lines: { committed: import("@/lib/types").LineGroup[]; current: import("@/lib/types").LineGroup }
  tools: { baseBrushSize: number; brushSizeScale: number }
  operation: { kind: "image-edit"; model: string; settings: Record<string, unknown> }
}

export type FrameEditSession = {
  frameCount: number
  mode: "video" | "image"
  currentOrdinal: number
  trimStartOrdinal: number
  trimEndOrdinal: number
  activeEditId: string | null
  dirty: boolean
  pending: { kind: "return" | "open" | "navigate" | "close" | "delete-project"; ordinal?: number; editId?: string } | null
}

export type FrameEditAction =
  | { type: "HYDRATE"; frameCount: number; session?: Partial<Pick<FrameEditSession, "currentOrdinal" | "trimStartOrdinal" | "trimEndOrdinal">> }
  | { type: "SEEK"; ordinal: number }
  | { type: "SET_TRIM"; start: number; end: number }
  | { type: "OPEN"; ordinal: number; editId?: string }
  | { type: "REQUEST_NAVIGATE"; ordinal: number }
  | { type: "MARK_DIRTY"; dirty?: boolean }
  | { type: "REQUEST_RETURN" }
  | { type: "REQUEST_EXIT"; kind: "close" | "delete-project" }
  | { type: "SAVE_COMPLETE" }
  | { type: "AUTOSAVE_COMPLETE"; editId: string }
  | { type: "DISCARD" }
  | { type: "KEEP_EDITING" }

export function createFrameEditSession(frameCount: number): FrameEditSession {
  return {
    frameCount,
    mode: "video",
    currentOrdinal: 0,
    trimStartOrdinal: 0,
    trimEndOrdinal: Math.max(0, frameCount - 1),
    activeEditId: null,
    dirty: false,
    pending: null,
  }
}

export function hydrateFrameEditSession(
  frameCount: number,
  persisted?: Partial<Pick<FrameEditSession, "currentOrdinal" | "trimStartOrdinal" | "trimEndOrdinal">>
): FrameEditSession {
  const initial = createFrameEditSession(frameCount)
  const last = Math.max(0, frameCount - 1)
  const ordinal = (value: number | undefined, fallback: number) => Number.isFinite(value) ? Math.trunc(value!) : fallback
  const minimumGap = frameCount > 1 ? 1 : 0
  const start = Math.max(0, Math.min(last - minimumGap, ordinal(persisted?.trimStartOrdinal, 0)))
  const end = Math.max(start + minimumGap, Math.min(last, ordinal(persisted?.trimEndOrdinal, last)))
  const current = Math.max(start, Math.min(end, ordinal(persisted?.currentOrdinal, start)))
  return { ...initial, currentOrdinal: current, trimStartOrdinal: start, trimEndOrdinal: end }
}

export function reduceFrameEditSession(
  state: FrameEditSession,
  action: FrameEditAction
): FrameEditSession {
  switch (action.type) {
    case "HYDRATE":
      return hydrateFrameEditSession(action.frameCount, action.session)
    case "SEEK":
      return { ...state, currentOrdinal: action.ordinal }
    case "SET_TRIM": {
      const last = Math.max(0, state.frameCount - 1)
      const gap = state.frameCount > 1 ? 1 : 0
      const requestedStart = Math.min(action.start, action.end)
      const requestedEnd = Math.max(action.start, action.end)
      const trimStartOrdinal = Math.max(0, Math.min(last - gap, Math.trunc(requestedStart)))
      const trimEndOrdinal = Math.max(trimStartOrdinal + gap, Math.min(last, Math.trunc(requestedEnd)))
      return {
        ...state,
        trimStartOrdinal,
        trimEndOrdinal,
        // A persisted session must always keep its playhead inside the trim
        // range. The original trim workspace also clamped the playhead when a
        // boundary crossed it.
        currentOrdinal: Math.max(trimStartOrdinal, Math.min(trimEndOrdinal, state.currentOrdinal)),
      }
    }
    case "OPEN":
      if (state.mode === "image" && state.dirty) {
        return {
          ...state,
          pending: { kind: "open", ordinal: action.ordinal, editId: action.editId },
        }
      }
      return {
        ...state,
        mode: "image",
        currentOrdinal: action.ordinal,
        activeEditId: action.editId ?? null,
        dirty: false,
        pending: null,
      }
    case "REQUEST_NAVIGATE":
      if (state.mode === "image" && state.dirty) {
        return { ...state, pending: { kind: "navigate", ordinal: action.ordinal } }
      }
      return {
        ...state,
        mode: "video",
        currentOrdinal: action.ordinal,
        activeEditId: null,
        dirty: false,
        pending: null,
      }
    case "MARK_DIRTY":
      return state.mode === "image"
        ? { ...state, dirty: action.dirty ?? true }
        : state
    case "REQUEST_RETURN":
      return state.dirty
        ? { ...state, pending: { kind: "return" } }
        : { ...state, mode: "video", activeEditId: null, pending: null }
    case "REQUEST_EXIT":
      return state.mode === "image" && state.dirty
        ? { ...state, pending: { kind: action.kind } }
        : state
    case "SAVE_COMPLETE":
      return {
        ...state,
        mode: "video",
        currentOrdinal: state.pending?.kind === "navigate" && state.pending.ordinal !== undefined
          ? state.pending.ordinal : state.currentOrdinal,
        activeEditId: null,
        dirty: false,
        pending: null,
      }
    case "AUTOSAVE_COMPLETE":
      return state.mode === "image"
        ? { ...state, activeEditId: action.editId, dirty: false }
        : state
    case "DISCARD": {
      const pending = state.pending
      if (pending?.kind === "open" && pending.ordinal !== undefined) {
        return {
          ...state,
          mode: "image",
          currentOrdinal: pending.ordinal,
          activeEditId: pending.editId ?? null,
          dirty: false,
          pending: null,
        }
      }
      if (pending?.kind === "navigate" && pending.ordinal !== undefined) {
        return {
          ...state,
          mode: "video",
          currentOrdinal: pending.ordinal,
          activeEditId: null,
          dirty: false,
          pending: null,
        }
      }
      return { ...state, mode: "video", activeEditId: null, dirty: false, pending: null }
    }
    case "KEEP_EDITING":
      return { ...state, pending: null }
  }
}
