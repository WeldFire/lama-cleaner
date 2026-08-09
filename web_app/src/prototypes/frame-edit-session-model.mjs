// PROTOTYPE — pure state model for the resumable Frame Edit session boundary.
// Question: which state survives frame switches and restarts, and what is the
// smallest interface that prevents the existing global editor store from
// leaking one frame's state into another?

export const initialState = () => ({
  globalPreferences: {
    brushSize: 40,
    maskHotkey: "a",
    theme: "dark",
  },
  projectDefaults: {
    model: "lama",
    inpaint: { cv2Radius: 5, prompt: "", seed: "random" },
  },
  frameDocuments: {
    A: createDocument("frame-A@2.400", "canonical-A.png"),
    B: createDocument("frame-B@7.850", "canonical-B.png"),
  },
  active: null,
  guard: null,
  notice: "Open a frame to begin.",
})

function createDocument(frameKey, canonicalAsset) {
  return {
    schemaVersion: 1,
    frameKey,
    canonicalAsset,
    latestRenderAsset: canonicalAsset,
    compositeMaskAsset: null,
    editableMaskCommands: [],
    geometry: { crop: null, extender: null },
    operationSnapshot: null,
    revision: 0,
  }
}

function workingCopy(document, projectDefaults) {
  return {
    frameId: document.frameKey.startsWith("frame-A") ? "A" : "B",
    baseRevision: document.revision,
    renderedAsset: document.latestRenderAsset,
    maskCommands: [...document.editableMaskCommands],
    geometry: structuredClone(document.geometry),
    toolDraft: structuredClone(document.operationSnapshot ?? projectDefaults.inpaint),
    dirty: false,
    processing: null,
    undo: [],
    redo: [],
    savedUndoDepth: 0,
  }
}

const dirty = (active, undoEntry) => ({
  ...active,
  dirty: true,
  undo: [...active.undo, undoEntry],
  redo: [],
})

export function reduceSession(state, action) {
  switch (action.type) {
    case "OPEN": {
      if (state.active?.dirty) {
        return { ...state, guard: { intent: "switch", target: action.frameId }, notice: "Unsaved work blocks the frame switch." }
      }
      return {
        ...state,
        active: workingCopy(state.frameDocuments[action.frameId], state.projectDefaults),
        guard: null,
        notice: `Opened Frame ${action.frameId}. Durable content restored; undo starts empty.`,
      }
    }
    case "MASK_STROKE": {
      if (!state.active) return { ...state, notice: "Open a frame first." }
      const stroke = `stroke-${state.active.maskCommands.length + 1}`
      return { ...state, active: dirty({ ...state.active, maskCommands: [...state.active.maskCommands, stroke] }, { type: "mask", value: stroke }), notice: "Mask stroke is session state until Save." }
    }
    case "SET_PROMPT": {
      if (!state.active) return { ...state, notice: "Open a frame first." }
      return { ...state, active: dirty({ ...state.active, toolDraft: { ...state.active.toolDraft, prompt: action.value } }, { type: "prompt", previous: state.active.toolDraft.prompt }), notice: "Tool draft changed for this Frame Edit only." }
    }
    case "CROP": {
      if (!state.active) return { ...state, notice: "Open a frame first." }
      return { ...state, active: dirty({ ...state.active, geometry: { ...state.active.geometry, crop: "10,10,90,90" } }, { type: "crop", previous: state.active.geometry.crop }), notice: "Crop geometry belongs to this Frame Edit." }
    }
    case "RUN": {
      if (!state.active) return { ...state, notice: "Open a frame first." }
      const nextRender = `${state.active.frameId}-render-r${state.active.baseRevision + 1}.png`
      return { ...state, active: dirty({ ...state.active, renderedAsset: nextRender, processing: null }, { type: "render", previous: state.active.renderedAsset }), notice: "Inpainting result staged with its tool snapshot." }
    }
    case "UNDO": {
      if (!state.active || state.active.undo.length === 0) return { ...state, notice: "Nothing to undo in this session." }
      const entry = state.active.undo.at(-1)
      let active = { ...state.active, undo: state.active.undo.slice(0, -1), redo: [...state.active.redo, entry] }
      if (entry.type === "mask") active.maskCommands = active.maskCommands.slice(0, -1)
      if (entry.type === "prompt") active.toolDraft = { ...active.toolDraft, prompt: entry.previous }
      if (entry.type === "crop") active.geometry = { ...active.geometry, crop: entry.previous }
      if (entry.type === "render") active.renderedAsset = entry.previous
      active.dirty = active.undo.length !== active.savedUndoDepth
      return { ...state, active, notice: "Undid one current-session action." }
    }
    case "SAVE": {
      if (!state.active) return { ...state, notice: "Nothing is open." }
      const id = state.active.frameId
      const previous = state.frameDocuments[id]
      const saved = {
        ...previous,
        latestRenderAsset: state.active.renderedAsset,
        compositeMaskAsset: state.active.maskCommands.length ? `${id}-mask-r${previous.revision + 1}.png` : null,
        editableMaskCommands: [...state.active.maskCommands],
        geometry: structuredClone(state.active.geometry),
        operationSnapshot: structuredClone(state.active.toolDraft),
        revision: previous.revision + 1,
      }
      const active = {
        ...state.active,
        baseRevision: saved.revision,
        dirty: false,
        savedUndoDepth: state.active.undo.length,
      }
      return { ...state, frameDocuments: { ...state.frameDocuments, [id]: saved }, active, guard: null, notice: `Saved Frame ${id}; active-session undo remains available until leave or restart.` }
    }
    case "DISCARD": {
      if (!state.active) return state
      const target = state.guard?.target
      const cleanState = { ...state, active: null, guard: null, notice: "Discarded unsaved session changes." }
      return target ? reduceSession(cleanState, { type: "OPEN", frameId: target }) : cleanState
    }
    case "CANCEL_GUARD":
      return { ...state, guard: null, notice: "Kept editing the current frame." }
    case "SET_PROJECT_MODEL":
      return { ...state, projectDefaults: { ...state.projectDefaults, model: action.value }, notice: "Project default changed; open Frame Edits keep committed operation snapshots." }
    case "SET_GLOBAL_BRUSH":
      return { ...state, globalPreferences: { ...state.globalPreferences, brushSize: action.value }, notice: "Global brush preference changed across projects and frames." }
    case "RESTART":
      return { ...state, active: null, guard: null, notice: "Simulated restart: documents/defaults/preferences survived; active undo and dirty work did not." }
    default:
      return state
  }
}

// Proposed deep module interface: callers know three operations, while the
// module owns hydration, dirty guards, serialization, and transient history.
export const proposedInterface = {
  open: "open(frameKey) -> ActiveFrameEdit | GuardedTransition",
  dispatch: "dispatch(EditorCommand) -> SessionView",
  leave: "leave(save | discard | cancel) -> PersistableChanges | SessionView",
}
