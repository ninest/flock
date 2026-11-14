// @vitest-environment happy-dom
import { Environment, EnvironmentId, ProjectId } from "@flock/shared"
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { VisitorsList } from "./visitors.tsx"

// React only runs effects inside act() when told it is under test.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const environment = new Environment({ id: EnvironmentId.make("env_1"), name: "production", key: "pk_production_x", allowedOrigins: [] })

// The API is stubbed at fetch. Effect keeps the fetch it first sees, so one stub serves every test
// and answers with the current test's `respond`.
let respond: () => Promise<Response> = () => new Promise(() => {})
beforeAll(() => {
  vi.stubGlobal("fetch", () => respond())
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

/** Mounts the Visitors tab with the API answering through `respond`; resolves once a prompt response has rendered. */
const renderVisitors = async (response: () => Promise<Response>) => {
  respond = response
  const rootRoute = createRootRoute({
    component: () => (
      <VisitorsList projectId={ProjectId.make("prj_1")} environment={environment} search={{}} timeZone="UTC" onSearch={() => {}} />
    )
  })
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory() })
  container = document.body.appendChild(document.createElement("div"))
  root = createRoot(container)
  await act(async () => {
    await router.load()
    root!.render(<RouterProvider router={router} />)
  })
  // Lets the request settle and React render its result.
  await act(() => new Promise((resolve) => setTimeout(resolve, 10)))
  return container
}

/** A response that never arrives. */
const never = () => new Promise<Response>(() => {})

const json = (status: number, body: unknown) => async () =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

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
    const page = await renderVisitors(json(200, { visitors: [row("user_20418", true)], nextCursor: null }))
    expect(rowsOf(page)).toHaveLength(1)
    expect(rowsOf(page)[0]).toContain("user_20418")
    expect(rowsOf(page)[0]).toContain("Germany")
  })

  it("says so when no Visitors were active in the range", async () => {
    const page = await renderVisitors(json(200, { visitors: [], nextCursor: null }))
    expect(rowsOf(page)).toEqual([])
    expect(page.querySelector("[data-testid=visitors]")?.textContent).toContain("No Visitors in this range.")
  })

  it("shows the error's message when the request fails", async () => {
    const page = await renderVisitors(json(404, { _tag: "EnvironmentNotFound", id: "env_1" }))
    expect(page.querySelector("[data-testid=visitors] [role=alert]")?.textContent).toBe("Not found. It may have been deleted.")
  })
})
