import assert from "node:assert/strict"
import test from "node:test"

import { resolveVideoHotkey } from "./videoHotkeys.ts"

test("video mode owns only frame navigation and playback shortcuts", () => {
  assert.equal(resolveVideoHotkey("video", "ArrowLeft"), "previous-frame")
  assert.equal(resolveVideoHotkey("video", "ArrowRight"), "next-frame")
  assert.equal(resolveVideoHotkey("video", " "), "toggle-playback")
  assert.equal(resolveVideoHotkey("video", "["), null)
  assert.equal(resolveVideoHotkey("video", "]"), null)
})

test("video shortcuts never intercept image mode or modified keys", () => {
  for (const key of ["ArrowLeft", "ArrowRight", " ", "[", "]"]) {
    assert.equal(resolveVideoHotkey("image", key), null)
  }
  assert.equal(resolveVideoHotkey("video", "ArrowLeft", true), null)
})
