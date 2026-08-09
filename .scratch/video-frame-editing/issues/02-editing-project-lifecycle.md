Type: grilling
Status: resolved
Blocked by:

## Question

What is the user-visible lifecycle of an Editing Project: creation, naming, autosave, loading another input, reopening, source identity checks, relinking a moved or changed Trim Input, conflict handling, and intentional deletion?

Resolve through `/grilling` and `/domain-modeling`; decide behavior rather than a storage implementation.

## Answer

- Loading a Trim Input automatically creates and autosaves an Editing Project, initially named from the video. Naming and location can be changed later; users are not interrupted before their first Frame Edit.
- Autosave records stable user actions such as committing a Frame Edit, changing the Trim Range, adding a mask keyframe, or changing a Tracking Range. Long-running work checkpoints resumable processing state separately. The UI exposes `Saving…`, `Saved`, and recoverable save-failure states.
- When a loaded Trim Input matches existing projects, present `Continue most recent` and `Create new`, briefly defaulting to the most recently used matching project. This supports alternate edits without silently duplicating projects.
- Trim Input identity is a layered Source Fingerprint: normalized media properties and sampled-content hashes provide fast matching, with full-content hashing available for ambiguity. A path is only a relocatable hint.
- Relinking automatically accepts an exact Source Fingerprint match at a new path. A mismatch shows what changed and offers `Choose another file` or `Create a recovered copy`. In a recovered copy, timestamp-dependent Frame Edits and tracking results are quarantined until revalidated against the replacement source.
- Deleting an Editing Project moves the project and its owned generated assets to recoverable local trash. The Trim Input and exported videos remain untouched. Restore and permanent-delete are explicit actions; disposable caches may be reclaimed separately.
- One app instance holds an exclusive writer lease for a project. Additional instances open read-only and may explicitly take over or create an independent project copy. A stale lease left by a crash is recoverable.

This ticket defines behavior, not the on-disk schema or storage engine.
