// The Flock browser script: plain TypeScript, no Effect, under 2 KB gzipped.
//   <script defer src="https://flock.example.com/flock.js" data-key="pk_production_…"></script>
// Events go to the origin the script was loaded from, unless `data-api` names another.
// Cookieless: it writes no cookies, localStorage or sessionStorage.
const tag = document.currentScript as HTMLScriptElement
const key = tag.dataset.key
const endpoint = `${tag.dataset.api ?? new URL(tag.src).origin}/api/ingest`

/** A v4 UUID. `crypto.randomUUID` only exists on secure (https) pages; `getRandomValues` works everywhere. */
const uuid = () =>
  "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0]! & (15 >> (+c / 4)))).toString(16))

/** Event properties: string, number, boolean or null values. Names starting with `$` are reserved for Flock. */
export type EventProperties = Record<string, string | number | boolean | null>

const send = (name: string, properties: Record<string, unknown> = {}) => {
  const event = { uuid: uuid(), name, properties: { ...properties, $url: location.href } }
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

declare global {
  interface Window {
    flock: { track: (name: string, properties?: EventProperties) => void }
  }
}
window.flock = { track: send }

pageview()
