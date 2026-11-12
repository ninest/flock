// The Flock browser script: plain TypeScript, no Effect, under 2 KB gzipped.
//   <script defer src="https://flock.example.com/flock.js" data-key="pk_production_…"></script>
// Events go to the origin the script was loaded from, unless `data-api` names another.
// `data-mode` is the Project's Tracking mode (ADR 0002), as the dashboard's snippet sets it:
// - cookieless (default): writes no cookies, localStorage or sessionStorage; `identify` is a no-op.
// - persistent: stores a random Visitor ID in localStorage (`flock_id`) and sends it with every
//   Event as `distinct_id`; after `identify(id)` (kept in `flock_uid`) Events are sent as `id`.
const tag = document.currentScript as HTMLScriptElement
const key = tag.dataset.key
const endpoint = `${tag.dataset.api ?? new URL(tag.src).origin}/api/ingest`

/** A v4 UUID. `crypto.randomUUID` only exists on secure (https) pages; `getRandomValues` works everywhere. */
const uuid = () =>
  "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0]! & (15 >> (+c / 4)))).toString(16))

/** Event properties: string, number, boolean or null values. Names starting with `$` are reserved for Flock. */
export type EventProperties = Record<string, string | number | boolean | null>

const persistent = tag.dataset.mode == "persistent"
/** Reads a stored value, first storing `value` if given. Storage can be blocked, so it may only last for the page. */
const stored = (name: string, value?: string): string | undefined => {
  try {
    if (value) localStorage.setItem(name, value)
    return localStorage.getItem(name) ?? value
  } catch {
    return value
  }
}
const deviceId = persistent ? stored("flock_id") || stored("flock_id", uuid()) : undefined
let distinctId = persistent ? stored("flock_uid") || deviceId : undefined

const send = (name: string, properties: Record<string, unknown> = {}) => {
  const event = { uuid: uuid(), name, distinct_id: distinctId, properties: { ...properties, $url: location.href } }
  const body = JSON.stringify({ key, events: [event] })
  // A string body goes as text/plain, which needs no CORS preflight. sendBeacon survives page
  // unload; it is missing in some browsers and returns false when its queue is full.
  if (!navigator.sendBeacon?.(endpoint, body)) fetch(endpoint, { method: "POST", body, keepalive: true }).catch(() => {})
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
const identify = (id: string) => {
  if (!persistent || !id || id == distinctId) return
  distinctId = stored("flock_uid", id)
  send("$identify", { $anon_distinct_id: deviceId })
}

declare global {
  interface Window {
    flock: { track: (name: string, properties?: EventProperties) => void; identify: (id: string) => void }
  }
}
window.flock = { track: send, identify }

pageview()
