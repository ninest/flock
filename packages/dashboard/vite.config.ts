import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const serverUrl = process.env.FLOCK_SERVER_URL ?? "http://localhost:2100"

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: Number(process.env.PORT ?? 2101),
    strictPort: true,
    allowedHosts: true,
    proxy: { "/api": serverUrl }
  },
  build: { outDir: "dist", emptyOutDir: true }
})
