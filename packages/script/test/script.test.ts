import { describe, expect, it } from "vitest"
import { KEY, openPlayground, PLAYGROUND, type Playground, useBrowser } from "./harness.ts"

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
    expect(event).toMatchObject({
      name: "game_completed",
      properties: { score: expect.any(Number), level: expect.stringMatching(/^(easy|medium|hard)$/) }
    })
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

  it("sends with fetch, not sendBeacon, as a CORS-safelisted text/plain POST", async () => {
    // EasyPrivacy blocks third-party sendBeacon requests (`*$ping,third-party`).
    const site = await openPlayground(browser())
    await site.goto("/pricing")
    await site.waitForEvents(1)
    expect(site.requests[0]).toMatchObject({ transport: "fetch", method: "POST", contentType: expect.stringMatching(/^text\/plain/) })
  })

  it("delivers an Event sent while the page unloads", async () => {
    const site = await openPlayground(browser())
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

describe("Persistent mode", () => {
  const storage = (site: Playground) =>
    site.page.evaluate(() => ({ cookie: document.cookie, localStorage: localStorage.length, sessionStorage: sessionStorage.length }))

  it("sends the same stored Visitor ID with every Event, across page loads", async () => {
    const site = await openPlayground(browser(), { mode: "persistent" })
    await site.goto("/spa")
    await site.waitForEvents(1)
    await site.page.click("text=Settings")
    await site.page.evaluate(() => window.flock.track("a"))
    await site.waitForEvents(3)
    await site.page.reload()
    const events = await site.waitForEvents(4)
    const [first] = events
    expect(first!.distinct_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(events.map((e) => e.distinct_id)).toEqual([first!.distinct_id, first!.distinct_id, first!.distinct_id, first!.distinct_id])
    expect(await storage(site)).toEqual({ cookie: "", localStorage: 1, sessionStorage: 0 })
  })

  it("gives each device its own Visitor ID", async () => {
    const [a, b] = [await openPlayground(browser(), { mode: "persistent" }), await openPlayground(browser(), { mode: "persistent" })]
    await a.goto("/")
    await b.goto("/")
    const [[eventA], [eventB]] = [await a.waitForEvents(1), await b.waitForEvents(1)]
    expect(eventA!.distinct_id).not.toEqual(eventB!.distinct_id)
  })

  it("identify(id) sends $identify linking the device's Visitor ID, then sends later Events as that ID", async () => {
    const site = await openPlayground(browser(), { mode: "persistent" })
    await site.goto("/")
    const [pageview] = await site.waitForEvents(1)
    const deviceId = pageview!.distinct_id
    await site.page.click("text=Identify as test-user")
    await site.page.evaluate(() => window.flock.track("game_completed", { score: 1 }))
    await site.page.evaluate(() => window.flock.identify("test-user")) // already identified: nothing to send
    await site.page.reload()
    const events = await site.waitForEvents(4)
    expect(await site.settledEvents()).toHaveLength(4)
    expect(events.slice(1).map((e) => [e.name, e.distinct_id])).toEqual([
      ["$identify", "test-user"],
      ["game_completed", "test-user"],
      ["$pageview", "test-user"]
    ])
    expect(events[1]!.properties).toMatchObject({ $anon_distinct_id: deviceId })
  })
})

describe("Persistent mode: Display name", () => {
  it("identify(id, { name }) sends the name with $identify, and again only when it changed", async () => {
    const site = await openPlayground(browser(), { mode: "persistent" })
    await site.goto("/")
    const [pageview] = await site.waitForEvents(1)
    const deviceId = pageview!.distinct_id
    await site.page.evaluate(() => window.flock.identify("test-user", { name: "sam" }))
    await site.page.evaluate(() => window.flock.identify("test-user", { name: "sam" })) // unchanged: nothing to send
    await site.page.evaluate(() => window.flock.identify("test-user")) // no name: nothing to send
    await site.page.reload()
    await site.page.evaluate(() => window.flock.identify("test-user", { name: "sam" })) // still unchanged after a reload
    await site.page.evaluate(() => window.flock.identify("test-user", { name: "samuel" })) // renamed
    const events = await site.waitForEvents(4)
    expect(await site.settledEvents()).toHaveLength(4)
    expect(events.map((e) => [e.name, e.distinct_id, e.properties.$name])).toEqual([
      ["$pageview", deviceId, undefined],
      ["$identify", "test-user", "sam"],
      ["$pageview", "test-user", undefined],
      ["$identify", "test-user", "samuel"]
    ])
    expect(events[3]!.properties).toMatchObject({ $anon_distinct_id: deviceId })
  })
})

describe("Persistent mode: reset", () => {
  it("after identify, sends later Events as a new anonymous Visitor ID and sends nothing itself", async () => {
    const site = await openPlayground(browser(), { mode: "persistent" })
    await site.goto("/")
    const [pageview] = await site.waitForEvents(1)
    const deviceId = pageview!.distinct_id
    await site.page.click("text=Identify as test-user")
    await site.page.click("text=Reset")
    await site.page.evaluate(() => window.flock.track("a"))
    await site.page.reload()
    const events = await site.waitForEvents(4)
    expect(await site.settledEvents()).toHaveLength(4)
    expect(events.map((e) => e.name)).toEqual(["$pageview", "$identify", "a", "$pageview"])
    const [, , after, reloaded] = events
    expect(after!.distinct_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(after!.distinct_id).not.toEqual(deviceId)
    expect(reloaded!.distinct_id).toEqual(after!.distinct_id)
    const stored = await site.page.evaluate(() => ({ ...localStorage }))
    expect(stored).toEqual({ flock_id: after!.distinct_id })
  })

  it("then identify(id) links the new device Visitor ID", async () => {
    const site = await openPlayground(browser(), { mode: "persistent" })
    await site.goto("/")
    await site.waitForEvents(1)
    await site.page.click("text=Identify as test-user")
    await site.page.click("text=Reset")
    await site.page.evaluate(() => window.flock.track("a"))
    await site.page.click("text=Identify as test-user")
    const events = await site.waitForEvents(4)
    const [, , anonymous, identify] = events
    expect(identify).toMatchObject({ name: "$identify", distinct_id: "test-user", properties: { $anon_distinct_id: anonymous!.distinct_id } })
  })

  it("runs in call order with identify and track called before the Tracking mode is confirmed", async () => {
    const site = await openPlayground(browser(), { mode: "persistent" })
    await site.page.addInitScript(() =>
      addEventListener("DOMContentLoaded", () => {
        window.flock.identify("test-user")
        window.flock.reset()
        window.flock.track("a")
      }))
    await site.goto("/")
    const events = await site.waitForEvents(3)
    expect(await site.settledEvents()).toHaveLength(3)
    const [pageview, identify, a] = events
    expect(events.map((e) => e.name)).toEqual(["$pageview", "$identify", "a"])
    expect(identify!.properties).toMatchObject({ $anon_distinct_id: pageview!.distinct_id })
    expect(a!.distinct_id).not.toEqual("test-user")
    expect(a!.distinct_id).not.toEqual(pageview!.distinct_id)
  })

  it("on a device that was never identified, keeps its Visitor ID and sends nothing", async () => {
    const site = await openPlayground(browser(), { mode: "persistent" })
    await site.goto("/")
    const [pageview] = await site.waitForEvents(1)
    await site.page.click("text=Reset")
    await site.page.evaluate(() => window.flock.track("a"))
    const events = await site.settledEvents()
    expect(events.map((e) => [e.name, e.distinct_id])).toEqual([
      ["$pageview", pageview!.distinct_id],
      ["a", pageview!.distinct_id]
    ])
  })
})

describe("Persistent mode: open tabs", () => {
  it("identify and reset in one tab apply to Events another open tab sends, without a reload", async () => {
    const site = await openPlayground(browser(), { mode: "persistent" })
    await site.goto("/")
    await site.waitForEvents(1)
    const other = await site.openTab("/")
    const [pageview] = await site.waitForEvents(2)
    await site.page.click("text=Identify as test-user")
    await site.waitForEvents(3)
    await other.evaluate(() => window.flock.track("a"))
    await site.page.click("text=Reset")
    await other.evaluate(() => window.flock.track("b"))
    const events = await site.waitForEvents(5)
    const [, , , a, b] = events
    expect(a).toMatchObject({ name: "a", distinct_id: "test-user" })
    expect(b!.name).toBe("b")
    expect(b!.distinct_id).not.toEqual("test-user")
    expect(b!.distinct_id).not.toEqual(pageview!.distinct_id)
    expect(b!.distinct_id).toEqual(await site.page.evaluate(() => localStorage.getItem("flock_id")))
  })
})

describe("Persistent snippet on a Project that is now cookieless", () => {
  it("clears the stored Visitor IDs, stores nothing and sends no Visitor ID", async () => {
    const site = await openPlayground(browser(), {
      mode: "persistent",
      projectMode: "cookieless",
      localStorage: { flock_id: "11111111-1111-4111-8111-111111111111", flock_uid: "test-user" }
    })
    await site.goto("/")
    await site.waitForEvents(1)
    await site.page.evaluate(() => {
      window.flock.identify("other-user")
      window.flock.reset()
      window.flock.track("a")
    })
    const events = await site.settledEvents()
    expect(events.map((e) => e.name)).toEqual(["$pageview", "a"])
    for (const event of events) expect(event).not.toHaveProperty("distinct_id")
    const storage = await site.page.evaluate(() => ({ cookie: document.cookie, localStorage: localStorage.length, sessionStorage: sessionStorage.length }))
    expect(storage).toEqual({ cookie: "", localStorage: 0, sessionStorage: 0 })
  })
})

describe("Cookieless mode: reset", () => {
  it("is a no-op that sends nothing, stores nothing and adds no Visitor ID", async () => {
    const site = await openPlayground(browser())
    await site.goto("/")
    await site.waitForEvents(1)
    await site.page.click("text=Reset")
    await site.page.evaluate(() => window.flock.track("a"))
    const events = await site.settledEvents()
    expect(events.map((e) => e.name)).toEqual(["$pageview", "a"])
    for (const event of events) expect(event).not.toHaveProperty("distinct_id")
    expect(await site.page.evaluate(() => localStorage.length)).toBe(0)
  })
})

describe("Cookieless mode: identify", () => {
  it("is a no-op that sends nothing, stores nothing and adds no Visitor ID", async () => {
    const site = await openPlayground(browser())
    await site.goto("/")
    await site.waitForEvents(1)
    await site.page.click("text=Identify as test-user")
    await site.page.evaluate(() => window.flock.track("a"))
    const events = await site.settledEvents()
    expect(events.map((e) => e.name)).toEqual(["$pageview", "a"])
    for (const event of events) expect(event).not.toHaveProperty("distinct_id")
    const storage = await site.page.evaluate(() => ({ cookie: document.cookie, localStorage: localStorage.length, sessionStorage: sessionStorage.length }))
    expect(storage).toEqual({ cookie: "", localStorage: 0, sessionStorage: 0 })
  })
})
