Type: prototype
Status: resolved

## Question

What interaction model lets a user reliably inspect one input video, set a single valid Trim Range, start the trim, and receive the browser download while fitting the existing React workspace?

## Comments

Created while charting the Video Trim map. This is a human-in-the-loop prototype decision.

## Answer

Use the precision-panel workspace: the video preview and one Trim Range timeline occupy the main area, while editable start and end timestamps, the calculated output length, and the Download MP4 action sit in a dedicated side panel. The validated throwaway variants are preserved on branch codex/video-trim-prototype at commit 9d29979.
