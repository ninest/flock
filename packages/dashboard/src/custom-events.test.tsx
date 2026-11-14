// @vitest-environment happy-dom
import { Environment, EnvironmentId, ProjectId } from "@flock/shared"
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { CustomEvents } from "./custom-events.tsx"
import type { ProjectSearch } from "./project-search.ts"

// React only runs effects inside act() when told it is under test.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

// The API is stubbed at fetch. Effect keeps the fetch it first sees, so one stub serves every test.
beforeAll(() => {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input), "http://localhost")
    return new Response(JSON.stringify(answer(url)), { status: 200, headers: { "content-type": "application/json" } })
  })
})
afterAll(() => {
  vi.unstubAllGlobals()
})

let root: Root | undefined
let container: HTMLElement | undefined

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
})

const renderEvents = async (search: ProjectSearch) => {
  const rootRoute = createRootRoute({
    component: () => (
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
  })
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory() })
  container = document.body.appendChild(document.createElement("div"))
  root = createRoot(container)
  await act(async () => {
    await router.load()
    root!.render(<RouterProvider router={router} />)
  })
  // Lets the requests settle and React render their results.
  for (let i = 0; i < 3; i++) await act(() => new Promise((resolve) => setTimeout(resolve, 10)))
  return container
}

const pressed = (page: HTMLElement, group: string) =>
  [...page.querySelectorAll(`[data-testid=${group}] button[aria-pressed=true]`)].map((b) => b.textContent)

describe("Custom event chart choices", () => {
  it("charts Event count by default and Visitors when the URL asks", async () => {
    properties = []
    expect(pressed(await renderEvents({}), "custom-event-measure")).toEqual(["Events"])
    act(() => root?.unmount())
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
