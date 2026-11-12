// Playground site: plain HTML pages that load the real Flock browser script from a Flock server.
// serve.ts serves it on a dev port; the Seam 2 tests serve it inside a headless browser.
import { readFile } from "node:fs/promises"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"

export interface PlaygroundConfig {
  /** The Flock server's origin; the script is loaded from `${api}/flock.js` and sends Events there. */
  readonly api: string
  /** The Environment key the script is configured with. */
  readonly key: string
}

export interface PlaygroundResponse {
  readonly status: number
  readonly contentType: string
  readonly body: string | Buffer
}

const root = fileURLToPath(new URL("./pages", import.meta.url))
const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" }

const SIMULATE_REFERRER =
  `(() => { const r = new URLSearchParams(location.search).get("simulate_referrer"); ` +
  `if (r !== null) Object.defineProperty(document, "referrer", { get: () => r }) })()`

/**
 * Every HTML page gets the browser script tag and `window.FLOCK = { api, key }` injected,
 * so pages need no build step. `?simulate_referrer=<url>` on any page fakes `document.referrer`.
 */
export const renderPlayground = async (path: string, config: PlaygroundConfig): Promise<PlaygroundResponse> => {
  if (path.startsWith("/spa/")) path = "/spa" // the fake SPA's client-side routes
  const file = normalize(join(root, path.endsWith("/") ? `${path}index.html` : path))
  if (!file.startsWith(root)) return { status: 403, contentType: "text/plain", body: "Forbidden" }
  const candidates = extname(file) ? [file] : [file, `${file}.html`]
  for (const candidate of candidates) {
    let body: string | Buffer
    try {
      body = await readFile(candidate)
    } catch {
      continue
    }
    const contentType = types[extname(candidate)] ?? "application/octet-stream"
    if (contentType.startsWith("text/html")) {
      const inject = [
        `<script>window.FLOCK = ${JSON.stringify(config)}</script>`,
        // The Sources page simulates arriving from another site: `?simulate_referrer=` sets
        // document.referrer before the (deferred) browser script reads it.
        `<script>${SIMULATE_REFERRER}</script>`,
        `<script defer src="${config.api}/flock.js" data-key="${config.key}"></script>`
      ].join("\n    ")
      body = body.toString().replace("<head>", `<head>\n    ${inject}`)
    }
    return { status: 200, contentType, body }
  }
  return { status: 404, contentType: "text/plain", body: "Not found" }
}
