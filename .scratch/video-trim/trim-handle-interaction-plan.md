# Trim-handle interaction plan

1. Replace track-level pointer movement with document-level pointer capture so
   vertical movement cannot escape the handle or activate native drag-and-drop.
2. On handle press, prevent native drag gestures, capture the pointer, and
   pause the video.
3. While dragging, seek the video to the moving boundary. Clamp the playhead
   to that boundary if the changing Trim Range would exclude it.
4. On release or cancellation, release pointer capture and return to ordinary
   playhead-driven preview without restarting playback.
5. Add focused interaction tests for pointer capture, preview seeking, and
   playhead clamping; then build the frontend.
