# Trim-handle preview and pointer capture

The trim timeline treats each boundary as a pointer-captured drag operation.
This prevents native drag-and-drop from taking over when the pointer moves
vertically. During a boundary drag, the video preview seeks to the moving
boundary. The playhead is clamped into the Trim Range as the range changes;
after release, it once again represents the preview position.

Beginning a boundary drag pauses video playback, and release does not restart
it. This makes the frame shown while setting a boundary stable and deliberate.

For responsive feedback, movement uses the browser's fast, keyframe-oriented
seek when it is available. A 500 ms idle debounce refines the preview to the
exact boundary; release performs the same exact seek immediately.

After an idle refinement, small subsequent movements alternate fast and exact
seeks. This keeps the preview close to the handle rather than repeatedly
snapping between distant keyframes. A large movement resets the interaction to
fast-only seeking until it becomes idle again. A large movement is one of at
least 10% of the input video's duration.
