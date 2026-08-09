Type: prototype
Status: resolved
Blocked by: 01, 03

## Question

What editor-session boundary preserves the rendered image, mask, and necessary tool state for multiple resumable Frame Edits while defining which settings are per-frame, project-wide, or global and which undo state is session-only?

Use `/prototype` and `/codebase-design` against the existing Zustand editor state. Resolve both the user-visible resume behavior and the smallest coherent module interface; do not implement production persistence.

## Answer

Adopt a four-layer state model:

1. **Global preferences** contain cross-project UI choices such as brush size, theme, and hotkeys.
2. **Project defaults** seed new operations with choices such as the default model and inpainting parameters. Changing a default does not rewrite committed Frame Edits.
3. Each durable **Frame Edit document** contains its FrameKey and canonical image asset references, latest rendered asset, composite mask asset, editable mask commands, crop/extender geometry, committed operation snapshot, schema version, and revision. Persist serializable asset references and plain data, never `HTMLImageElement`, canvas, object URLs, or other browser-native objects.
4. The **active session** contains hydrated browser objects, dirty drafts, in-flight processing state, and undo/redo. It exists for only one Frame Edit at a time.

Place a deep `FrameEditSession` module at the seam between the workspace/editor and project persistence. Its external interface has three operations:

- `open(frameKey)` hydrates one document or returns a guarded transition when current work is dirty.
- `dispatch(editorCommand)` applies editor actions and returns a session view without exposing persistence or asset-conversion mechanics.
- `leave(save | discard | cancel)` emits persistable changes, abandons drafts, or keeps the active session.

The module owns hydration, conversion between serializable assets and browser-native editor objects, dirty-state guards, revision/checkpoint creation, and transient history. The existing global Zustand editor state becomes a view of the active session rather than the durable source of truth.

Autosave commits the durable document but does not clear undo/redo while that Frame Edit remains actively open. Leaving the frame or restarting discards undo/redo and any uncommitted dirty state; reopening restores the latest committed document with empty history. Switching frames while dirty uses the Save/Discard/Cancel guard resolved by “Workspace round-trip interaction.”

Prototype assets: [`frame-edit-session-model.mjs`](../../../web_app/src/prototypes/frame-edit-session-model.mjs) and [`frame-edit-session-tui.mjs`](../../../web_app/src/prototypes/frame-edit-session-tui.mjs). Run with `npm run prototype:frame-session`. These files are throwaway validation artifacts, not production implementation.
