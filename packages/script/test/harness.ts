// Seam 2 harness: the playground pages in headless Chromium, loading the freshly built
// browser script. No real servers: Playwright serves the playground and the script, and
// captures every request the script sends to the ingest endpoint.
//
// Usage:
//   const browser = useBrowser()
//   it("sends a Pageview", async () => {
//     const site = await openPlayground(browser())
//     await site.goto("/")
//     expect(await site.waitForEvents(1)).toMatchObject([{ name: "$pageview" }])
//   })
//
// Tests observe behavior only through the outgoing requests and the page itself.
import { afterAll, beforeAll } from "vitest"
import { type Browser, chromium, type Page } from "playwright"
import { renderPlayground, type TrackingMode } from "../../../playground/site.ts"
import { buildScript } from "../build.ts"

export const PLAYGROUND = "http://playground.test"
export const FLOCK = "http://flock.test"
export const KEY = "pk_dev_seam2"

/** One Event as the script sent it. */
export interface SentEvent {
  readonly uuid: string
  readonly name: string
  /** The persistent Visitor ID; only sent in persistent Tracking mode. */
  readonly distinct_id?: string
  readonly properties: Record<string, unknown>
}

/** One request to the ingest endpoint. */
export interface IngestRequest {
  /** "ping" for sendBeacon, "fetch" for fetch. */
  readonly transport: string
  readonly method: string
  readonly contentType: string | undefined
  readonly key: string
  readonly events: ReadonlyArray<SentEvent>
}

/** Launches one headless Chromium for the test file. */
export const useBrowser = (): (() => Browser) => {
  let browser: Browser | undefined
  beforeAll(async () => {
    browser = await chromium.launch()
  })
  afterAll(async () => {
    await browser?.close()
  })
  return () => browser!
}

let script: Promise<string> | undefined
const builtScript = () => (script ??= buildScript().then((b) => b.code))

export interface Playground {
  readonly page: Page
  /** Every ingest request so far, in order. */
  readonly requests: Array<IngestRequest>
  /** Every Event sent so far, in order. */
  readonly events: () => Array<SentEvent>
  /** Opens a playground path, e.g. "/spa". */
  readonly goto: (path: string) => Promise<void>
  /** Resolves once at least `count` Events were sent, with all Events sent so far. */
  readonly waitForEvents: (count: number) => Promise<Array<SentEvent>>
  /** Waits a little and returns all Events, to check that no more were sent. */
  readonly settledEvents: () => Promise<Array<SentEvent>>
  /** Opens a playground path in another tab on the same device; its Events are captured here too. */
  readonly openTab: (path: string) => Promise<Page>
}

export const openPlayground = async (
  browser: Browser,
  options: {
    /** The Tracking mode in the page's snippet (`data-mode`). Default: cookieless. */
    readonly mode?: TrackingMode
    /** The Project's Tracking mode, as `/api/ingest/config` answers it. Default: `mode`. */
    readonly projectMode?: TrackingMode
    /** localStorage entries the page starts with, e.g. a Visitor ID from an earlier visit. */
    readonly localStorage?: Record<string, string>
  } = {}
): Promise<Playground> => {
  const code = await builtScript()
  const context = await browser.newContext()
  if (options.localStorage !== undefined) {
    await context.addInitScript((entries) => {
      for (const [name, value] of Object.entries(entries)) localStorage.setItem(name, value)
    }, options.localStorage)
  }
  const requests: Array<IngestRequest> = []
  await context.route(`${PLAYGROUND}/**`, async (route) => {
    const page = await renderPlayground(new URL(route.request().url()).pathname, {
      api: FLOCK,
      key: KEY,
      mode: options.mode ?? "cookieless"
    })
    await route.fulfill({ status: page.status, contentType: page.contentType, body: page.body })
  })
  await context.route(`${FLOCK}/flock.js`, (route) => route.fulfill({ contentType: "text/javascript", body: code }))
  await context.route(`${FLOCK}/api/ingest/config?**`, (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ trackingMode: options.projectMode ?? options.mode ?? "cookieless" })
    }))
  await context.route(`${FLOCK}/api/ingest`, async (route) => {
    const request = route.request()
    const batch = JSON.parse(request.postData() ?? "null") as { key: string; events: Array<SentEvent> }
    requests.push({
      transport: request.resourceType(),
      method: request.method(),
      contentType: await request.headerValue("content-type") ?? undefined,
      key: batch.key,
      events: batch.events
    })
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ accepted: batch.events.length, rejected: [] })
    })
  })
  const newPage = async () => {
    const page = await context.newPage()
    page.on("pageerror", (e) => console.error("pageerror", e.message))
    return page
  }
  const page = await newPage()
  const events = () => requests.flatMap((r) => r.events)
  return {
    page,
    requests,
    events,
    goto: async (path) => {
      await page.goto(`${PLAYGROUND}${path}`)
    },
    waitForEvents: async (count) => {
      const deadline = Date.now() + 5_000
      while (events().length < count) {
        if (Date.now() > deadline) throw new Error(`Expected ${count} Events, got ${JSON.stringify(events())}`)
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      return events()
    },
    settledEvents: async () => {
      await new Promise((resolve) => setTimeout(resolve, 300))
      return events()
    },
    openTab: async (path) => {
      const tab = await newPage()
      await tab.goto(`${PLAYGROUND}${path}`)
      return tab
    }
  }
}
