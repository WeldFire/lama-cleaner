Type: prototype
Status: resolved
Blocked by:

## Question

What complete interaction contract should govern selecting the displayed frame, entering image editing, saving or abandoning changes, returning to the same Video Canvas state, seeing Frame Edit markers, and switching among several Frame Edits without surprising loss of work?

Create a disposable interactive prototype via `/prototype` and resolve the decision with live user feedback. Include paused/playing entry, dirty edits, deletion, keyboard access, processing-in-progress, and narrow-screen scenarios.

## Answer

Use a hybrid of prototype B's persistent timeline and prototype C's Frame Edit tray.

- The Video Canvas and image editor are two modes of one workspace, not separate pages. The Trim Timeline remains visible and interactive in both modes so the preserved playhead and Trim Range are continuously legible.
- A persistent Frame Edit tray lists saved edits by timestamp and provides capture-current-frame, reopen, switch, and delete actions. It sits beside the workspace on wide screens and becomes a horizontally scrollable strip on narrow screens.
- Entering image editing pauses playback at the exact selected frame. Returning keeps playback paused at that same presentation timestamp and restores the unchanged Trim Range.
- Saving commits the resumable Frame Edit and returns to the Video Canvas. Back/Escape with dirty work presents Save and return, Discard, and Keep editing; processing disables conflicting navigation until it completes or is explicitly cancelled.
- Selecting another Frame Edit while dirty uses the same guard rather than silently replacing editor state. Deletion requires confirmation and never changes the Trim Input.
- The timeline marks each saved Frame Edit and opening either a marker or tray item addresses the same timestamp-bound editing session.
- Keyboard access includes entering edit mode from the current frame, saving, returning, and navigating focusable tray items; shortcuts do not intercept text-entry controls.

Prototype asset: [`VideoFrameRoundTripPrototype.tsx`](../../../web_app/src/components/VideoFrameRoundTripPrototype.tsx), variants B and C. The prototype is throwaway code and is not an implementation specification.
