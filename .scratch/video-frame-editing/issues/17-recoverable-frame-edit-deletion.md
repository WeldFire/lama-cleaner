Type: bug
Status: resolved

## Answer

Frame Edit deletion now requires confirmation. Project deletion uses recoverable logical trash and also requires confirmation.
Blocked by:

## What's wrong

Deleting a Frame Edit removes it immediately without confirmation or an obvious recovery path.

## What I expected

Deletion is recoverable, preferably through a temporary Undo notification; confirmation is an acceptable fallback. Deleting a Frame Edit never changes the Trim Input.

## Steps to reproduce

1. Save a Frame Edit so it appears in the tray.
2. Activate its delete control.
3. Observe that deletion occurs immediately.

## Blocked by

None — can start immediately.

## Additional context

Reported during Phase 1 QA. The backend already models logical deletion, so the user-facing recovery action should match that lifecycle.
