# Trim-handle interaction plan

1. Replace track-level pointer movement with document-level pointer capture so
   vertical movement cannot escape the handle or activate native drag-and-drop.
2. On handle press, prevent native drag gestures, capture the pointer, and
   pause the video.
3. While dragging, seek the video to the moving boundary. Clamp the playhead
   to that boundary if the changing Trim Range would exclude it. Preserve the
   playhead's original timestamp when it remains inside the changed range.
4. Use fast/keyframe seeking during movement, schedule an exact seek after
   500 ms without movement, then alternate fast and exact seeks for small
   follow-up movements. A movement of at least 10% of video duration resets
   fast-only mode. Perform an exact seek on release or cancel.
5. On release or cancellation, release pointer capture and return to ordinary
   playhead-driven preview without restarting playback.
6. Add focused interaction tests for pointer capture, preview seeking,
   debounced refinement, and playhead clamping; then build the frontend.
