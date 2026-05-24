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
    // Python backend's internal Docker service address (http://app:8080).
    // Outside Docker (plain `npm run dev`) it falls back to localhost so local
    // development without Docker still works.
    proxy: {
      "/api": {
        target: process.env.API_TARGET ?? "http://localhost:8080",
        changeOrigin: true,
      },
      "/socket.io": {
        target: process.env.API_TARGET ?? "http://localhost:8080",
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
