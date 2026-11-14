// @vitest-environment happy-dom
import { Environment, EnvironmentId, ProjectId } from "@flock/shared"
import { describe, expect, it } from "vitest"
import { json, never, renderRouted, stubApi } from "./test-support.tsx"
import { VisitorsList } from "./visitors.tsx"

const environment = new Environment({ id: EnvironmentId.make("env_1"), name: "production", key: "pk_production_x", allowedOrigins: [] })

const api = stubApi()

/** Mounts the Visitors tab with the API answering through `respond`; resolves once a prompt response has rendered. */
const renderVisitors = (respond: () => Response | Promise<Response>) => {
  api.respond = respond
  return renderRouted(() => (
    <VisitorsList projectId={ProjectId.make("prj_1")} environment={environment} search={{}} timeZone="UTC" onSearch={() => {}} />
  ))
}

const row = (visitorId: string, identified: boolean) => ({
  visitorId,
  identified,
  firstSeenAt: "2026-11-01T09:00:00.000Z",
  lastSeenAt: "2026-11-13T09:00:00.000Z",
  sessions: 3,
  events: 12,
  country: "DE",
  device: "desktop",
  browser: "Firefox",
  referringDomain: null
})

/** The Visitors list's rows, as text. */
const rowsOf = (page: HTMLElement) => [...page.querySelectorAll("[data-testid=visitors] a[role=row]")].map((r) => r.textContent)

describe("VisitorsList", () => {
  it("shows the loading state while the request is pending", async () => {
    const page = await renderVisitors(never)
    expect(page.querySelector("[data-testid=visitors]")?.textContent).toContain("Loading…")
  })

  it("shows the Visitors once they load", async () => {
    const page = await renderVisitors(() => json(200, { visitors: [row("user_20418", true)], nextCursor: null }))
    expect(rowsOf(page)).toHaveLength(1)
    expect(rowsOf(page)[0]).toContain("user_20418")
    expect(rowsOf(page)[0]).toContain("Germany")
  })

  it("says so when no Visitors were active in the range", async () => {
    const page = await renderVisitors(() => json(200, { visitors: [], nextCursor: null }))
    expect(rowsOf(page)).toEqual([])
    expect(page.querySelector("[data-testid=visitors]")?.textContent).toContain("No Visitors in this range.")
  })

  it("shows the error's message when the request fails", async () => {
    const page = await renderVisitors(() => json(404, { _tag: "EnvironmentNotFound", id: "env_1" }))
    expect(page.querySelector("[data-testid=visitors] [role=alert]")?.textContent).toBe("Not found. It may have been deleted.")
  })
})
