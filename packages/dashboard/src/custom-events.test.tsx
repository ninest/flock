// @vitest-environment happy-dom
import { Environment, EnvironmentId, ProjectId } from "@flock/shared"
import { describe, expect, it } from "vitest"
import { CustomEvents } from "./custom-events.tsx"
import type { ProjectSearch } from "./project-search.ts"
import { json, renderRouted, stubApi, unmount } from "./test-support.tsx"

const environment = new Environment({ id: EnvironmentId.make("env_1"), name: "production", key: "pk_production_x", allowedOrigins: [] })

const range = { from: "2026-03-01", to: "2026-03-02", timeZone: "UTC", interval: "day" }
const buckets = ["2026-03-01", "2026-03-02"]
const stats = { count: 2, average: 15, sum: 30, min: 10, max: 20, median: 15 }

/** The Event properties the detail reports; the API answers from them. */
let properties: ReadonlyArray<{ key: string; types: ReadonlyArray<string> }> = []

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
  if (url.pathname.endsWith("/custom-event/stats")) return { ...range, totals: stats, series: buckets.map((bucket) => ({ bucket, ...stats })) }
  return { ...range, rows: [] }
}

const api = stubApi()

const renderEvents = (search: ProjectSearch) => {
  api.respond = (url) => json(200, answer(url))
  return renderRouted(() => (
    <CustomEvents
      projectId={ProjectId.make("prj_1")}
      environment={environment}
      environments={[environment]}
      search={{ tab: "events", event: "checkout", ...search }}
      timeZone="UTC"
      isOwner={false}
      onAddFilter={() => {}}
    />
  ))
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
