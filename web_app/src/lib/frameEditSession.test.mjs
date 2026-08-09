import assert from "node:assert/strict"
import { createFrameEditSession, hydrateFrameEditSession, reduceFrameEditSession } from "./frameEditSession.ts"

const test = (name, run) => {
  run()
  process.stdout.write(`ok - ${name}\n`)
}

test("hydration clamps corrupt persisted ordinals to the canonical frame range", () => {
  assert.deepEqual(
    hydrateFrameEditSession(10, { currentOrdinal: 99, trimStartOrdinal: -4, trimEndOrdinal: 20 }),
    { ...createFrameEditSession(10), currentOrdinal: 9 }
  )
  assert.deepEqual(
    hydrateFrameEditSession(10, { currentOrdinal: 2, trimStartOrdinal: 7, trimEndOrdinal: 3 }),
    { ...createFrameEditSession(10), currentOrdinal: 7, trimStartOrdinal: 7, trimEndOrdinal: 8 }
  )
})

test("moving a trim boundary past the playhead clamps the persisted playhead", () => {
  const state = { ...createFrameEditSession(20), currentOrdinal: 12 }
  const trimmed = reduceFrameEditSession(state, { type: "SET_TRIM", start: 0, end: 8 })
  assert.equal(trimmed.currentOrdinal, 8)
  assert.equal(trimmed.trimEndOrdinal, 8)
})

test("dirty project exits enter the shared save-discard guard", () => {
  const state = { ...createFrameEditSession(5), mode: "image", dirty: true }
  assert.deepEqual(
    reduceFrameEditSession(state, { type: "REQUEST_EXIT", kind: "delete-project" }).pending,
    { kind: "delete-project" }
  )
})

test("dirty navigation resolves through save, discard, and keep-editing paths", () => {
  const dirty = { ...createFrameEditSession(8), mode: "image", dirty: true, currentOrdinal: 2 }
  const pending = reduceFrameEditSession(dirty, { type: "REQUEST_NAVIGATE", ordinal: 6 })
  assert.deepEqual(pending.pending, { kind: "navigate", ordinal: 6 })

  const saved = reduceFrameEditSession(pending, { type: "SAVE_COMPLETE" })
  assert.equal(saved.mode, "video")
  assert.equal(saved.currentOrdinal, 6)
  assert.equal(saved.pending, null)
  assert.equal(saved.dirty, false)

  const discarded = reduceFrameEditSession(pending, { type: "DISCARD" })
  assert.equal(discarded.mode, "video")
  assert.equal(discarded.currentOrdinal, 6)
  assert.equal(discarded.pending, null)

  const kept = reduceFrameEditSession(pending, { type: "KEEP_EDITING" })
  assert.equal(kept.mode, "image")
  assert.equal(kept.currentOrdinal, 2)
  assert.equal(kept.dirty, true)
  assert.equal(kept.pending, null)
})
