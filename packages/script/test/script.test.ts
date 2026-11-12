import { describe, expect, it } from "vitest"
import { KEY, openPlayground, PLAYGROUND, useBrowser } from "./harness.ts"

const browser = useBrowser()

describe("Pageviews", () => {
  it("sends one Pageview when a page loads", async () => {
    const site = await openPlayground(browser())
    await site.goto("/pricing")
    const events = await site.settledEvents()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ name: "$pageview", properties: { $url: `${PLAYGROUND}/pricing` } })
    expect(site.requests[0]!.key).toBe(KEY)
  })

  it("sends a Pageview for each SPA route change, including back and forward", async () => {
    const site = await openPlayground(browser())
    await site.goto("/spa")
    await site.waitForEvents(1)
    await site.page.click("text=Settings")
    await site.waitForEvents(2)
    await site.page.click("text=Billing")
    await site.waitForEvents(3)
    await site.page.goBack()
    await site.waitForEvents(4)
    await site.page.goForward()
    const events = await site.waitForEvents(5)
    expect(await site.settledEvents()).toHaveLength(5)
    expect(events.map((e) => [e.name, e.properties.$url])).toEqual([
      ["$pageview", `${PLAYGROUND}/spa`],
      ["$pageview", `${PLAYGROUND}/spa/settings`],
      ["$pageview", `${PLAYGROUND}/spa/billing`],
      ["$pageview", `${PLAYGROUND}/spa/settings`],
      ["$pageview", `${PLAYGROUND}/spa/billing`]
    ])
  })

  it("sends no Pageview when the SPA pushes the URL it is already on", async () => {
    const site = await openPlayground(browser())
    await site.goto("/spa")
    await site.waitForEvents(1)
    await site.page.click("text=Overview")
    expect(await site.settledEvents()).toHaveLength(1)
  })
})

describe("Custom events", () => {
  it("track(name, props) sends a Custom event carrying its Event properties", async () => {
    const site = await openPlayground(browser())
    await site.goto("/")
    await site.waitForEvents(1)
    await site.page.click("text=Complete game")
    const [, event] = await site.waitForEvents(2)
    expect(event).toMatchObject({ name: "game_completed", properties: { score: expect.any(Number) } })
  })

  it("track(name) sends a Custom event from the page's own code", async () => {
    const site = await openPlayground(browser())
    await site.goto("/pricing")
    await site.waitForEvents(1)
    await site.page.evaluate(() => window.flock.track("plan_selected", { plan: "pro", seats: 3 }))
    const [, event] = await site.waitForEvents(2)
    expect(event).toMatchObject({ name: "plan_selected", properties: { plan: "pro", seats: 3 } })
  })
})

describe("Delivery", () => {
  it("gives every Event its own v4 UUID", async () => {
    const site = await openPlayground(browser())
    await site.goto("/spa")
    await site.waitForEvents(1)
    await site.page.click("text=Settings")
    await site.page.evaluate(() => {
      window.flock.track("a")
      window.flock.track("a")
    })
    const uuids = (await site.waitForEvents(4)).map((e) => e.uuid)
    for (const uuid of uuids) expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(new Set(uuids).size).toBe(4)
  })

  it("sends with sendBeacon, as a CORS-safelisted text/plain POST", async () => {
    const site = await openPlayground(browser())
    await site.goto("/pricing")
    await site.waitForEvents(1)
    expect(site.requests[0]).toMatchObject({ transport: "ping", method: "POST", contentType: expect.stringMatching(/^text\/plain/) })
  })

  it("falls back to fetch when sendBeacon is unavailable", async () => {
    const site = await openPlayground(browser(), { sendBeacon: false })
    await site.goto("/pricing")
    await site.waitForEvents(1)
    expect(site.requests[0]).toMatchObject({ transport: "fetch", method: "POST", contentType: expect.stringMatching(/^text\/plain/) })
  })

  for (const sendBeacon of [true, false]) {
    it(`delivers an Event sent while the page unloads (${sendBeacon ? "sendBeacon" : "fetch keepalive"})`, async () => {
      const site = await openPlayground(browser(), { sendBeacon })
      await site.goto("/")
      await site.waitForEvents(1)
      await site.page.click("text=Log in") // tracks login_clicked, then leaves for /pricing at once
      await site.page.waitForURL(`**/pricing`)
      const events = await site.waitForEvents(3)
      expect(events.map((e) => [e.name, e.properties.$url])).toEqual([
        ["$pageview", "http://playground.test/"],
        ["login_clicked", "http://playground.test/"],
        ["$pageview", "http://playground.test/pricing"]
      ])
    })
  }
})

describe("Cookieless mode", () => {
  it("writes no cookies, localStorage or sessionStorage", async () => {
    const site = await openPlayground(browser())
    await site.goto("/spa")
    await site.page.click("text=Settings")
    await site.page.evaluate(() => window.flock.track("a", { b: 1 }))
    await site.waitForEvents(3)
    const storage = await site.page.evaluate(() => ({
      cookie: document.cookie,
      localStorage: localStorage.length,
      sessionStorage: sessionStorage.length
    }))
    expect(storage).toEqual({ cookie: "", localStorage: 0, sessionStorage: 0 })
    expect(await site.page.context().cookies()).toEqual([])
  })
})

describe("Playground: pages and sources", () => {
  it("following a link between pages sends a Pageview with the new URL and the previous page as referrer", async () => {
    const site = await openPlayground(browser())
    await site.goto("/blog")
    await site.waitForEvents(1)
    await site.page.click("text=First post")
    const [, post] = await site.waitForEvents(2)
    expect(post).toMatchObject({
      name: "$pageview",
      properties: { $url: `${PLAYGROUND}/blog/first-post`, $referrer: `${PLAYGROUND}/blog` }
    })
  })

  it("a campaign link arrives with its utm_* tags and a simulated external referrer", async () => {
    const site = await openPlayground(browser())
    await site.goto("/sources")
    await site.waitForEvents(1)
    await site.page.click("text=Hacker News launch post")
    const [, landing] = await site.waitForEvents(2)
    const url = new URL(landing!.properties.$url as string)
    expect(url.pathname).toBe("/blog/first-post")
    expect(Object.fromEntries([...url.searchParams].filter(([name]) => name.startsWith("utm_")))).toEqual({
      utm_source: "hackernews",
      utm_medium: "social",
      utm_campaign: "launch"
    })
    expect(landing!.properties.$referrer).toBe("https://news.ycombinator.com/item?id=42")
  })
})
