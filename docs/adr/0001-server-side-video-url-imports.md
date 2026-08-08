# Server-side video URL imports

The app will fetch pasted video URLs through its local backend rather than relying on browser CORS. This supports ordinary share links, while making URL validation, redirect handling, private-network blocking, and the 2 GB transfer limit mandatory parts of the import boundary.

URL paths are not required to contain a video extension. The imported response
must instead prove to be a decodable video before becoming a Trim Input. For a
minimal HTML page, the importer may follow the first video or source element's
HTTP(S) URL and then apply the same rules. Other HTML pages are not video
imports and remain rejected.

The client shows a centered editor overlay throughout retrieval and validation.
This makes a potentially long server-side import visible before the Video
Canvas can be initialized.

The overlay can cancel its browser request. Cancellation immediately restores
the editor and ignores a late response; the backend may finish an already
started synchronous retrieval and then cleans its request-scoped temporary
files normally.
