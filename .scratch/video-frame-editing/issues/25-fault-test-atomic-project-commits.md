# 25 — Fault-test atomic project commits

**What to build:** Demonstrate that an Editing Project remains recoverable when the process fails at any asset, SQLite transaction, or manifest boundary.

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] Provide deterministic fault-injection seams around each asset write, metadata transaction, manifest replacement, and cleanup boundary.
- [x] A failure at every boundary leaves either the complete prior revision or the complete new revision.
- [x] No recoverable state contains metadata pointing to a missing or hash-invalid asset.
- [x] Restart performs an integrity audit and handles orphaned temporary or content-addressed assets without exposing partial work as committed.
- [x] Tests cover project, session-state, Frame Edit document, rename, relink, and deletion mutations that use the atomic commit path.

## Answer

`ProjectStore` now exposes deterministic named fault hooks for project creation, each named asset/stage, metadata commits, catalog synchronization, manifest writes/replacements, and aged-orphan cleanup. The test matrix interrupts Frame Edit render/mask commits, source relinks, session state, rename, deletion, project creation, and cleanup, then reopens the store and proves the observable result is a coherent prior or new revision.

Startup runs SQLite integrity checks and verifies every referenced immutable asset by SHA-256. Invalid projects are quarantined through a public recovery result and excluded from normal listing without preventing healthy projects from opening. Derived catalog/manifest state is repaired from project SQLite without reordering recent projects. Temporary and unreferenced assets are retained for a 24-hour grace period, then reclaimed best-effort; locked cleanup targets stay retryable without hiding healthy projects. Existing content-addressed assets are rehashed before reuse.

Verification: 69 focused project-store, project API, and frame-media tests pass, including multi-asset coherence and corrupt-SQLite isolation.
