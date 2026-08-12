# 29 — Add video frame actions and lazy project persistence

**What to build:** Improve the Video Canvas controls and avoid retaining clips that have never produced a saved Frame Edit.

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] Add an accessible video volume control without affecting image-mode hotkeys.
- [x] Add **Save Frame** beside **Edit Frame** and download the backend-owned canonical PNG for the selected FrameKey.
- [x] Newly loaded clips remain draft projects and do not appear in Recent Projects or become the resumable active project until their first Frame Edit is saved.
- [x] Saving the first Frame Edit atomically promotes the draft to a durable project; existing projects remain durable and compatible.
- [x] Leaving or deleting an unedited draft removes it from the user-visible project lifecycle.

## Answer

Video Canvas now has an accessible volume slider and a **Save Frame** action beside **Edit frame**; Save Frame downloads the selected backend canonical PNG without entering image mode. Editing Projects use a catalog-level draft state: selecting/indexing/trimming/downloading a clip does not expose or resume it as a project, while the first saved Frame Edit atomically activates it. Existing projects migrate as durable, and leaving a draft logically deletes it. See [the lifecycle decision and verification record](../research/lazy-project-persistence.md).
