// The Flock browser script: plain TypeScript, no Effect, under 2 KB gzipped.
//   <script defer src="https://flock.example.com/flock.js" data-key="pk_production_…"></script>
// Events go to the origin the script was loaded from, unless `data-api` names another.
// `data-mode` is the Project's Tracking mode (ADR 0002), as the dashboard's snippet sets it:
// - cookieless (default): writes no cookies, localStorage or sessionStorage; `identify` is a no-op.
// - persistent: stores a random Visitor ID in localStorage (`flock_id`) and sends it with every
//   Event as `distinct_id`; after `identify(id)` (kept in `flock_uid`) Events are sent as `id`.
//   The snippet may be stale, so the script first asks `/api/ingest/config` for the Project's
//   mode. If the Project is cookieless now, it clears both keys and behaves as cookieless.
const tag = document.currentScript as HTMLScriptElement
const key = tag.dataset.key
const endpoint = `${tag.dataset.api ?? new URL(tag.src).origin}/api/ingest`

/** A v4 UUID. `crypto.randomUUID` only exists on secure (https) pages; `getRandomValues` works everywhere. */
const uuid = () =>
  "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0]! & (15 >> (+c / 4)))).toString(16))

/** Event properties: string, number, boolean or null values. Names starting with `$` are reserved for Flock. */
export type EventProperties = Record<string, string | number | boolean | null>

let persistent = tag.dataset.mode == "persistent"
/** Reads a stored value, first storing `value` if given. Storage can be blocked, so it may only last for the page. */
const stored = (name: string, value?: string): string | undefined => {
  try {
    if (value) localStorage.setItem(name, value)
    return localStorage.getItem(name) ?? value
  } catch {
    return value
  }
}
let deviceId: string | undefined
let distinctId: string | undefined
/**
 * Persistent snippets only: settles once the server confirmed the Project's Tracking mode. Until
 * then nothing is stored or sent. If the server can't be asked, the page stays cookieless.
 */
const ready = persistent
  ? fetch(`${endpoint}/config?key=${encodeURIComponent(key!)}`).then((r) => r.json()).then(
    ({ trackingMode }: { trackingMode: string }) => {
      persistent = trackingMode == "persistent"
      if (persistent) {
        deviceId = stored("flock_id") || stored("flock_id", uuid())
        distinctId = stored("flock_uid") || deviceId
      } else {
        try {
          localStorage.removeItem("flock_id")
          localStorage.removeItem("flock_uid")
        } catch {}
      }
    },
    () => {
      persistent = false
    }
  )
  : undefined
/** Runs `f` now, or once a persistent snippet's Tracking mode is confirmed (in call order). */
const whenReady = (f: () => void) => (ready ? ready.then(f) : f())

/** Sends one Event now; call it only once the Tracking mode is settled. */
const post = (name: string, properties: Record<string, unknown>, $url = location.href) => {
  const event = { uuid: uuid(), name, distinct_id: distinctId, properties: { ...properties, $url } }
  const body = JSON.stringify({ key, events: [event] })
  // A string body goes as text/plain, which needs no CORS preflight. sendBeacon survives page
  // unload; it is missing in some browsers and returns false when its queue is full.
  if (!navigator.sendBeacon?.(endpoint, body)) fetch(endpoint, { method: "POST", body, keepalive: true }).catch(() => {})
}

const send = (name: string, properties: Record<string, unknown> = {}) => {
  const $url = location.href
  whenReady(() => post(name, properties, $url))
}

let lastUrl: string | undefined
const pageview = () => {
  if (location.href === lastUrl) return
  lastUrl = location.href
  send("$pageview", { $referrer: document.referrer })
}

// SPA navigation: the app calls pushState; back and forward fire popstate.
const pushState = history.pushState
history.pushState = function (...args: Parameters<History["pushState"]>) {
  pushState.apply(this, args)
  pageview()
}
addEventListener("popstate", pageview)

/** Links this device to `id` from the app's own user system. Persistent mode only. */
const identify = (id: string) =>
  whenReady(() => {
    if (!persistent || !id || id == distinctId) return
    distinctId = stored("flock_uid", id)
    post("$identify", { $anon_distinct_id: deviceId })
  })

declare global {
  interface Window {
    flock: { track: (name: string, properties?: EventProperties) => void; identify: (id: string) => void }
  }
}
window.flock = { track: send, identify }

pageview()
