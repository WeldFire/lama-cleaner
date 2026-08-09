Type: bug
Status: resolved

## Answer

Saved Frame Edits now appear as time-positioned markers on the persistent timeline and reopen their saved render.
Blocked by:

## What's wrong

Saved Frame Edits appear in the Frame Edit tray but have no corresponding marker on the timeline at their exact FrameKey.

## What I expected

Every saved Frame Edit appears both in the tray and as a focusable timeline marker at the same exact frame; activating either opens the same Frame Edit.

## Steps to reproduce

1. Edit and save a frame.
2. Confirm that it appears in the Frame Edit tray.
3. Inspect the timeline at the saved frame.

## Blocked by

None — can start immediately.

## Additional context

Reported during Phase 1 QA. Multiple edits at nearby frames must remain individually addressable.
