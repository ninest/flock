// The Flock browser script: plain TypeScript, no Effect, under 2 KB gzipped.
//   <script defer src="https://flock.example.com/flock.js" data-key="pk_production_…"></script>
// Events go to the origin the script was loaded from, unless `data-api` names another.
// `data-mode` is the Project's Tracking mode (ADR 0002), as the dashboard's snippet sets it:
// - cookieless (default): writes no cookies, localStorage or sessionStorage; `identify` and
//   `reset` are no-ops.
// - persistent: stores a random Visitor ID in localStorage (`flock_id`) and sends it with every
//   Event as `distinct_id`; after `identify(id)` (kept in `flock_uid`) Events are sent as `id`.
//   `reset()` (Reset, on log out) forgets both and stores a new `flock_id`. Every send reads them
//   afresh, so Identify and Reset apply to all open tabs.
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
/** Values whose write to localStorage failed (storage blocked or full), so they last only for the page. */
const unsaved: Record<string, string | undefined> = {}
/**
 * Reads a stored value. It is read afresh every time, so an Identify or Reset in another tab of the
 * device applies to the next Event this tab sends.
 */
const load = (name: string): string | undefined => {
  try {
    return localStorage.getItem(name) ?? unsaved[name]
  } catch {
    return unsaved[name]
  }
}
/** Stores a value and returns it. If storage refuses it, any older stored value is removed so it can't win. */
const save = (name: string, value: string): string => {
  unsaved[name] = undefined
  try {
    localStorage.setItem(name, value)
  } catch {
    unsaved[name] = value
    forget(name, true)
  }
  return value
}
/** Removes a stored value; `keepUnsaved` keeps its page-only copy. */
const forget = (name: string, keepUnsaved?: boolean) => {
  if (!keepUnsaved) unsaved[name] = undefined
  try {
    localStorage.removeItem(name)
  } catch {}
}
/** The device's own Visitor ID, created on first use. */
const deviceId = () => load("flock_id") ?? save("flock_id", uuid())
/** The ID this device's Events are sent as: the identified ID after Identify, else the device's own. */
const distinctId = () => load("flock_uid") ?? deviceId()
/**
 * Persistent snippets only: settles once the server confirmed the Project's Tracking mode. Until
 * then nothing is stored or sent. If the server can't be asked, the page stays cookieless.
 */
const ready = persistent
  ? fetch(`${endpoint}/config?key=${encodeURIComponent(key!)}`).then((r) => r.json()).then(
    ({ trackingMode }: { trackingMode: string }) => {
      persistent = trackingMode == "persistent"
      if (!persistent) {
        forget("flock_id")
        forget("flock_uid")
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
  const distinct_id = persistent ? distinctId() : undefined
  const event = { uuid: uuid(), name, distinct_id, properties: { ...properties, $url } }
  const body = JSON.stringify({ key, events: [event] })
  // A string body goes as text/plain, which needs no CORS preflight; keepalive lets it outlive
  // page unload. Not sendBeacon: browsers send that as a "ping", and EasyPrivacy blocks every
  // third-party ping (`*$ping,third-party`), so adblockers would drop the Events.
  fetch(endpoint, { method: "POST", body, keepalive: true }).catch(() => {})
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
    if (!persistent || !id || id == distinctId()) return
    save("flock_uid", id)
    post("$identify", { $anon_distinct_id: deviceId() })
  })

/**
 * Reset: forgets who this device is, e.g. on log out, so later Events count as a new anonymous
 * Visitor. Persistent mode, identified devices only.
 */
const reset = () =>
  whenReady(() => {
    if (!persistent || !load("flock_uid")) return
    forget("flock_uid")
    save("flock_id", uuid())
  })

declare global {
  interface Window {
    flock: { track: (name: string, properties?: EventProperties) => void; identify: (id: string) => void; reset: () => void }
  }
}
window.flock = { track: send, identify, reset }

pageview()
