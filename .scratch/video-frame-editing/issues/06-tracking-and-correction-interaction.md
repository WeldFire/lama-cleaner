Type: prototype
Status: resolved
Blocked by: 01, 04

## Question

How should users create and adjust a Tracking Range, start propagation from a masked Frame Edit, inspect confidence or failures, add correction mask keyframes, understand which span will be invalidated, cancel or resume work, and approve a result for rendering?

Create a disposable interactive prototype via `/prototype` using the constraints established by the tracking-runtime decision, then resolve it with live user feedback.

## Answer

Use prototype A's timeline-first controls together with prototype C's review grid. Retain prototype B's steps only as a compact status indicator; tracking is not a blocking wizard.

- The Trim Timeline is the authoritative place to create and adjust a Tracking Range. It shows the seed mask keyframe, correction mask keyframes, propagation progress, stale spans, and the playhead in the same temporal coordinate system.
- Starting propagation requires a saved Frame Edit with a mask and an explicit Tracking Range. The range defaults to the current Trim Range but can be narrowed before processing.
- Blue seed and red correction markers address exact FrameKeys. Adding or changing a correction invalidates only the spans between that keyframe and its immediate neighboring keyframes or Tracking Range boundaries. Invalidated spans are amber until recomputed.
- Propagation reports frame/chunk progress and its current direction without exposing model internals. Cancel stops at the next atomic frame boundary, preserves committed span checkpoints, and exposes Resume. A correction during or after processing makes affected work stale rather than silently mixing revisions.
- Review uses a time-ordered frame grid tied to the timeline. It samples the whole Tracking Range and prioritizes low-confidence, discontinuity, decode-error, and correction-adjacent frames. Confidence is a review aid only: it never hides frames, changes masks, or auto-approves a result.
- Selecting a review frame seeks the Video Canvas to it. `Correct mask` opens that exact frame in the established image-editing mode; returning commits a correction keyframe and clearly previews the adjacent spans that will be recomputed.
- A compact status indicator communicates `Choose range`, `Seed ready`, `Propagating`, `Review needed`, `Stale corrections`, and `Approved`. Users may move freely between timeline and review except while an atomic frame operation is completing.
- Approval is available only when every span is complete for the current keyframe/range revisions and no required review or decode failure remains. Approval freezes that tracking-result revision for the later Edited Video composition contract; subsequent changes revoke approval.

Prototype asset: [`TrackingCorrectionPrototype.tsx`](../../../web_app/src/components/TrackingCorrectionPrototype.tsx), combining variants A and C with the compact status semantics from B. The prototype is throwaway code, not production implementation.
