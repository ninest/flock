// @vitest-environment happy-dom
import { Environment, EnvironmentId, ProjectId } from "@flock/shared"
import { describe, expect, it } from "vitest"
import { CustomEvents } from "./custom-events.tsx"
import type { ProjectSearch } from "./project-search.ts"
import { json, never, renderRouted, rerender, stubApi, unmount } from "./test-support.tsx"

const environment = new Environment({ id: EnvironmentId.make("env_1"), name: "production", key: "pk_production_x", allowedOrigins: [] })

const range = { from: "2026-03-01", to: "2026-03-02", timeZone: "UTC", interval: "day" }
const buckets = ["2026-03-01", "2026-03-02"]
const stats = { count: 2, average: 15, sum: 30, min: 10, max: 20, median: 15 }

/** The Event properties the detail reports; the API answers from them. */
let properties: ReadonlyArray<{ key: string; types: ReadonlyArray<string> }> = []

/** Statistics that differ from `stats`, per numeric Event property. */
let statsOf: Record<string, Partial<typeof stats>> = {}

const answer = (url: URL): unknown => {
  if (url.pathname.endsWith("/custom-events")) {
    return { ...range, events: [{ name: "checkout", count: 4, visitors: 2, previousCount: 1, series: buckets.map((bucket) => ({ bucket, count: 2 })) }] }
  }
  if (url.pathname.endsWith("/custom-event")) {
    return {
      ...range,
      name: "checkout",
      totals: { count: 4, visitors: 2 },
      series: buckets.map((bucket) => ({ bucket, count: 2, visitors: 1 })),
      properties,
      annotations: []
    }
  }
  if (url.pathname.endsWith("/custom-event/stats")) {
    const totals = { ...stats, ...statsOf[url.searchParams.get("eventProperty")!] }
    return { ...range, totals, series: buckets.map((bucket) => ({ bucket, ...totals })) }
  }
  return { ...range, rows: [] }
}

const api = stubApi()

/** The search params the page is rendered with; change them and `rerender()` to navigate. */
let search: ProjectSearch = {}

const view = () => (
  <CustomEvents
    projectId={ProjectId.make("prj_1")}
    environment={environment}
    environments={[environment]}
    search={{ tab: "events", event: "checkout", ...search }}
    timeZone="UTC"
    isOwner={false}
    onAddFilter={() => {}}
  />
)

const renderEvents = (initial: ProjectSearch) => {
  search = initial
  api.respond = (url) => json(200, answer(url))
  return renderRouted(view)
}

const pressed = (page: HTMLElement, group: string) =>
  [...page.querySelectorAll(`[data-testid=${group}] button[aria-pressed=true]`)].map((b) => b.textContent)

describe("Custom event chart choices", () => {
  it("charts Event count by default and Visitors when the URL asks", async () => {
    properties = []
    expect(pressed(await renderEvents({}), "custom-event-measure")).toEqual(["Events"])
    unmount()
    expect(pressed(await renderEvents({ measure: "visitors" }), "custom-event-measure")).toEqual(["Unique Visitors"])
  })

  it("shows no numeric chart for an event with no numeric property", async () => {
    properties = [{ key: "plan", types: ["string"] }]
    const page = await renderEvents({ stat: "median" })
    expect(page.querySelector("[data-testid=custom-event-stats]")).toBeNull()
    expect(page.querySelector("[data-testid=custom-event-statistic]")).toBeNull()
  })

  it("charts the numeric property and statistic the URL names", async () => {
    properties = [{ key: "price", types: ["number"] }, { key: "items", types: ["number"] }]
    const page = await renderEvents({ number: "items", stat: "median" })
    expect(pressed(page, "custom-event-statistic")).toEqual(["Median"])
    const charted = page.querySelector("[data-testid=custom-event-stats] [role=row][aria-current=true]")
    expect(charted?.textContent).toContain("items")
    expect(charted?.textContent).toContain("15")
  })
})

/** The Numbers rows as [property, average]. */
const numbers = (page: HTMLElement) =>
  [...page.querySelectorAll("[data-testid=custom-event-stats] [role=row]")].slice(1) // after the header
    .map((r) => [r.children[0]?.textContent, r.children[1]?.textContent])

describe("Custom event numeric statistics", () => {
  it("shows the properties that loaded when another one's request fails", async () => {
    properties = [{ key: "price", types: ["number"] }, { key: "items", types: ["number"] }]
    statsOf = {}
    api.respond = (url) =>
      url.searchParams.get("eventProperty") === "items" ? json(500, {}) : json(200, answer(url))
    search = {}
    const page = await renderRouted(view)
    expect(numbers(page)).toEqual([["price", "15"], ["items", "–"]])
  })

  it("never shows one property's statistics under another's name while the new ones load", async () => {
    properties = [{ key: "price", types: ["number"] }, { key: "items", types: ["number"] }]
    statsOf = { items: { average: 3 } }
    const page = await renderEvents({ period: "7d" })
    expect(numbers(page)).toEqual([["price", "15"], ["items", "3"]])

    // Another range, where the event has other numeric properties; their statistics are slow to arrive.
    properties = [{ key: "items", types: ["number"] }, { key: "weight", types: ["number"] }]
    api.respond = (url) => url.pathname.endsWith("/custom-event/stats") ? never() : json(200, answer(url))
    search = { period: "30d" }
    await rerender()
    expect(numbers(page)).toEqual([["items", "3"], ["weight", "–"]])
  })
})
