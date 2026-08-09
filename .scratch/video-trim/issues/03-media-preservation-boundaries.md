Type: grilling
Status: resolved

## Question

For the initial Trimmed Video contract, which source-media properties must be preserved, which inputs must be rejected, and how should the product communicate unsupported files or failed trims?

## Comments

Created while charting the Video Trim map. This is a human-in-the-loop decision.

## Answer

Accept one MP4, MOV, or WebM Trim Input up to 2 GB when it has a decodable video stream. Preserve only the Primary Audio Track when available; allow video-only output. Reject oversized, unsupported, or undecodable files before trimming, retain the selected range after a failed request, and show a clear retryable error. Subtitles, chapters, and additional audio tracks are out of scope.
