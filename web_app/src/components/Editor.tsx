import { SyntheticEvent, useCallback, useEffect, useRef, useState } from "react"
import { CursorArrowRaysIcon } from "@heroicons/react/24/outline"
import { useToast } from "@/components/ui/use-toast"
import {
  ReactZoomPanPinchContentRef,
  TransformComponent,
  TransformWrapper,
} from "react-zoom-pan-pinch"
import { useKeyPressEvent } from "react-use"
import { downloadToOutput, runPlugin, postAdjustMask } from "@/lib/api"
import { IconButton } from "@/components/ui/button"
import {
  askWritePermission,
  cn,
  copyCanvasImage,
  downloadImage,
  drawLines,
  generateMask,
  isMidClick,
  isRightClick,
  loadImage,
  mouseXY,
  srcToFile,
} from "@/lib/utils"
import { Crop, Eraser, Eye, Redo, Undo, Expand, Download } from "lucide-react"
import { useImage } from "@/hooks/useImage"
import { Slider } from "./ui/slider"
import { PluginName } from "@/lib/types"
import { useStore } from "@/lib/states"
import Cropper from "./Cropper"
import { InteractiveSegPoints } from "./InteractiveSeg"
import useHotKey from "@/hooks/useHotkey"
import { useHotkeys } from "react-hotkeys-hook"
import Extender from "./Extender"
import { MAX_BRUSH_SIZE, MIN_BRUSH_SIZE } from "@/lib/const"

const TOOLBAR_HEIGHT = 200
const COMPARE_SLIDER_DURATION_MS = 300

interface EditorProps {
  file: File
}

export default function Editor(props: EditorProps) {
  const { file } = props
  const { toast } = useToast()

  const [
    disableShortCuts,
    windowSize,
    isInpainting,
    imageWidth,
    imageHeight,
    settings,
    enableAutoSaving,
    setImageSize,
    setBaseBrushSize,
    interactiveSegState,
    updateInteractiveSegState,
    resetInteractiveSegState,
    handleInteractiveSegAccept,
    handleCanvasMouseDown,
    handleCanvasMouseMove,
    undo,
    redo,
    undoDisabled,
    redoDisabled,
    isProcessing,
    updateAppState,
    runMannually,
    runInpainting,
    isCropperExtenderResizing,
    decreaseBaseBrushSize,
    increaseBaseBrushSize,
    applyCrop,
    setCropperX,
    setCropperY,
    setCropperWidth,
    setCropperHeight,
  ] = useStore((state) => [
    state.disableShortCuts,
    state.windowSize,
    state.isInpainting,
    state.imageWidth,
    state.imageHeight,
    state.settings,
    state.serverConfig.enableAutoSaving,
    state.setImageSize,
    state.setBaseBrushSize,
    state.interactiveSegState,
    state.updateInteractiveSegState,
    state.resetInteractiveSegState,
    state.handleInteractiveSegAccept,
    state.handleCanvasMouseDown,
    state.handleCanvasMouseMove,
    state.undo,
    state.redo,
    state.undoDisabled(),
    state.redoDisabled(),
    state.getIsProcessing(),
    state.updateAppState,
    state.runMannually(),
    state.runInpainting,
    state.isCropperExtenderResizing,
    state.decreaseBaseBrushSize,
    state.increaseBaseBrushSize,
    state.applyCrop,
    state.setCropperX,
    state.setCropperY,
    state.setCropperWidth,
    state.setCropperHeight,
  ])
  const cropperState = useStore((state) => state.cropperState)
  const baseBrushSize = useStore((state) => state.editorState.baseBrushSize)
  const brushSize = useStore((state) => state.getBrushSize())
  const renders = useStore((state) => state.editorState.renders)
  const extraMasks = useStore((state) => state.editorState.extraMasks)
  const temporaryMasks = useStore((state) => state.editorState.temporaryMasks)
  const lineGroups = useStore((state) => state.editorState.lineGroups)
  const curLineGroup = useStore((state) => state.editorState.curLineGroup)

  // Local State
  const [showOriginal, setShowOriginal] = useState(false)
  const [original, isOriginalLoaded] = useImage(file)
  const [context, setContext] = useState<CanvasRenderingContext2D>()
  const [imageContext, setImageContext] = useState<CanvasRenderingContext2D>()
  const [{ x, y }, setCoords] = useState({ x: -1, y: -1 })
  const [showBrush, setShowBrush] = useState(false)
  const [showRefBrush, setShowRefBrush] = useState(false)
  const [isPanning, setIsPanning] = useState<boolean>(false)
  const [isCropMode, setIsCropMode] = useState<boolean>(false)

  const [scale, setScale] = useState<number>(1)
  const [panned, setPanned] = useState<boolean>(false)
  const [minScale, setMinScale] = useState<number>(1.0)
  const windowCenterX = windowSize.width / 2
  const windowCenterY = windowSize.height / 2
  const viewportRef = useRef<ReactZoomPanPinchContentRef | null>(null)
  // Indicates that the image has been loaded and is centered on first load
  const [initialCentered, setInitialCentered] = useState(false)

  const [isDraging, setIsDraging] = useState(false)

  const [sliderPos, setSliderPos] = useState<number>(0)
  // True while Ctrl+Alt is held — mouse horizontal movement resizes the brush
  const [isResizingBrush, setIsResizingBrush] = useState<boolean>(false)

  // Accumulated pixel expansion (positive = dilate, negative = erode) for the
  // interactive seg mask live-resize preview.  Committed to the actual mask on
  // Ctrl/Alt key-up by calling postAdjustMask.
  const [segExpansion, setSegExpansion] = useState<number>(0)
  // Refs so the async key-up handler can read the latest values without needing
  // them in the useEffect dependency array (which would re-attach listeners).
  const segExpansionRef = useRef<number>(0)
  const isInteractiveSegRef = useRef<boolean>(false)
  const tmpMaskRef = useRef<HTMLImageElement | null>(null)
  // Total expansion that has been permanently committed across all Ctrl+Alt drags
  // in the current interactive seg session.  When the user adds/removes a click
  // point and SAM returns a fresh mask, this amount is automatically re-applied
  // so the expansion is preserved.  Reset when interactive seg mode exits.
  const persistedExpansionRef = useRef<number>(0)
  useEffect(() => {
    isInteractiveSegRef.current = interactiveSegState.isInteractiveSeg
    // Reset persisted expansion whenever interactive seg mode is exited (accept or cancel)
    if (!interactiveSegState.isInteractiveSeg) {
      persistedExpansionRef.current = 0
    }
  }, [interactiveSegState.isInteractiveSeg])
  useEffect(() => {
    tmpMaskRef.current = interactiveSegState.tmpInteractiveSegMask
  }, [interactiveSegState.tmpInteractiveSegMask])

  const hadDrawSomething = useCallback(() => {
    return curLineGroup.length !== 0
  }, [curLineGroup])

  useEffect(() => {
    if (
      !imageContext ||
      !isOriginalLoaded ||
      imageWidth === 0 ||
      imageHeight === 0
    ) {
      return
    }
    const render = renders.length === 0 ? original : renders[renders.length - 1]
    imageContext.canvas.width = imageWidth
    imageContext.canvas.height = imageHeight

    imageContext.clearRect(
      0,
      0,
      imageContext.canvas.width,
      imageContext.canvas.height
    )
    imageContext.drawImage(render, 0, 0, imageWidth, imageHeight)
  }, [
    renders,
    original,
    isOriginalLoaded,
    imageContext,
    imageHeight,
    imageWidth,
  ])

  useEffect(() => {
    if (
      !context ||
      !isOriginalLoaded ||
      imageWidth === 0 ||
      imageHeight === 0
    ) {
      return
    }
    context.canvas.width = imageWidth
    context.canvas.height = imageHeight
    context.clearRect(0, 0, context.canvas.width, context.canvas.height)
    temporaryMasks.forEach((maskImage) => {
      context.drawImage(maskImage, 0, 0, imageWidth, imageHeight)
    })
    extraMasks.forEach((maskImage) => {
      context.drawImage(maskImage, 0, 0, imageWidth, imageHeight)
    })

    if (
      interactiveSegState.isInteractiveSeg &&
      interactiveSegState.tmpInteractiveSegMask
    ) {
      const mask = interactiveSegState.tmpInteractiveSegMask
      if (segExpansion !== 0) {
        // Dilation / erosion preview using 8-directional offset drawing.
        // Drawing the mask shifted in all 8 cardinal+diagonal directions by
        // `e` pixels produces a box dilation that looks like hard pixel
        // addition to the perimeter — much closer to the actual cv2 morphology
        // result than a CSS shadow blur.
        //
        // For erosion (negative e) we shift INWARD: the image is drawn at a
        // smaller target rect centred in the canvas, approximating shrinkage.
        const e = segExpansion
        const offscreen = document.createElement("canvas")
        offscreen.width = imageWidth
        offscreen.height = imageHeight
        const offCtx = offscreen.getContext("2d")!

        if (e > 0) {
          // Dilation: union of the mask shifted in all 8 directions.
          // A pixel is included if the original mask covers any point within
          // distance e — which is exactly box dilation.
          const offsets: [number, number][] = [
            [-e, -e], [0, -e], [e, -e],
            [-e,  0], [0,  0], [e,  0],
            [-e,  e], [0,  e], [e,  e],
          ]
          offsets.forEach(([dx, dy]) => {
            offCtx.drawImage(mask, dx, dy, imageWidth, imageHeight)
          })
        } else {
          // Erosion: intersection of the mask with all 8 shifted copies.
          // A pixel survives only if ALL 8 neighbors at distance abs are also
          // masked — exactly the box-erosion condition.  This makes the mask
          // shrink uniformly inward from its own perimeter rather than toward
          // the image centre.
          const abs = Math.abs(e)
          // Seed with the original mask
          offCtx.drawImage(mask, 0, 0, imageWidth, imageHeight)
          // Progressively intersect with each shifted copy
          offCtx.globalCompositeOperation = "destination-in"
          const offsets: [number, number][] = [
            [-abs, -abs], [0, -abs], [abs, -abs],
            [-abs,   0 ],            [abs,   0 ],
            [-abs,  abs], [0,  abs], [abs,  abs],
          ]
          offsets.forEach(([dx, dy]) => {
            offCtx.drawImage(mask, dx, dy, imageWidth, imageHeight)
          })
        }
        context.drawImage(offscreen, 0, 0)
      } else {
        context.drawImage(mask, 0, 0, imageWidth, imageHeight)
      }
    }
    drawLines(context, curLineGroup)
  }, [
    temporaryMasks,
    extraMasks,
    isOriginalLoaded,
    interactiveSegState,
    segExpansion,
    context,
    curLineGroup,
    imageHeight,
    imageWidth,
  ])

  const getCurrentRender = useCallback(async () => {
    let targetFile = file
    if (renders.length > 0) {
      const lastRender = renders[renders.length - 1]
      targetFile = await srcToFile(lastRender.currentSrc, file.name, file.type)
    }
    return targetFile
  }, [file, renders])

  const hadRunInpainting = () => {
    return renders.length !== 0
  }

  // Applies expansion/erosion to a mask image via the backend adjust_mask
  // endpoint (pure cv2 morphology — no ML model involved).  Returns the new
  // mask image, or the original if the call fails / expansion is zero.
  const applyExpansionToMask = useCallback(
    async (expansion: number, mask: HTMLImageElement): Promise<HTMLImageElement> => {
      if (expansion === 0) return mask
      try {
        const maskFile = await srcToFile(mask.currentSrc, "mask.png", "image/png")
        const newMaskBlob = await postAdjustMask(
          maskFile,
          expansion > 0 ? "expand" : "shrink",
          Math.abs(expansion)
        )
        const newMask = new Image()
        await loadImage(newMask, URL.createObjectURL(newMaskBlob))
        return newMask
      } catch {
        // Keep the original mask if the call fails
        return mask
      }
    },
    []
  )

  // Commits a Ctrl+Alt drag: applies expansion to the current mask, updates
  // state, and accumulates the amount into persistedExpansionRef so it will
  // be re-applied automatically the next time SAM returns a fresh mask.
  const commitSegExpansion = useCallback(
    async (expansion: number, mask: HTMLImageElement) => {
      if (expansion === 0) return
      const newMask = await applyExpansionToMask(expansion, mask)
      updateInteractiveSegState({ tmpInteractiveSegMask: newMask })
      // Accumulate so point add/remove re-applies the same total expansion
      persistedExpansionRef.current += expansion
    },
    [applyExpansionToMask, updateInteractiveSegState]
  )

  const getCurrentWidthHeight = useCallback(() => {
    let width = 512
    let height = 512
    if (!isOriginalLoaded) {
      return [width, height]
    }
    if (renders.length === 0) {
      width = original.naturalWidth
      height = original.naturalHeight
    } else if (renders.length !== 0) {
      width = renders[renders.length - 1].width
      height = renders[renders.length - 1].height
    }

    return [width, height]
  }, [original, isOriginalLoaded, renders])

  // Draw once the original image is loaded
  useEffect(() => {
    if (!isOriginalLoaded) {
      return
    }

    const [width, height] = getCurrentWidthHeight()
    if (width !== imageWidth || height !== imageHeight) {
      setImageSize(width, height)
    }

    const rW = windowSize.width / width
    const rH = (windowSize.height - TOOLBAR_HEIGHT) / height

    let s = 1.0
    if (rW < 1 || rH < 1) {
      s = Math.min(rW, rH)
    }
    setMinScale(s)
    setScale(s)

    console.log(
      `[on file load] image size: ${width}x${height}, scale: ${s}, initialCentered: ${initialCentered}`
    )

    if (context?.canvas) {
      console.log("[on file load] set canvas size")
      if (width != context.canvas.width) {
        context.canvas.width = width
      }
      if (height != context.canvas.height) {
        context.canvas.height = height
      }
    }

    if (!initialCentered) {
      // 防止每次擦除以后图片 zoom 还原
      viewportRef.current?.centerView(s, 1)
      console.log("[on file load] centerView")
      setInitialCentered(true)
    }
  }, [
    viewportRef,
    imageHeight,
    imageWidth,
    original,
    isOriginalLoaded,
    windowSize,
    initialCentered,
    getCurrentWidthHeight,
  ])

  useEffect(() => {
    console.log("[useEffect] centerView")
    // render 改变尺寸以后，undo/redo 重新 center
    viewportRef?.current?.centerView(minScale, 1)
  }, [imageHeight, imageWidth, viewportRef, minScale])

  // Zoom reset
  const resetZoom = useCallback(() => {
    if (!minScale || !windowSize) {
      return
    }
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }
    const offsetX = (windowSize.width - imageWidth * minScale) / 2
    const offsetY = (windowSize.height - imageHeight * minScale) / 2
    viewport.setTransform(offsetX, offsetY, minScale, 200, "easeOutQuad")
    if (viewport.instance.transformState.scale) {
      viewport.instance.transformState.scale = minScale
    }

    setScale(minScale)
    setPanned(false)
  }, [
    viewportRef,
    windowSize,
    imageHeight,
    imageWidth,
    windowSize.height,
    minScale,
  ])

  const startCropMode = useCallback(() => {
    if (
      isCropMode ||
      isProcessing ||
      !isOriginalLoaded ||
      imageWidth === 0 ||
      imageHeight === 0
    ) {
      return
    }
    if (interactiveSegState.isInteractiveSeg) {
      resetInteractiveSegState()
      setSegExpansion(0)
      segExpansionRef.current = 0
    }
    setShowBrush(false)
    setIsDraging(false)
    setIsPanning(false)
    setCropperX(0)
    setCropperY(0)
    setCropperWidth(imageWidth)
    setCropperHeight(imageHeight)
    setIsCropMode(true)
  }, [
    imageHeight,
    imageWidth,
    interactiveSegState.isInteractiveSeg,
    isCropMode,
    isOriginalLoaded,
    isProcessing,
    resetInteractiveSegState,
    setCropperHeight,
    setCropperWidth,
    setCropperX,
    setCropperY,
  ])

  const confirmCrop = useCallback(async () => {
    if (!isCropMode) {
      return
    }
    await applyCrop(cropperState)
    setIsCropMode(false)
  }, [applyCrop, cropperState, isCropMode])

  useEffect(() => {
    window.addEventListener("resize", () => {
      resetZoom()
    })
    return () => {
      window.removeEventListener("resize", () => {
        resetZoom()
      })
    }
  }, [windowSize, resetZoom])

  const handleEscPressed = () => {
    if (isProcessing) {
      return
    }
    if (isCropMode) {
      setIsCropMode(false)
      return
    }
    // Interactive seg cancel takes priority over zoom reset
    if (interactiveSegState.isInteractiveSeg) {
      resetInteractiveSegState()
      setSegExpansion(0)
      segExpansionRef.current = 0
      return
    }
    if (isDraging) {
      setIsDraging(false)
    } else {
      resetZoom()
    }
  }

  useHotKey("Escape", handleEscPressed, [
    isDraging,
    isCropMode,
    isInpainting,
    resetZoom,
    interactiveSegState.isInteractiveSeg,
    resetInteractiveSegState,
  ])

  // Enter key accepts the current interactive seg mask (if one exists)
  useHotKey(
    "enter",
    async () => {
      if (isCropMode) {
        await confirmCrop()
        return
      }
      if (
        interactiveSegState.isInteractiveSeg &&
        interactiveSegState.tmpInteractiveSegMask
      ) {
        handleInteractiveSegAccept()
      }
    },
    [
      interactiveSegState.isInteractiveSeg,
      interactiveSegState.tmpInteractiveSegMask,
      isCropMode,
      confirmCrop,
      handleInteractiveSegAccept,
    ]
  )

  useHotKey(
    "c",
    (ev: KeyboardEvent) => {
      ev.preventDefault()
      startCropMode()
    },
    [startCropMode]
  )

  const onMouseMove = (ev: SyntheticEvent) => {
    const mouseEvent = ev.nativeEvent as MouseEvent

    if (isCropMode) {
      setCoords({ x: mouseEvent.pageX, y: mouseEvent.pageY })
      return
    }

    if (isResizingBrush) {
      if (mouseEvent.movementX !== 0) {
        if (isInteractiveSegRef.current && tmpMaskRef.current) {
          // In interactive seg mode: expand/shrink the seg mask instead of
          // resizing the brush.  Clamp total expansion to [-50, 50] px.
          const next = Math.min(
            50,
            Math.max(-50, segExpansionRef.current + mouseEvent.movementX)
          )
          segExpansionRef.current = next
          setSegExpansion(next)
        } else {
          // Normal brush resize (Ctrl+Alt outside interactive seg mode)
          const next = Math.min(
            MAX_BRUSH_SIZE,
            Math.max(MIN_BRUSH_SIZE, baseBrushSize + mouseEvent.movementX)
          )
          setBaseBrushSize(next)
        }
      }
      // Do NOT call setCoords — keeps the brush ring / cursor stationary.
      return
    }

    setCoords({ x: mouseEvent.pageX, y: mouseEvent.pageY })
  }

  const onMouseDrag = (ev: SyntheticEvent) => {
    if (isProcessing) {
      return
    }

    if (isCropMode) {
      return
    }

    if (interactiveSegState.isInteractiveSeg) {
      return
    }
    if (isPanning) {
      return
    }
    if (!isDraging) {
      return
    }
    if (curLineGroup.length === 0) {
      return
    }

    handleCanvasMouseMove(mouseXY(ev))
  }

  const runInteractiveSeg = async (newClicks: number[][]) => {
    updateAppState({ isPluginRunning: true })
    const targetFile = await getCurrentRender()
    try {
      const res = await runPlugin(
        true,
        PluginName.InteractiveSeg,
        targetFile,
        undefined,
        newClicks,
        settings.interactiveSegMaskPadding
      )
      const { blob } = res
      // Load the fresh SAM mask, then re-apply any persisted Ctrl+Alt expansion
      // so the grow/shrink amount survives adding or removing click points.
      const img = new Image()
      await loadImage(img, blob)
      const finalMask =
        persistedExpansionRef.current !== 0
          ? await applyExpansionToMask(persistedExpansionRef.current, img)
          : img
      updateInteractiveSegState({ tmpInteractiveSegMask: finalMask })
    } catch (e: any) {
      toast({
        variant: "destructive",
        description: e.message ? e.message : e.toString(),
      })
    }
    updateAppState({ isPluginRunning: false })
  }

  const onPointerUp = (ev: SyntheticEvent) => {
    if (isCropMode) {
      return
    }
    if (isMidClick(ev)) {
      setIsPanning(false)
      return
    }
    if (!hadDrawSomething()) {
      return
    }
    if (interactiveSegState.isInteractiveSeg) {
      return
    }
    if (isPanning) {
      return
    }
    if (!original.src) {
      return
    }
    const canvas = context?.canvas
    if (!canvas) {
      return
    }
    if (isInpainting) {
      return
    }
    if (!isDraging) {
      return
    }

    if (runMannually) {
      setIsDraging(false)
    } else {
      runInpainting()
    }
  }

  const onCanvasMouseUp = (ev: SyntheticEvent) => {
    if (isCropMode) {
      return
    }
    if (isMidClick(ev)) {
      return
    }
    if (interactiveSegState.isInteractiveSeg) {
      const xy = mouseXY(ev)
      const newClicks: number[][] = [...interactiveSegState.clicks]
      if (isRightClick(ev)) {
        newClicks.push([xy.x, xy.y, 0, newClicks.length])
      } else {
        newClicks.push([xy.x, xy.y, 1, newClicks.length])
      }
      runInteractiveSeg(newClicks)
      updateInteractiveSegState({ clicks: newClicks })
    }
  }

  const onMouseDown = (ev: SyntheticEvent) => {
    if (isProcessing) {
      return
    }
    if (isCropMode) {
      return
    }
    if (isMidClick(ev)) {
      setIsPanning(true)
      return
    }
    if (interactiveSegState.isInteractiveSeg) {
      return
    }
    if (isPanning) {
      return
    }
    if (!isOriginalLoaded) {
      return
    }
    const canvas = context?.canvas
    if (!canvas) {
      return
    }

    if (isRightClick(ev)) {
      return
    }

    setIsDraging(true)
    handleCanvasMouseDown(mouseXY(ev))
  }

  const handleUndo = (keyboardEvent: KeyboardEvent | SyntheticEvent) => {
    keyboardEvent.preventDefault()
    if (interactiveSegState.isInteractiveSeg) {
      // In interactive seg mode, Ctrl+Z removes the last click point and
      // re-runs SAM with the remaining points.  If no points remain, the
      // temporary mask is cleared.
      const newClicks = interactiveSegState.clicks.slice(0, -1)
      updateInteractiveSegState({ clicks: newClicks })
      if (newClicks.length > 0) {
        runInteractiveSeg(newClicks)
      } else {
        updateInteractiveSegState({ tmpInteractiveSegMask: null })
      }
    } else {
      undo()
    }
  }
  useHotKey("meta+z,ctrl+z", handleUndo, [
    interactiveSegState.isInteractiveSeg,
    interactiveSegState.clicks,
    updateInteractiveSegState,
    undo,
  ])

  const handleRedo = (keyboardEvent: KeyboardEvent | SyntheticEvent) => {
    keyboardEvent.preventDefault()
    redo()
  }
  useHotKey("shift+ctrl+z,shift+meta+z", handleRedo)

  useKeyPressEvent(
    "Tab",
    (ev) => {
      ev?.preventDefault()
      ev?.stopPropagation()
      if (hadRunInpainting()) {
        setShowOriginal(() => {
          window.setTimeout(() => {
            setSliderPos(100)
          }, 10)
          return true
        })
      }
    },
    (ev) => {
      ev?.preventDefault()
      ev?.stopPropagation()
      if (hadRunInpainting()) {
        window.setTimeout(() => {
          setSliderPos(0)
        }, 10)
        window.setTimeout(() => {
          setShowOriginal(false)
        }, COMPARE_SLIDER_DURATION_MS)
      }
    }
  )

  const download = useCallback(async () => {
    if (file === undefined) {
      return
    }
    if (enableAutoSaving && renders.length > 0) {
      try {
        await downloadToOutput(
          renders[renders.length - 1],
          file.name,
          file.type
        )
        toast({
          description: "Save image success",
        })
      } catch (e: any) {
        toast({
          variant: "destructive",
          title: "Uh oh! Something went wrong.",
          description: e.message ? e.message : e.toString(),
        })
      }
      return
    }

    // Nothing to download if no inpainting has been run yet, or if the last
    // render element is somehow missing (e.g. stale closure edge-case).
    const curSrc = renders[renders.length - 1]?.currentSrc
    if (!curSrc) {
      return
    }

    // TODO: download to output directory
    const name = file.name.replace(/(\.[\w\d_-]+)$/i, "_cleanup$1")
    downloadImage(curSrc, name)
    if (settings.enableDownloadMask) {
      let maskFileName = file.name.replace(/(\.[\w\d_-]+)$/i, "_mask$1")
      maskFileName = maskFileName.replace(/\.[^/.]+$/, ".jpg")

      const maskCanvas = generateMask(imageWidth, imageHeight, lineGroups)
      // Create a link
      const aDownloadLink = document.createElement("a")
      // Add the name of the file to the link
      aDownloadLink.download = maskFileName
      // Attach the data to the link
      aDownloadLink.href = maskCanvas.toDataURL("image/jpeg")
      // Get the code to click the download link
      aDownloadLink.click()
    }
  }, [
    file,
    enableAutoSaving,
    renders,
    settings,
    imageHeight,
    imageWidth,
    lineGroups,
  ])

  useHotKey("meta+s,ctrl+s", download)

  // Block the browser's "Save Page As" dialog for Ctrl/Cmd+S.
  // A dedicated capture-phase listener is the most reliable cross-browser way
  // to prevent the default before the browser acts on it — independent of the
  // download hotkey registration above.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault()
      }
    }
    window.addEventListener("keydown", handler, { capture: true })
    return () => window.removeEventListener("keydown", handler, true)
  }, [])

  const toggleShowBrush = (newState: boolean) => {
    // Also keep the brush visible while the user is actively resizing it
    if (newState !== showBrush && !isPanning && !isCropperExtenderResizing && !isResizingBrush) {
      setShowBrush(newState)
    }
  }

  const getCursor = useCallback(() => {
    if (isProcessing) {
      return "default"
    }
    if (isCropMode) {
      return "default"
    }
    if (isPanning) {
      return "grab"
    }
    // Hide the system cursor so the brush-ring acts as the cursor
    if (showBrush || isResizingBrush) {
      return "none"
    }
    return undefined
  }, [showBrush, isPanning, isProcessing, isResizingBrush, isCropMode])

  useHotKey(
    "[",
    () => {
      decreaseBaseBrushSize()
    },
    [decreaseBaseBrushSize]
  )

  useHotKey(
    "]",
    () => {
      increaseBaseBrushSize()
    },
    [increaseBaseBrushSize]
  )

  // Manual Inpainting Hotkey
  useHotKey(
    "shift+r",
    () => {
      if (runMannually && hadDrawSomething()) {
        runInpainting()
      }
    },
    [runMannually, runInpainting, hadDrawSomething]
  )

  useHotKey(
    "ctrl+c,meta+c",
    async () => {
      const hasPermission = await askWritePermission()
      if (hasPermission && renders.length > 0) {
        if (context?.canvas) {
          await copyCanvasImage(context?.canvas)
          toast({
            title: "Copy inpainting result to clipboard",
          })
        }
      }
    },
    [renders, context]
  )

  // Toggle clean/zoom tool on spacebar.
  useKeyPressEvent(
    " ",
    (ev) => {
      if (!disableShortCuts && !isCropMode) {
        ev?.preventDefault()
        ev?.stopPropagation()
        setShowBrush(false)
        setIsPanning(true)
      }
    },
    (ev) => {
      if (!disableShortCuts && !isCropMode) {
        ev?.preventDefault()
        ev?.stopPropagation()
        setShowBrush(true)
        setIsPanning(false)
      }
    }
  )

  // Ctrl+Alt + mouse-drag-left/right to resize brush.
  // Raw window listeners are used (not useKeyPressEvent) because:
  //  a) we need to detect *both* modifiers simultaneously, and
  //  b) Alt alone steals browser-menu focus on Windows and immediately fires
  //     blur, resetting state before the user can move the mouse.
  useEffect(() => {
    const handleKeyDown = (ev: KeyboardEvent) => {
      if (disableShortCuts) return
      if (isCropMode) return
      if (ev.ctrlKey && ev.altKey) {
        ev.preventDefault()
        setIsResizingBrush(true)
        setShowBrush(true)
      }
    }

    const handleKeyUp = (ev: KeyboardEvent) => {
      // Exit resize mode as soon as either modifier is released
      if (ev.key === "Control" || ev.key === "Alt") {
        setIsResizingBrush(false)

        // If we were expanding/shrinking an interactive seg mask, commit the
        // accumulated expansion now via the backend adjust_mask endpoint.
        if (
          isInteractiveSegRef.current &&
          tmpMaskRef.current &&
          segExpansionRef.current !== 0
        ) {
          commitSegExpansion(segExpansionRef.current, tmpMaskRef.current)
          segExpansionRef.current = 0
          setSegExpansion(0)
        }
      }
    }

    const handleBlur = () => {
      setIsResizingBrush(false)
    }

    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("keyup", handleKeyUp)
    window.addEventListener("blur", handleBlur)

    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("keyup", handleKeyUp)
      window.removeEventListener("blur", handleBlur)
    }
  }, [disableShortCuts, commitSegExpansion, isCropMode])

  // Suppress the browser context menu globally while interactive seg is active
  // so right-clicking to add a negative point doesn't also open the menu.
  // A document-level listener in capture phase is more reliable than relying
  // solely on React's synthetic onContextMenu (which fires after the browser
  // may have already started showing the menu).
  useEffect(() => {
    if (!interactiveSegState.isInteractiveSeg) return
    const prevent = (e: MouseEvent) => e.preventDefault()
    document.addEventListener("contextmenu", prevent, { capture: true })
    return () => document.removeEventListener("contextmenu", prevent, true)
  }, [interactiveSegState.isInteractiveSeg])

  // User-configurable hotkey to enter interactive segmentation mode.
  // Uses useHotkeys directly (rather than useHotKey) so we can disable it
  // entirely when no hotkey has been configured, avoiding empty-string issues.
  useHotkeys(
    settings.interactiveSegHotkey || "F13",
    () => {
      if (!isProcessing) {
        updateInteractiveSegState({ isInteractiveSeg: true })
      }
    },
    {
      enabled: !disableShortCuts && !!settings.interactiveSegHotkey,
    },
    [
      disableShortCuts,
      settings.interactiveSegHotkey,
      isProcessing,
      updateInteractiveSegState,
    ]
  )

  const getCurScale = (): number => {
    let s = minScale
    if (viewportRef.current?.instance?.transformState.scale !== undefined) {
      s = viewportRef.current?.instance?.transformState.scale
    }
    return s!
  }

  const getBrushStyle = (_x: number, _y: number) => {
    const curScale = getCurScale()
    return {
      width: `${brushSize * curScale}px`,
      height: `${brushSize * curScale}px`,
      left: `${_x}px`,
      top: `${_y}px`,
      transform: "translate(-50%, -50%)",
    }
  }

  const renderBrush = (style: any) => {
    return (
      <div
        className="absolute rounded-[50%] border-[1px] border-[solid] border-[#ffcc00] pointer-events-none bg-[#ffcc00bb]"
        style={style}
      />
    )
  }

  const handleSliderChange = (value: number) => {
    setBaseBrushSize(value)

    if (!showRefBrush) {
      setShowRefBrush(true)
      window.setTimeout(() => {
        setShowRefBrush(false)
      }, 10000)
    }
  }

  const renderInteractiveSegCursor = () => {
    return (
      <div
        className="absolute h-[20px] w-[20px] pointer-events-none rounded-[50%] bg-[rgba(21,_215,_121,_0.936)] [box-shadow:0_0_0_0_rgba(21,_215,_121,_0.936)] animate-pulse"
        style={{
          left: `${x}px`,
          top: `${y}px`,
          transform: "translate(-50%, -50%)",
        }}
      >
        <CursorArrowRaysIcon />
      </div>
    )
  }

  const renderCanvas = () => {
    return (
      <TransformWrapper
        ref={(r) => {
          if (r) {
            viewportRef.current = r
          }
        }}
        panning={{ disabled: !isPanning, velocityDisabled: true }}
        wheel={{ step: 0.05 }}
        centerZoomedOut
        alignmentAnimation={{ disabled: true }}
        centerOnInit
        limitToBounds={false}
        doubleClick={{ disabled: true }}
        initialScale={minScale}
        minScale={minScale * 0.3}
        onPanning={() => {
          if (!panned) {
            setPanned(true)
          }
        }}
        onZoom={(ref) => {
          setScale(ref.state.scale)
        }}
      >
        <TransformComponent
          contentStyle={{
            visibility: initialCentered ? "visible" : "hidden",
          }}
        >
          <div className="grid [grid-template-areas:'editor-content'] gap-y-4">
            <canvas
              className="[grid-area:editor-content]"
              style={{
                clipPath: `inset(0 ${sliderPos}% 0 0)`,
                transition: `clip-path ${COMPARE_SLIDER_DURATION_MS}ms`,
              }}
              ref={(r) => {
                if (r && !imageContext) {
                  const ctx = r.getContext("2d")
                  if (ctx) {
                    setImageContext(ctx)
                  }
                }
              }}
            />
            <canvas
              className={cn(
                "[grid-area:editor-content]",
                isProcessing
                  ? "pointer-events-none animate-pulse duration-600"
                  : ""
              )}
              style={{
                cursor: getCursor(),
                clipPath: `inset(0 ${sliderPos}% 0 0)`,
                transition: `clip-path ${COMPARE_SLIDER_DURATION_MS}ms`,
              }}
              onContextMenu={(e) => {
                e.preventDefault()
              }}
              onMouseOver={() => {
                toggleShowBrush(true)
                setShowRefBrush(false)
              }}
              onFocus={() => toggleShowBrush(true)}
              onMouseLeave={() => toggleShowBrush(false)}
              onMouseDown={onMouseDown}
              onMouseUp={onCanvasMouseUp}
              onMouseMove={onMouseDrag}
              onTouchStart={onMouseDown}
              onTouchEnd={onCanvasMouseUp}
              onTouchMove={onMouseDrag}
              ref={(r) => {
                if (r && !context) {
                  const ctx = r.getContext("2d")
                  if (ctx) {
                    setContext(ctx)
                  }
                }
              }}
            />
            <div
              className="[grid-area:editor-content] pointer-events-none grid [grid-template-areas:'original-image-content']"
              style={{
                width: `${imageWidth}px`,
                height: `${imageHeight}px`,
              }}
            >
              {showOriginal && (
                <>
                  <div
                    className="[grid-area:original-image-content] z-10 bg-primary h-full w-[6px] justify-self-end"
                    style={{
                      marginRight: `${sliderPos}%`,
                      transition: `margin-right ${COMPARE_SLIDER_DURATION_MS}ms`,
                    }}
                  />
                  <img
                    className="[grid-area:original-image-content]"
                    src={original.src}
                    alt="original"
                    style={{
                      width: `${imageWidth}px`,
                      height: `${imageHeight}px`,
                    }}
                  />
                </>
              )}
            </div>
          </div>

          <Cropper
            maxHeight={imageHeight}
            maxWidth={imageWidth}
            minHeight={
              isCropMode ? Math.min(16, imageHeight) : Math.min(512, imageHeight)
            }
            minWidth={
              isCropMode ? Math.min(16, imageWidth) : Math.min(512, imageWidth)
            }
            scale={getCurScale()}
            show={isCropMode || settings.showCropper}
            showForAllModes={isCropMode}
          />

          <Extender
            minHeight={Math.min(512, imageHeight)}
            minWidth={Math.min(512, imageWidth)}
            scale={getCurScale()}
            show={settings.showExtender}
          />

          {interactiveSegState.isInteractiveSeg ? (
            <InteractiveSegPoints />
          ) : (
            <></>
          )}
        </TransformComponent>
      </TransformWrapper>
    )
  }

  return (
    <div
      className="flex w-screen h-screen justify-center items-center"
      aria-hidden="true"
      onMouseMove={onMouseMove}
      onMouseUp={onPointerUp}
    >
      {renderCanvas()}
      {(showBrush || isResizingBrush) &&
        !isCropMode &&
        !isInpainting &&
        !isPanning &&
        (interactiveSegState.isInteractiveSeg
          ? renderInteractiveSegCursor()
          : renderBrush(getBrushStyle(x, y)))}

      {showRefBrush && renderBrush(getBrushStyle(windowCenterX, windowCenterY))}

      <div className="fixed flex bottom-5 border px-4 py-2 rounded-[3rem] gap-8 items-center justify-center backdrop-filter backdrop-blur-md bg-background/70">
        <Slider
          className="w-48"
          defaultValue={[50]}
          min={MIN_BRUSH_SIZE}
          max={MAX_BRUSH_SIZE}
          step={1}
          tabIndex={-1}
          value={[baseBrushSize]}
          onValueChange={(vals) => handleSliderChange(vals[0])}
          onClick={() => setShowRefBrush(false)}
        />
        <div className="flex gap-2">
          <IconButton
            tooltip="Reset zoom & pan"
            disabled={scale === minScale && panned === false}
            onClick={resetZoom}
          >
            <Expand />
          </IconButton>
          <IconButton
            tooltip={isCropMode ? "Confirm Crop" : "Crop Image"}
            disabled={isProcessing || imageWidth === 0 || imageHeight === 0}
            onClick={() => {
              if (isCropMode) {
                confirmCrop()
              } else {
                startCropMode()
              }
            }}
          >
            <Crop />
          </IconButton>
          <IconButton
            tooltip="Undo"
            onClick={handleUndo}
            disabled={undoDisabled}
          >
            <Undo />
          </IconButton>
          <IconButton
            tooltip="Redo"
            onClick={handleRedo}
            disabled={redoDisabled}
          >
            <Redo />
          </IconButton>
          <IconButton
            tooltip="Show original image"
            onPointerDown={(ev) => {
              ev.preventDefault()
              setShowOriginal(() => {
                window.setTimeout(() => {
                  setSliderPos(100)
                }, 10)
                return true
              })
            }}
            onPointerUp={() => {
              window.setTimeout(() => {
                // 防止快速点击 show original image 按钮时图片消失
                setSliderPos(0)
              }, 10)

              window.setTimeout(() => {
                setShowOriginal(false)
              }, COMPARE_SLIDER_DURATION_MS)
            }}
            disabled={renders.length === 0}
          >
            <Eye />
          </IconButton>
          <IconButton
            tooltip="Save Image"
            disabled={!renders.length}
            onClick={download}
          >
            <Download />
          </IconButton>

          {settings.enableManualInpainting &&
          settings.model.model_type === "inpaint" ? (
            <IconButton
              tooltip="Run Inpainting"
              disabled={
                isProcessing || (!hadDrawSomething() && extraMasks.length === 0)
              }
              onClick={() => {
                runInpainting()
              }}
            >
              <Eraser />
            </IconButton>
          ) : (
            <></>
          )}
        </div>
      </div>
    </div>
  )
}
