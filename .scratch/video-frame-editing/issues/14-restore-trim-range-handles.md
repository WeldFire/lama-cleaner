Type: bug
Status: resolved

## Answer

The time-based draggable Trim Range interaction from `ddfc1d6` is restored, including full-track capture, coarse/exact preview, timecodes, shortcuts, and inclusive-Out export.
Blocked by:

## What's wrong

The Trim Range is exposed as In and Out frame-number text boxes. Their purpose is unclear and the previously available direct-manipulation trim handles are missing.

## What I expected

The timeline retains draggable start/end handles for the overall video Trim Range, with exact timecode or frame inputs available as a supplementary precision control rather than the primary interaction.

## Steps to reproduce

1. Open a Trim Input.
2. Inspect the timeline controls.
3. Attempt to adjust the overall start and end visually by dragging handles.

## Blocked by

None — can start immediately.

## Additional context

Reported during Phase 1 QA. Returning from image mode must preserve both handle positions exactly.
