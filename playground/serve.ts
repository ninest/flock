// Playground: a plain HTML/JS site on its own dev port that sends Events to a Flock server
// through the real browser script (served by that server at /flock.js).
import { createServer } from "node:http"
import { renderPlayground } from "./site.ts"

const port = Number(process.env.PORT ?? 2102)
const serverPort = Number(process.env.FLOCK_SERVER_PORT ?? 2100)
/** Where Events go. Defaults to the dev server on the same host the page was opened from. */
const api = process.env.FLOCK_API ?? null
/** The `dev` Environment's key of the seeded Playground Project. */
const key = process.env.FLOCK_KEY ?? "pk_dev_playground"

createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://x").pathname
  const host = (req.headers.host ?? "localhost").replace(/:\d+$/, "")
  const page = await renderPlayground(path, { api: api ?? `http://${host}:${serverPort}`, key })
  res.writeHead(page.status, { "content-type": page.contentType, "cache-control": "no-store" }).end(page.body)
}).listen(port, () => console.log(`Playground on http://hel:${port}`))
