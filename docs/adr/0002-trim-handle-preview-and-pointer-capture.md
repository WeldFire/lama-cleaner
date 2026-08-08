# Trim-handle preview and pointer capture

The trim timeline treats each boundary as a pointer-captured drag operation.
This prevents native drag-and-drop from taking over when the pointer moves
vertically. During a boundary drag, the video preview seeks to the moving
boundary. The playhead is clamped into the Trim Range as the range changes;
after release, it once again represents the preview position.

Beginning a boundary drag pauses video playback, and release does not restart
it. This makes the frame shown while setting a boundary stable and deliberate.
