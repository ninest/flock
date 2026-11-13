import { describe, expect, it } from "vitest"
import { bucketLabel, labelStep, niceMax } from "./chart-scale.ts"

describe("niceMax", () => {
  it("rounds up to a round number", () => {
    expect(niceMax(87)).toBe(100)
    expect(niceMax(1234)).toBe(1500)
    expect(niceMax(7)).toBe(8)
  })
  it("keeps shares at or under 100%", () => {
    expect(niceMax(0.42)).toBe(0.5)
    expect(niceMax(0.8)).toBe(1)
  })
  it("gives an empty chart a scale", () => expect(niceMax(0)).toBe(1))
})

describe("labelStep", () => {
  it("labels every bucket when there is room", () => expect(labelStep(7, 700)).toBe(1))
  it("skips labels so they don't collide", () => expect(labelStep(30, 360)).toBe(6))
})

describe("bucketLabel", () => {
  it("shows the hour of an hourly bucket", () => expect(bucketLabel("hour", "2026-03-01T13:00")).toBe("13:00"))
  it("shows month and day of a daily bucket", () => expect(bucketLabel("day", "2026-03-01")).toMatch(/Mar\s?1|1\s?Mar/))
})
