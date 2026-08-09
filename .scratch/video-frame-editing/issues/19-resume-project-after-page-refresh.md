Type: bug
Status: resolved

## Answer

Projects, sources, playhead, and Trim Range now restore after refresh through the persistent project selector and active-project resume path.
Blocked by:

## What's wrong

Editing Project data survives Docker restart, but refreshing the browser clears the active work item and offers no way to reopen the persisted project.

## What I expected

On reload, the last Editing Project is restored when safe or the user can choose it from a recent-project list. Reopening restores its source, Frame Edit tray, playhead, and Trim Range.

## Steps to reproduce

1. Open a Trim Input and save at least one Frame Edit.
2. Refresh the browser page.
3. Attempt to resume the persisted Editing Project.

## Blocked by

None — can start immediately.

## Additional context

Reported during Phase 1 QA using Docker. The persistent project volume remains intact; the missing behavior is project discovery and hydration.
