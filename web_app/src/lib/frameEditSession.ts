export type FrameKey = {
  ordinal: number
  projectTimeNum: string
  projectTimeDen: string
}

export type FrameEdit = {
  id: string
  frameOrdinal: number
  renderUrl?: string
  updatedAt?: string
}

export type FrameEditSession = {
  mode: "video" | "image"
  currentOrdinal: number
  trimStartOrdinal: number
  trimEndOrdinal: number
  activeEditId: string | null
  dirty: boolean
  pending: { kind: "return" | "open"; ordinal?: number; editId?: string } | null
}

export type FrameEditAction =
  | { type: "HYDRATE"; frameCount: number }
  | { type: "SEEK"; ordinal: number }
  | { type: "SET_TRIM"; start: number; end: number }
  | { type: "OPEN"; ordinal: number; editId?: string }
  | { type: "MARK_DIRTY"; dirty?: boolean }
  | { type: "REQUEST_RETURN" }
  | { type: "SAVE_COMPLETE" }
  | { type: "DISCARD" }
  | { type: "KEEP_EDITING" }

export function createFrameEditSession(frameCount: number): FrameEditSession {
  return {
    mode: "video",
    currentOrdinal: 0,
    trimStartOrdinal: 0,
    trimEndOrdinal: Math.max(0, frameCount - 1),
    activeEditId: null,
    dirty: false,
    pending: null,
  }
}

export function reduceFrameEditSession(
  state: FrameEditSession,
  action: FrameEditAction
): FrameEditSession {
  switch (action.type) {
    case "HYDRATE":
      return createFrameEditSession(action.frameCount)
    case "SEEK":
      return { ...state, currentOrdinal: action.ordinal }
    case "SET_TRIM":
      return { ...state, trimStartOrdinal: action.start, trimEndOrdinal: action.end }
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
    case "MARK_DIRTY":
      return state.mode === "image"
        ? { ...state, dirty: action.dirty ?? true }
        : state
    case "REQUEST_RETURN":
      return state.dirty
        ? { ...state, pending: { kind: "return" } }
        : { ...state, mode: "video", activeEditId: null, pending: null }
    case "SAVE_COMPLETE":
      return { ...state, mode: "video", activeEditId: null, dirty: false, pending: null }
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
      return { ...state, mode: "video", activeEditId: null, dirty: false, pending: null }
    }
    case "KEEP_EDITING":
      return { ...state, pending: null }
  }
}
