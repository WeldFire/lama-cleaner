import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2 } from "lucide-react"

import useInputImage from "@/hooks/useInputImage"
import { dataURItoBlob, keepGUIAlive } from "@/lib/utils"
import { getServerConfig } from "@/lib/api"
import { isSupportedMediaFile, isVideoFile } from "@/lib/media"
import Header from "@/components/Header"
import Workspace from "@/components/Workspace"
import VideoFrameEditWorkspace from "@/components/VideoFrameEditWorkspace"
import FileSelect from "@/components/FileSelect"
import { Toaster } from "./components/ui/toaster"
import { useStore } from "./lib/states"
import { useWindowSize } from "react-use"
import { importVideoUrl } from "@/lib/videoUrlImport"
import {
  deleteVideoProject,
  getProjectSource,
  getVideoProject,
  listVideoProjects,
  type VideoProject,
  type VideoProjectSummary,
} from "@/lib/projectApi"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

const ACTIVE_VIDEO_PROJECT_KEY = "iopaint.activeVideoProjectId"

const SUPPORTED_FILE_TYPE = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/bmp",
  "image/tiff",
  "video/mp4",
  "video/quicktime",
  "video/webm",
]

const IMAGE_DATA_URL_REGEXP =
  /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i

function stripPastedStringQuotes(value: string) {
  let strippedValue = value.trim()
  const quoteCharacters = ['"', "'", "`"]

  while (strippedValue.length >= 2) {
    const firstCharacter = strippedValue[0]
    const lastCharacter = strippedValue[strippedValue.length - 1]

    if (
      firstCharacter === lastCharacter &&
      quoteCharacters.includes(firstCharacter)
    ) {
      strippedValue = strippedValue.slice(1, -1).trim()
    } else {
      break
    }
  }

  return strippedValue
}

function pastedImageDataUrlToFile(pastedText: string) {
  const dataUrl = stripPastedStringQuotes(pastedText)
  const match = dataUrl.match(IMAGE_DATA_URL_REGEXP)

  if (!match) {
    return null
  }

  const mimeType = match[1].toLowerCase()
  if (!SUPPORTED_FILE_TYPE.includes(mimeType)) {
    return null
  }

  const extension =
    mimeType.split("/")[1] === "jpeg" ? "jpg" : mimeType.split("/")[1]
  const normalizedDataUrl = `data:${mimeType};base64,${match[2].replace(
    /\s/g,
    ""
  )}`

  try {
    return new File(
      [dataURItoBlob(normalizedDataUrl)],
      `pasted-image.${extension}`,
      {
        type: mimeType,
      }
    )
  } catch {
    return null
  }
}

function Home() {
  const [file, updateAppState, setServerConfig, setFile] = useStore((state) => [
    state.file,
    state.updateAppState,
    state.setServerConfig,
    state.setFile,
  ])

  const userInputImage = useInputImage()

  const windowSize = useWindowSize()

  useEffect(() => {
    if (userInputImage) {
      setFile(userInputImage)
    }
  }, [userInputImage, setFile])

  useEffect(() => {
    updateAppState({ windowSize })
  }, [updateAppState, windowSize])

  useEffect(() => {
    const fetchServerConfig = async () => {
      const serverConfig = await getServerConfig()
      setServerConfig(serverConfig)
      if (serverConfig.isDesktop) {
        // Keeping GUI Window Open
        keepGUIAlive()
      }
    }
    fetchServerConfig()
  }, [setServerConfig])

  const dragCounter = useRef(0)
  const urlImportControllerRef = useRef<AbortController | null>(null)
  const [isImportingVideoUrl, setIsImportingVideoUrl] = useState(false)
  // Retain the source while `setFile` hydrates the selected PNG into the
  // existing image editor. Project mode, rather than file MIME, owns routing.
  const [videoProjectSource, setVideoProjectSource] = useState<{ file: File; projectId?: string } | null>(null)
  const [recentVideoProjects, setRecentVideoProjects] = useState<VideoProjectSummary[]>([])
  const [projectRestoreError, setProjectRestoreError] = useState("")
  const [projectDeleteCandidate, setProjectDeleteCandidate] = useState<VideoProjectSummary | null>(null)

  useEffect(() => {
    if (file && isVideoFile(file)) setVideoProjectSource((current) =>
      current?.file === file ? current : { file }
    )
  }, [file])

  const refreshRecentProjects = useCallback(() => {
    listVideoProjects().then(setRecentVideoProjects).catch(() => setRecentVideoProjects([]))
  }, [])

  const resumeVideoProject = useCallback(async (projectId: string) => {
    setProjectRestoreError("")
    try {
      const project = await getVideoProject(projectId)
      const restoredSource = await getProjectSource(projectId, project.sourceName)
      await setFile(restoredSource)
      setVideoProjectSource({ file: restoredSource, projectId })
      localStorage.setItem(ACTIVE_VIDEO_PROJECT_KEY, projectId)
    } catch (reason) {
      localStorage.removeItem(ACTIVE_VIDEO_PROJECT_KEY)
      setProjectRestoreError(reason instanceof Error ? reason.message : "Unable to restore video project")
    }
  }, [setFile])

  useEffect(() => {
    refreshRecentProjects()
    const activeProjectId = localStorage.getItem(ACTIVE_VIDEO_PROJECT_KEY)
    if (activeProjectId && !videoProjectSource) void resumeVideoProject(activeProjectId)
    // Restoration is intentionally a one-time startup operation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleProjectReady = useCallback((project: VideoProject) => {
    localStorage.setItem(ACTIVE_VIDEO_PROJECT_KEY, project.id)
    refreshRecentProjects()
  }, [refreshRecentProjects])

  const cancelVideoUrlImport = useCallback(() => {
    urlImportControllerRef.current?.abort()
    urlImportControllerRef.current = null
    setIsImportingVideoUrl(false)
  }, [])

  useEffect(() => () => urlImportControllerRef.current?.abort(), [])

  const handleDrag = useCallback((event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }, [])

  const handleDragIn = useCallback((event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    dragCounter.current += 1
  }, [])

  const handleDragOut = useCallback((event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    dragCounter.current -= 1
    if (dragCounter.current > 0) return
  }, [])

  const handleDrop = useCallback((event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const dataTransfer = event.dataTransfer
    if (dataTransfer?.files && dataTransfer.files.length > 0) {
      if (dataTransfer.files.length > 1) {
        // setToastState({
        //   open: true,
        //   desc: "Please drag and drop only one file",
        //   state: "error",
        //   duration: 3000,
        // })
      } else {
        const dragFile = dataTransfer.files[0]
        if (isSupportedMediaFile(dragFile)) {
          setFile(dragFile)
        } else {
          // setToastState({
          //   open: true,
          //   desc: "Please drag and drop an image file",
          //   state: "error",
          //   duration: 3000,
          // })
        }
      }
      dataTransfer.clearData()
    }
  }, [setFile])

  const onPaste = useCallback(async (event: ClipboardEvent) => {
    // TODO: when sd side panel open, ctrl+v not work
    // https://htmldom.dev/paste-an-image-from-the-clipboard/
    if (!event.clipboardData) {
      return
    }

    const pastedImageDataUrlFile = pastedImageDataUrlToFile(
      event.clipboardData.getData("text/plain")
    )
    if (pastedImageDataUrlFile) {
      event.preventDefault()
      event.stopPropagation()
      setFile(pastedImageDataUrlFile)
      return
    }

    const pastedUrl = event.clipboardData.getData("text/plain").trim()
    if (pastedUrl.startsWith("http://") || pastedUrl.startsWith("https://")) {
      event.preventDefault()
      event.stopPropagation()
      urlImportControllerRef.current?.abort()
      const controller = new AbortController()
      urlImportControllerRef.current = controller
      setIsImportingVideoUrl(true)
      try {
        const importedFile = await importVideoUrl(pastedUrl, controller.signal)
        if (urlImportControllerRef.current === controller) setFile(importedFile)
      } catch (error) {
        if (!controller.signal.aborted) {
          alert(error instanceof Error ? error.message : "Unable to import this video URL.")
        }
      } finally {
        if (urlImportControllerRef.current === controller) {
          urlImportControllerRef.current = null
          setIsImportingVideoUrl(false)
        }
      }
      return
    }

    const clipboardItems = event.clipboardData.items
    const items: DataTransferItem[] = [].slice
      .call(clipboardItems)
      .filter((item: DataTransferItem) => {
        // Filter the image items only
        return item.type.indexOf("image") !== -1
      })

    if (items.length === 0) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    // TODO: add confirm dialog

    const item = items[0]
    // Get the blob of image
    const blob = item.getAsFile()
    if (blob) {
      setFile(blob)
    }
  }, [setFile])

  useEffect(() => {
    window.addEventListener("dragenter", handleDragIn)
    window.addEventListener("dragleave", handleDragOut)
    window.addEventListener("dragover", handleDrag)
    window.addEventListener("drop", handleDrop)
    window.addEventListener("paste", onPaste)
    return function cleanUp() {
      window.removeEventListener("dragenter", handleDragIn)
      window.removeEventListener("dragleave", handleDragOut)
      window.removeEventListener("dragover", handleDrag)
      window.removeEventListener("drop", handleDrop)
      window.removeEventListener("paste", onPaste)
    }
  }, [handleDrag, handleDragIn, handleDragOut, handleDrop, onPaste])

  return (
    <main className="flex min-h-screen flex-col items-center justify-between w-full bg-[radial-gradient(circle_at_1px_1px,_#8e8e8e8e_1px,_transparent_0)] [background-size:20px_20px] bg-repeat">
      <Toaster />
      <Header />
      {videoProjectSource ? (
        <VideoFrameEditWorkspace
          file={videoProjectSource.file}
          projectId={videoProjectSource.projectId}
          onProjectReady={handleProjectReady}
          onClose={() => {
            localStorage.removeItem(ACTIVE_VIDEO_PROJECT_KEY)
            setVideoProjectSource(null)
            updateAppState({ file: null })
            refreshRecentProjects()
          }}
        />
      ) : (
        <Workspace />
      )}
      {!file ? (
        <FileSelect
          onSelection={async (f) => {
            setFile(f)
          }}
        />
      ) : (
        <></>
      )}
      {!videoProjectSource && recentVideoProjects.length > 0 && (
        <section className="fixed bottom-6 left-1/2 z-20 w-[min(32rem,calc(100%-2rem))] -translate-x-1/2 rounded-lg border bg-background/95 p-4 shadow-lg" aria-label="Recent video projects">
          <h2 className="text-sm font-semibold">Continue a video project</h2>
          <div className="mt-2 flex max-h-36 flex-col gap-2 overflow-y-auto">
            {recentVideoProjects.map((project) => (
              <div className="flex items-center rounded border" key={project.id}>
                <button className="flex min-w-0 flex-1 items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => void resumeVideoProject(project.id)} type="button">
                  <span className="truncate">{project.name}</span>
                  <span className="ml-3 shrink-0 text-xs text-muted-foreground">Continue</span>
                </button>
                <button aria-label={`Delete project ${project.name}`} className="border-l px-3 py-2 text-xs text-destructive hover:bg-accent" onClick={() => setProjectDeleteCandidate(project)} type="button">Delete</button>
              </div>
            ))}
          </div>
          {projectRestoreError && <p className="mt-2 text-xs text-destructive">{projectRestoreError}</p>}
        </section>
      )}
      <AlertDialog open={Boolean(projectDeleteCandidate)} onOpenChange={(open) => !open && setProjectDeleteCandidate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this video project?</AlertDialogTitle>
            <AlertDialogDescription>{projectDeleteCandidate?.name} will be removed from the project selector. Its data remains recoverable in project storage.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={async () => {
              if (!projectDeleteCandidate) return
              try {
                await deleteVideoProject(projectDeleteCandidate.id)
                setProjectDeleteCandidate(null)
                refreshRecentProjects()
              } catch (reason) {
                setProjectRestoreError(reason instanceof Error ? reason.message : "Unable to delete this project")
              }
            }}>Delete project</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {isImportingVideoUrl && (
        <div
          aria-label="Importing video URL"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
          role="dialog"
        >
          <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-lg border bg-background p-8 text-center shadow-lg">
            <Loader2 aria-hidden="true" className="h-8 w-8 animate-spin text-primary" />
            <div>
              <h2 className="font-semibold">Importing video</h2>
              <p className="mt-1 text-sm text-muted-foreground">Fetching and validating the pasted URL…</p>
            </div>
            <button
              className="rounded border border-input px-4 py-2 text-sm font-medium hover:bg-accent"
              onClick={cancelVideoUrlImport}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </main>
  )
}

export default Home
