Type: grilling
Status: resolved
Blocked by: 05, 06

## Question

Which existing image-editing results are meaningful only as standalone Frame Edits, which can seed temporal operations, and exactly how do multiple Frame Edits, masks, tracking results, overlapping ranges, and conflicting operations compose into the Edited Video?

Resolve through `/grilling` and `/domain-modeling` using concrete overlap, correction, non-mask edit, and deleted-keyframe scenarios.

## Answer

- Every Frame Edit remains standalone by default. A user explicitly creates a Video Operation from an eligible Frame Edit. Mask-based erase/inpainting can become a tracked temporal operation; unsupported image edits remain clearly image-only and never create an implicit one-frame replacement.
- A Video Operation owns versioned snapshots of its seed/correction masks, FrameKeys, Tracking Range, and committed operation settings. It is independently revisioned from the Frame Edits that originated those snapshots.
- Changing a source Frame Edit does not mutate an existing Video Operation. `Update operation` explicitly creates a new operation revision and invalidates only affected tracking/render spans. Deleting a standalone Frame Edit does not delete an operation; operations are deleted separately.
- Compatible erase/inpainting operations that overlap in time composite their masks per canonical source frame and perform one inpainting pass from that original frame. Compatibility requires the same render model and settings that materially affect pixel generation.
- Overlapping operations with incompatible render settings are a visible composition conflict. The user must unify settings or separate their ranges; the application never silently selects layer order or feeds one operation's generated pixels into another.
- Each Video Operation preserves its authored Tracking Range even when the Trim Range changes. Preview and rendering use only the intersection with the current Trim Range. Excluded spans become dormant and return if trimming is restored; expanding the Trim Range never extends tracking beyond the explicit Tracking Range.
- Removing a correction mask keyframe merges its neighboring spans and marks the merged span stale for recomputation. Removing the sole seed leaves the operation intact but blocked until the user explicitly chooses or creates a replacement seed. Propagated masks are never silently promoted to authored keyframes.
- Approval is revision-specific. Any change to keyframes, masks, operation settings, Tracking Range, compatible-operation grouping, or source/toolchain identity invalidates the affected approved result and identifies the spans requiring recomputation.

This contract excludes general compositing, arbitrary filter animation, and sequential effect layers; those remain outside the map's destination.
