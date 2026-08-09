// PROTOTYPE — terminal shell around the pure Frame Edit session reducer.
import { initialState, proposedInterface, reduceSession } from "./frame-edit-session-model.mjs"
import { emitKeypressEvents } from "node:readline"

let state = initialState()
emitKeypressEvents(process.stdin)
if (process.stdin.isTTY) process.stdin.setRawMode(true)

const bold = (value) => `\x1b[1m${value}\x1b[0m`
const dim = (value) => `\x1b[2m${value}\x1b[0m`

function render() {
  console.clear()
  console.log(bold("PROTOTYPE — Resumable Frame Edit session"))
  console.log(dim("Question: what survives switching/saving/restarting, and how small can the module interface be?\n"))
  console.log(bold("Notice"), state.notice)
  console.log(bold("Proposed interface"), JSON.stringify(proposedInterface, null, 2))
  console.log(bold("Global preferences"), JSON.stringify(state.globalPreferences))
  console.log(bold("Project defaults"), JSON.stringify(state.projectDefaults))
  console.log(bold("Durable Frame A"), JSON.stringify(state.frameDocuments.A, null, 2))
  console.log(bold("Durable Frame B"), JSON.stringify(state.frameDocuments.B, null, 2))
  console.log(bold("Active session"), JSON.stringify(state.active, null, 2))
  console.log(bold("Transition guard"), JSON.stringify(state.guard))
  console.log()
  console.log(`${bold("1/2")} ${dim("open Frame A/B")}  ${bold("m")} ${dim("mask stroke")}  ${bold("p")} ${dim("per-frame prompt")}  ${bold("c")} ${dim("crop")}  ${bold("i")} ${dim("run inpaint")}`)
  console.log(`${bold("u")} ${dim("undo")}  ${bold("s")} ${dim("save")}  ${bold("d")} ${dim("discard/switch")}  ${bold("k")} ${dim("keep editing")}  ${bold("r")} ${dim("restart")}`)
  console.log(`${bold("j")} ${dim("change project model")}  ${bold("g")} ${dim("change global brush size")}  ${bold("q")} ${dim("quit")}`)
}

function apply(action) {
  state = reduceSession(state, action)
  render()
}

process.stdin.on("keypress", (_character, key) => {
  if (key.ctrl && key.name === "c" || key.name === "q") process.exit(0)
  if (key.name === "1") apply({ type: "OPEN", frameId: "A" })
  if (key.name === "2") apply({ type: "OPEN", frameId: "B" })
  if (key.name === "m") apply({ type: "MASK_STROKE" })
  if (key.name === "p") apply({ type: "SET_PROMPT", value: state.active?.toolDraft.prompt ? "" : "remove the object" })
  if (key.name === "c") apply({ type: "CROP" })
  if (key.name === "i") apply({ type: "RUN" })
  if (key.name === "u") apply({ type: "UNDO" })
  if (key.name === "s") apply({ type: "SAVE" })
  if (key.name === "d") apply({ type: "DISCARD" })
  if (key.name === "k") apply({ type: "CANCEL_GUARD" })
  if (key.name === "r") apply({ type: "RESTART" })
  if (key.name === "j") apply({ type: "SET_PROJECT_MODEL", value: state.projectDefaults.model === "lama" ? "opencv" : "lama" })
  if (key.name === "g") apply({ type: "SET_GLOBAL_BRUSH", value: state.globalPreferences.brushSize === 40 ? 72 : 40 })
})

render()
