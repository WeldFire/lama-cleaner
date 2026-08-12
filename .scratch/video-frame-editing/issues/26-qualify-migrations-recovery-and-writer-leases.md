# 26 — Qualify migrations, read-only recovery, and writer leases

**What to build:** Make projects safely openable across schema versions and concurrent or abandoned writers, with a recoverable read-only path whenever mutation is unsafe.

**Blocked by:** 25 — Fault-test atomic project commits.

**Status:** claimed

- [ ] Older supported schemas migrate transactionally with a recoverable backup and pass the post-migration integrity audit.
- [ ] Newer unsupported schemas open read-only with an actionable explanation and without mutating project data.
- [ ] Corrupt or incomplete projects enter an explicit read-only recovery flow rather than failing with raw exceptions.
- [ ] Writer leases include fencing so a confirmed takeover prevents the prior writer from committing further mutations.
- [ ] Lease acquisition, heartbeat, abandonment, takeover, stale-writer rejection, and restart behavior have deterministic tests.
- [ ] Failure injection proves migrations and lease transitions retain either the valid prior state or the complete new state.
