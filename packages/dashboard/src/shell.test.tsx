// @vitest-environment happy-dom
import type { ReportRangeQuery } from "@flock/shared"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"
import { CustomDates } from "./shell.tsx"

// React only runs effects inside act() when told it is under test.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let container: HTMLElement | undefined

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = undefined
})

const custom = (from: string, to: string): ReportRangeQuery => ({ period: "custom", from, to })

/** Renders the custom-date inputs for `query`, as the shell does on every navigation; reuses the mounted component. */
const show = (query: ReportRangeQuery, onChange: (query: ReportRangeQuery) => void = () => {}) => {
  if (!root) {
    container = document.body.appendChild(document.createElement("div"))
    root = createRoot(container)
  }
  act(() => root!.render(<CustomDates query={query} onChange={onChange} />))
  return container!
}

const input = (page: HTMLElement, label: "From" | "To") => page.querySelector<HTMLInputElement>(`input[aria-label=${label}]`)!

/** Types a value into a date input the way a browser does, so React's onChange fires. */
const type = (page: HTMLElement, label: "From" | "To", value: string) => {
  const element = input(page, label)
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
  act(() => {
    setValue.call(element, value)
    element.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

describe("CustomDates", () => {
  it("shows the URL's new dates when the committed range changes (e.g. Back/Forward)", () => {
    show(custom("2026-11-01", "2026-11-07"))
    const page = show(custom("2026-11-02", "2026-11-07"))
    expect(input(page, "From").value).toBe("2026-11-02")
    expect(input(page, "To").value).toBe("2026-11-07")
  })

  it("keeps the other boundary at the URL's current value when one is edited afterwards", () => {
    const changes: Array<ReportRangeQuery> = []
    show(custom("2026-11-01", "2026-11-07"))
    const page = show(custom("2026-11-02", "2026-11-07"), (q) => changes.push(q))
    type(page, "To", "2026-11-09")
    expect(changes).toEqual([custom("2026-11-02", "2026-11-09")])
  })

  it("keeps an incomplete edit through a re-render that leaves the URL's range unchanged", () => {
    const page = show(custom("2026-11-01", "2026-11-07"))
    type(page, "From", "")
    show(custom("2026-11-01", "2026-11-07"))
    expect(input(page, "From").value).toBe("")
    expect(input(page, "To").value).toBe("2026-11-07")
  })
})
