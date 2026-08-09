Type: bug
Status: resolved

## Answer

Timeline navigation and project exits use the shared Save, Discard, or Keep editing guard; trim mutation is disabled while image mode is active.
Blocked by:

## What's wrong

Timeline clicks and exact-frame navigation remain directly active in image mode and can move session state without following the guarded return workflow.

## What I expected

Timeline navigation in image mode behaves like Return to Video. Clean work returns and seeks immediately; dirty work first offers Save, Discard, or Keep editing, then moves to the requested exact frame only after Save or Discard.

## Steps to reproduce

1. Enter image mode for a frame and make an unsaved edit.
2. Click elsewhere on the timeline or activate Previous/Next Frame.
3. Observe the resulting frame and mode state.

## Blocked by

None — can start immediately.

## Additional context

Reported during Phase 1 QA. Processing-in-progress must continue to disable conflicting navigation.
