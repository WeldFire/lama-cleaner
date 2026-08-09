Type: bug
Status: resolved

## Answer

The action is explicitly labeled Trim original video and explains that standalone Frame Edits are not composited into Phase 1 output.
Blocked by:

## What's wrong

After saving Frame Edits, the available video download contains only the trimmed original frames. The interface does not explain that this action creates a Trimmed Video rather than an Edited Video.

## What I expected

The Phase 1 download is clearly labeled and described as Trim Original Video, and the interface states that standalone Frame Edits are not composited into it. An Edited Video action must not appear enabled until the later render workflow exists.

## Steps to reproduce

1. Save a visibly changed Frame Edit.
2. Download the available video.
3. Play it and observe that the edited frame is absent.

## Blocked by

None — can start immediately for labeling and expectation-setting. Actual composition belongs to Phase 3.

## Additional context

Reported during Phase 1 QA. Standalone Frame Edits intentionally do not affect video implicitly.
