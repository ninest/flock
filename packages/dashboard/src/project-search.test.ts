import { describe, expect, it } from "vitest"
import { reportQuery, searchFor, validateProjectSearch, withFilter, withQuery } from "./project-search.ts"

const country = { eventProperty: "$country", op: "is" as const, value: "DE" }

describe("validateProjectSearch", () => {
  it("keeps valid params", () => {
    expect(validateProjectSearch({ env: "dev", tab: "events", event: "signup", period: "30d", filters: [country] })).toEqual({
      env: "dev",
      tab: "events",
      event: "signup",
      period: "30d",
      filters: [country]
    })
  })
  it("drops params a hand-edited URL broke", () => {
    expect(validateProjectSearch({ tab: "people", period: "year", from: "2026-02-30", filters: [{ op: "is" }] })).toEqual({})
  })
  it("keeps the Visitors tab and its ID search", () =>
    expect(validateProjectSearch({ tab: "visitors", q: "user_" })).toEqual({ tab: "visitors", q: "user_" }))
  it("keeps the selected live Session", () => expect(validateProjectSearch({ tab: "live", live: "abc" })).toEqual({ tab: "live", live: "abc" }))
})

describe("reportQuery", () => {
  it("defaults to the last 7 days", () => expect(reportQuery({})).toEqual({ period: "7d" }))
  it("carries custom dates only for a custom range", () => {
    expect(reportQuery({ period: "custom", from: "2026-03-01", to: "2026-03-09" })).toEqual({ period: "custom", from: "2026-03-01", to: "2026-03-09" })
    expect(reportQuery({ period: "30d", from: "2026-03-01" })).toEqual({ period: "30d" })
  })
})

describe("searchFor", () => {
  it("leaves the default range and no filters out of the URL", () => expect(searchFor({ period: "7d", filters: [] })).toEqual({}))
})

describe("withQuery", () => {
  it("replaces the range and filters but keeps the Environment and tab", () => {
    expect(withQuery({ env: "dev", tab: "live", period: "30d" }, { period: "today", filters: [country] })).toEqual({
      env: "dev",
      tab: "live",
      period: "today",
      filters: [country]
    })
  })
})

describe("withFilter", () => {
  it("adds a filter once", () => {
    const once = withFilter({ period: "7d" }, country)
    expect(withFilter(once, country)).toEqual({ period: "7d", filters: [country] })
  })
})
