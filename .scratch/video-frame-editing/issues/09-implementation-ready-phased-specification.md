Type: grilling
Status: resolved
Blocked by: 05, 06, 07, 08

## Question

Do the resolved interaction, domain, media, persistence, tracking, processing, failure, and output contracts form a complete phased specification with testable acceptance criteria and no remaining product or architectural decisions before implementation planning begins?

Use `/grilling` breadth-first to close any remaining gaps, record the final phase boundaries and acceptance scenarios, and keep implementation-ticket creation outside this planning map.

## Answer

The complete implementation-ready specification is published at [`spec.md`](../spec.md).

Adopt three independently useful vertical phases:

1. **Exact Frame Editing** — canonical frame identity, persistent Editing Projects, Docker project storage, Video↔Image round-trip, and resumable Frame Edits.
2. **Tracked Video Operations** — isolated qualified SAM 2.1 runtime, explicit operations, Tracking Ranges, correction/review/approval, and cancellation/resume.
3. **Edited Video Delivery** — operation composition, Draft/Proof Preview, canonical VFR rendering, synchronized Primary Audio Track, strict validation, publication, and recovery hardening.

Phase 1 is gated on native Windows/Linux/macOS and Docker frame/project workflows without tracking hardware. Phase 2 uses only the resolved qualified fast/slow tracking matrix, leaving experimental platforms explicit. Phase 3 enforces the same media-output contract on every platform declared supported for its selected runtime.

Release verification is layered: deep-module contract tests, generated media fixtures, fault injection, browser interaction/accessibility tests, Docker persistence/runtime tests, decoded golden assertions, and a bounded manual visual-quality corpus. The specification contains testable acceptance criteria for each phase and identifies no remaining product or architectural decision required before implementation planning.

Implementation-ticket creation remains outside this planning map as required.
