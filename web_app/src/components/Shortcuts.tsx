import { Keyboard } from "lucide-react"
import { IconButton } from "@/components/ui/button"
import { useToggle } from "@uidotdev/usehooks"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog"
import useHotKey from "@/hooks/useHotkey"
import { useStore } from "@/lib/states"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs"

interface ShortcutProps {
  content: string
  keys: string[]
}

function ShortCut(props: ShortcutProps) {
  const { content, keys } = props

  return (
    <div className="flex justify-between">
      <div>{content}</div>
      <div className="flex gap-[8px]">
        {keys.map((k) => (
          // TODO: 优化快捷键显示
          <div className="border px-2 py-1 rounded-lg" key={k}>
            {k}
          </div>
        ))}
      </div>
    </div>
  )
}

const isMac = function () {
  return /macintosh|mac os x/i.test(navigator.userAgent)
}

const CmdOrCtrl = () => {
  return isMac() ? "Cmd" : "Ctrl"
}

export function Shortcuts() {
  const [open, toggleOpen] = useToggle(false)
  const interactiveSegHotkey = useStore(
    (state) => state.settings.interactiveSegHotkey
  )

  useHotKey("h", () => {
    toggleOpen()
  })

  return (
    <Dialog open={open} onOpenChange={toggleOpen}>
      <DialogTrigger asChild>
        <IconButton tooltip="Hotkeys">
          <Keyboard />
        </IconButton>
      </DialogTrigger>
      <DialogContent className="h-[80vh] max-h-[80vh]">
        <DialogHeader className="min-h-0 flex-1">
          <DialogTitle>Hotkeys</DialogTitle>
          <Tabs className="flex min-h-0 flex-1 flex-col pt-4" defaultValue="general">
            <TabsList aria-label="Hotkey categories" className="grid w-full grid-cols-3">
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="image">Image editing</TabsTrigger>
              <TabsTrigger value="video">Video editing</TabsTrigger>
            </TabsList>
            <TabsContent className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-2" value="general">
              <ShortCut content="Undo" keys={[CmdOrCtrl(), "Z"]} />
              <ShortCut content="Redo" keys={[CmdOrCtrl(), "Shift", "Z"]} />
              <ShortCut content="Paste image or video URL" keys={[CmdOrCtrl(), "V"]} />
              <ShortCut content="Toggle Hotkeys Dialog" keys={["H"]} />
              <ShortCut content="Toggle Settings Dialog" keys={["S"]} />
              <ShortCut content="Toggle File Manager" keys={["F"]} />
            </TabsContent>
            <TabsContent className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-2" value="video">
              <ShortCut content="Previous exact frame" keys={["←"]} />
              <ShortCut content="Next exact frame" keys={["→"]} />
              <ShortCut content="Play / Pause" keys={["Space"]} />
            </TabsContent>
            <TabsContent className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-2" value="image">
              <ShortCut content="Pan" keys={["Space + Drag"]} />
              <ShortCut content="Reset Zoom/Pan" keys={["Esc"]} />
              <ShortCut content="Decrease Brush Size" keys={["["]} />
              <ShortCut content="Increase Brush Size" keys={["]"]} />
              <ShortCut content="Resize Brush" keys={["Ctrl", "Alt", "← →"]} />
              <ShortCut content="View Original Image" keys={["Hold Tab"]} />
              <ShortCut content="Crop Image" keys={["C"]} />
              <ShortCut content="Confirm Crop" keys={["Enter"]} />
              <ShortCut content="Cancel Crop" keys={["Esc"]} />
              {interactiveSegHotkey && (
              <ShortCut
                content="Interactive Segmentation"
                keys={interactiveSegHotkey
                  .split("+")
                  .map((k) =>
                    k === "ctrl"
                      ? "Ctrl"
                      : k === "shift"
                      ? "Shift"
                      : k === "alt"
                      ? "Alt"
                      : k === "meta"
                      ? "Meta"
                      : k.length === 1
                      ? k.toUpperCase()
                      : k
                  )}
              />
              )}
              <ShortCut content="Accept Seg Mask" keys={["Enter"]} />
              <ShortCut content="Cancel Seg / Undo Point" keys={["Esc", "Ctrl+Z"]} />
              <ShortCut content="Expand / Shrink Seg Mask" keys={["Ctrl", "Alt", "← →"]} />
              <ShortCut content="Copy Result" keys={[CmdOrCtrl(), "C"]} />
              <ShortCut content="Trigger Manually Inpainting" keys={["Shift", "R"]} />
            </TabsContent>
          </Tabs>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  )
}

export default Shortcuts
