Type: bug
Status: resolved
Blocked by:

## What's wrong

The Hotkeys dialog does not list the Previous Frame and Next Frame commands available on the Video Canvas, so exact-frame navigation is not discoverable.

## What I expected

The Hotkeys dialog groups shortcuts by Video Editing and Image Editing and lists every active video command without implying that image-only commands work in video mode.

## Steps to reproduce

1. Open a Trim Input and enter the Video Canvas.
2. Open the Hotkeys dialog.
3. Observe that exact previous/next frame navigation is absent.

## Blocked by

None — can start immediately.

## Additional context

Reported during Phase 1 QA. The grouping must remain usable when the persistent timeline is shown in image mode.

## Answer

The Hotkeys dialog now separates Video Editing and Image Editing and documents exact previous/next-frame navigation.
