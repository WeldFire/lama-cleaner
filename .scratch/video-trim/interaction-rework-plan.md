# Video trim interaction rework

## Goal

Make pasted video URLs first-class Trim Inputs and keep video editing inside the existing application workspace with one integrated Trim Timeline.

## Work

1. Add a guarded backend URL-import endpoint: require HTTP(S), resolve and reject private or loopback addresses, limit redirects and transfer size to 2 GB, then hand the downloaded file to the existing trim pipeline.
2. Extend paste handling to recognize an HTTP(S) URL, invoke the import endpoint, and surface import errors without clearing the active editor state.
3. Refactor the application layout so the existing header and workspace shell remain mounted for video files; replace only the canvas and suppress image-only controls.
4. Replace the two standalone range inputs with a Video Canvas timeline that has one playable video, a clickable playhead, draggable start/end Trim Range handles, and playback that stops at the end boundary.
5. Add focused backend import tests and frontend interaction tests, then rebuild the Docker image and manually verify the 8088 flow.
