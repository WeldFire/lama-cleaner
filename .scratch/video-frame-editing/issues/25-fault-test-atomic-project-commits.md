# 25 — Fault-test atomic project commits

**What to build:** Demonstrate that an Editing Project remains recoverable when the process fails at any asset, SQLite transaction, or manifest boundary.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Provide deterministic fault-injection seams around each asset write, metadata transaction, manifest replacement, and cleanup boundary.
- [ ] A failure at every boundary leaves either the complete prior revision or the complete new revision.
- [ ] No recoverable state contains metadata pointing to a missing or hash-invalid asset.
- [ ] Restart performs an integrity audit and handles orphaned temporary or content-addressed assets without exposing partial work as committed.
- [ ] Tests cover project, session-state, Frame Edit document, rename, relink, and deletion mutations that use the atomic commit path.
