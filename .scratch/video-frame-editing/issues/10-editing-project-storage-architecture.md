Type: grilling
Status: resolved
Blocked by: 03, 05

## Question

What local on-disk structure, asset ownership model, schema versioning and migration policy, atomic-save boundary, Source Fingerprint representation, writer-lease mechanism, trash layout, and recovery procedure should implement the resolved Editing Project lifecycle without trying to serialize browser-native image objects directly?

Resolve through `/grilling` and `/codebase-design` after the exact-frame contract and resumable editor-session boundary establish the media and state shapes. Include compatibility, corruption, partial-write, cache-reclamation, and backup/portability scenarios; do not implement the storage layer.

## Answer

### Physical layout and Docker contract

Use a dedicated configurable project-data root. Native installs default to the platform's application-data location. Docker uses `PROJECT_DATA_DIR=/data/projects`, backed by a distinct persistent Compose volume mounted at `/data/projects`; project data must never live only in the container layer or share the model-cache volume.

The root contains a catalog plus self-contained project directories:

```text
<project-data-root>/
  catalog.sqlite
  projects/<project-id>/
    manifest.json
    project.sqlite
    assets/<sha256-prefix>/<sha256>
    cache/
    tmp/
```

`project.sqlite` stores transactional metadata, revisions, FrameKeys, Frame Edit documents, Video Operations, references, checkpoints, leases, and schema history. Large canonical images, renders, masks, and other immutable binaries are content-addressed files. `manifest.json` is a small portable bootstrap containing project identity, schema/toolchain requirements, Source Fingerprint summary, and integrity metadata; it is not a second mutable source of truth.

All project-owned paths are relative to the project directory. Trim Input paths are relocatable location hints paired with Source Fingerprints, never identity. A project directory can be archived for backup/import without copying the external Trim Input; disposable `cache/` content may be excluded.

### Atomic commits and recovery

For each stable user action or processing checkpoint:

1. Stream every new immutable asset into `tmp/`, flush it, calculate and verify its content hash, then atomically rename it into the content-addressed asset tree.
2. Commit all metadata and asset references for that action in one SQLite transaction guarded by the active fencing token.
3. Update the portable manifest only after the transaction, using write-flush-atomic-replace. A stale manifest is repairable from SQLite; committed SQLite metadata may never reference a missing asset.

Crashes may leave complete but unreferenced asset or temp files. They are safe orphans and are reclaimed only after a grace period and reference audit. Derived caches are versioned by source/toolchain/operation revision and may always be regenerated.

Use ordered transactional metadata migrations. Before a project's first upgrade in a new app version, retain a compact SQLite/manifest backup without duplicating immutable assets. Migration failure rolls back and offers read-only recovery. Projects with newer unsupported schemas open read-only and are never automatically downgraded.

Recovery performs SQLite integrity checks, validates referenced asset hashes, restores the newest valid metadata snapshot when necessary, and regenerates only derived caches. It never fabricates missing authored masks or silently accepts mismatched source media.

### Writer lease and lifecycle

Acquire a discoverable lease file atomically and pair it with a monotonically increasing fencing token in SQLite. Heartbeat metadata records instance identity and liveness; optional advisory locking improves local detection but is not the correctness mechanism. Every write transaction presents the current fencing token. Confirmed takeover increments it, permanently fencing a paused former writer from future commits.

Deletion is logical: the catalog marks the project deleted with retention metadata while its self-contained directory stays intact. Restore clears the tombstone. Permanent deletion is an explicit resumable purge of project-owned metadata, assets, and caches; it never follows external source/export paths and never deletes the Trim Input or Edited Videos.

### Deep module seam

Place a `ProjectStore` module between application workflows and all catalog/SQLite/filesystem mechanics. Its external interface has four operations:

- `open(projectLocator, accessIntent) -> ProjectHandle | RecoveryResult`
- `transact(projectHandle, ProjectMutation) -> ProjectRevision`
- `lifecycle(projectId, LifecycleCommand) -> LifecycleResult`
- `close(projectHandle)`

`open` owns creation, lookup, schema compatibility, migration, integrity checks, source hints, and lease acquisition. `transact` owns asset ingestion, atomic ordering, revision checks, checkpoints, manifest refresh, and fencing. `lifecycle` owns rename/relocate, trash/restore/purge, export/import, audit, and recovery commands. `close` flushes eligible work and releases the lease.

Filesystem, SQLite, clock, hashing, and fault injection are internal seams. Production uses the real local adapters; tests use temporary-filesystem and SQLite adapters through the same `ProjectStore` interface. Callers and tests do not issue SQL, calculate asset paths, manipulate lease files, or serialize browser-native objects.
