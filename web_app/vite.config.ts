import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // When running inside the Docker dev container, API_TARGET is set to the
    // Python backend's internal Docker service address (http://app:8088).
    // Outside Docker (plain `npm run dev`) it falls back to localhost so local
    // development without Docker still works.
    watch: {
      // Windows NTFS does not emit inotify events that the Linux container can
      // observe, so Vite's default FSEvents/inotify watcher never fires for
      // host-side edits.  Polling detects changes regardless of the underlying
      // filesystem and keeps HMR working with Docker bind-mounts on Windows.
      usePolling: true,
      interval: 300,
    },
    proxy: {
      "/api": {
        target: process.env.API_TARGET ?? "http://localhost:8088",
        changeOrigin: true,
      },
      "/socket.io": {
        target: process.env.API_TARGET ?? "http://localhost:8088",
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
