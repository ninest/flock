// Playground: a plain HTML/JS site on its own dev port that sends Events to a Flock server.
// Every HTML page gets `window.FLOCK = { api, key }` injected, so pages need no build step.
import { createServer } from "node:http"
import { readFile } from "node:fs/promises"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"

const port = Number(process.env.PORT ?? 2102)
const serverPort = Number(process.env.FLOCK_SERVER_PORT ?? 2100)
const config = {
  /** Where Events go. Defaults to the dev server on the same host the page was opened from. */
  api: process.env.FLOCK_API ?? null,
  /** The `dev` Environment's key of the seeded Playground Project. */
  key: process.env.FLOCK_KEY ?? "pk_dev_playground"
}
const root = fileURLToPath(new URL("./pages", import.meta.url))
const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" }

createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://x").pathname
  const file = normalize(join(root, path.endsWith("/") ? `${path}index.html` : path))
  if (!file.startsWith(root)) return res.writeHead(403).end()
  const candidates = extname(file) ? [file] : [file, `${file}.html`]
  for (const candidate of candidates) {
    try {
      let body: string | Buffer = await readFile(candidate)
      const type = types[extname(candidate)] ?? "application/octet-stream"
      if (type.startsWith("text/html")) {
        const api = config.api ?? `http://${(req.headers.host ?? "localhost").replace(/:\d+$/, "")}:${serverPort}`
        const inject = `<script>window.FLOCK = ${JSON.stringify({ ...config, api })}</script>`
        body = body.toString().replace("<head>", `<head>\n    ${inject}`)
      }
      return res.writeHead(200, { "content-type": type, "cache-control": "no-store" }).end(body)
    } catch {}
  }
  res.writeHead(404, { "content-type": "text/plain" }).end("Not found")
}).listen(port, () => console.log(`Playground on http://hel:${port}`))
