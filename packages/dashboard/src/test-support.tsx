// What the dashboard's happy-dom tests share: a React mount that is cleaned up after each test,
// a memory router around components that navigate, and the API stubbed at fetch.
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { act, type ReactNode, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterAll, afterEach, beforeAll, vi } from "vitest"

// React only runs effects inside act() when told it is under test.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let container: HTMLElement | undefined
let refresh: (() => void) | undefined

/** Unmounts what the test rendered; also runs after each test. */
export const unmount = () => {
  act(() => root?.unmount())
  container?.remove()
  root = container = refresh = undefined
}
afterEach(unmount)

/** Renders into the test's page; a second call re-renders the mounted tree instead of replacing it. */
export const render = (node: ReactNode) => {
  if (!root) {
    container = document.body.appendChild(document.createElement("div"))
    root = createRoot(container)
  }
  act(() => root!.render(node))
  return container!
}

/** Lets pending requests settle and React render their results. */
export const settle = async (rounds = 3) => {
  for (let i = 0; i < rounds; i++) await act(() => new Promise((resolve) => setTimeout(resolve, 10)))
}

/**
 * Renders `view` inside a memory router, for components that navigate or link, and settles.
 * `view` is called on every render, so it can read the test's current props; see `rerender`.
 */
export const renderRouted = async (view: () => ReactNode) => {
  const Host = () => {
    const [, setVersion] = useState(0)
    refresh = () => setVersion((version) => version + 1)
    return view()
  }
  const router = createRouter({ routeTree: createRootRoute({ component: Host }), history: createMemoryHistory() })
  await router.load()
  const page = render(<RouterProvider router={router} />)
  await settle()
  return page
}

/** Renders the `renderRouted` view again, as a parent passing new props would, and settles. */
export const rerender = async () => {
  act(() => refresh?.())
  await settle()
}

/** A JSON response from the API. */
export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

/** A response that never arrives. */
export const never = () => new Promise<Response>(() => {})

/**
 * Stubs the API at fetch for the whole test file. Effect keeps the fetch it first sees, so one
 * stub serves every test: each test sets `respond` to answer its requests.
 */
export const stubApi = () => {
  const api: { respond: (url: URL) => Response | Promise<Response> } = { respond: never }
  beforeAll(() => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) =>
      api.respond(new URL(input instanceof Request ? input.url : String(input), "http://localhost")))
  })
  afterAll(() => {
    vi.unstubAllGlobals()
  })
  return api
}
