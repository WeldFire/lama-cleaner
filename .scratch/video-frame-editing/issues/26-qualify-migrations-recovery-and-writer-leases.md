# 26 — Qualify migrations, read-only recovery, and writer leases

**What to build:** Make projects safely openable across schema versions and concurrent or abandoned writers, with a recoverable read-only path whenever mutation is unsafe.

**Blocked by:** 25 — Fault-test atomic project commits.

**Status:** resolved

- [x] Older supported schemas migrate transactionally with a recoverable backup and pass the post-migration integrity audit.
- [x] Newer unsupported schemas open read-only with an actionable explanation and without mutating project data.
- [x] Corrupt or incomplete projects enter an explicit read-only recovery flow rather than failing with raw exceptions.
- [x] Writer leases include fencing so a confirmed takeover prevents the prior writer from committing further mutations.
- [x] Lease acquisition, heartbeat, abandonment, takeover, stale-writer rejection, and restart behavior have deterministic tests.
- [x] Failure injection proves migrations and lease transitions retain either the valid prior state or the complete new state.

## Answer

Project schema v2 adds ordered migration history and renewable writer-lease metadata. Existing schemas are probed without mutation; newer or corrupt projects reopen through a true SQLite `mode=ro` recovery handle with an actionable reason. Supported older projects acquire/fence a writer before migration, use SQLite's online backup API plus a manifest backup, migrate transactionally, and validate SQLite plus every referenced asset hash. Fault recovery restores the valid backup before retry.

Writer acquisition and takeover use `BEGIN IMMEDIATE`; owner, expiry, and monotonically increasing fencing token are committed together and mirrored to a discoverable atomic lease file. Every mutation and heartbeat validates owner plus token inside its SQLite write transaction. Close releases a current lease, expiry permits abandoned-writer recovery, and confirmed API takeover permanently fences the previous writer.

Verification: 84 focused store/API/media tests cover simultaneous acquisition, heartbeat, close/release, abandonment, restart, confirmed takeover, stale-writer rejection, active-writer migration blocking, unsupported-schema immutability, corruption recovery, migration backups/audits, and injected migration/lease failures.
