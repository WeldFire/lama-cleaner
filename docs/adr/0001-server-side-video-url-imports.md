# Server-side video URL imports

The app will fetch pasted video URLs through its local backend rather than relying on browser CORS. This supports ordinary share links, while making URL validation, redirect handling, private-network blocking, and the 2 GB transfer limit mandatory parts of the import boundary.

URL paths are not required to contain a video extension. The imported response
must instead prove to be a decodable video before becoming a Trim Input. For a
minimal HTML page, the importer may follow the first video or source element's
HTTP(S) URL and then apply the same rules. Other HTML pages are not video
imports and remain rejected.
