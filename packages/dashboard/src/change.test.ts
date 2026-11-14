import { describe, expect, it } from "vitest"
import { formatChange } from "./change.ts"

describe("formatChange as a percentage", () => {
  it("shows growth with a plus sign", () => expect(formatChange(120, 100, "percent").label).toBe("+20%"))
  it("shows a fall with a minus sign", () => expect(formatChange(75, 100, "percent").label).toBe("−25%"))
  it("rounds to a whole percent", () => expect(formatChange(1001, 300, "percent").label).toBe("+234%"))
  it("reads no change as 0%", () => expect(formatChange(100, 100, "percent")).toEqual({ label: "0%", direction: "flat", tone: "neutral" }))
  it("keeps a tiny change from rounding to 0%", () => expect(formatChange(1001, 1000, "percent").label).toBe("+<1%"))
  it("shows a full drop to nothing as −100%", () => expect(formatChange(0, 40, "percent").label).toBe("−100%"))
})

describe("formatChange in percentage points", () => {
  it("shows the difference between two shares in points", () => expect(formatChange(0.5, 0.4, "points").label).toBe("+10 pts"))
  it("shows a fall in points", () => expect(formatChange(0.355, 0.4, "points").label).toBe("−5 pts"))
  it("says pt for a single point", () => expect(formatChange(0.41, 0.4, "points").label).toBe("+1 pt"))
})

describe("formatChange with nothing to compare against", () => {
  it("shows – when the previous value is zero, never +∞%", () =>
    expect(formatChange(12, 0, "percent")).toEqual({ label: "–", direction: null, tone: "neutral" }))
  it("shows – when the previous value is missing", () => expect(formatChange(0.3, null, "points").label).toBe("–"))
  it("shows – when the current value is missing", () => expect(formatChange(null, 0.3, "points").label).toBe("–"))
})

describe("formatChange tone", () => {
  it("calls growth good", () => expect(formatChange(2, 1, "percent")).toMatchObject({ direction: "up", tone: "good" }))
  it("calls a fall bad", () => expect(formatChange(1, 2, "percent")).toMatchObject({ direction: "down", tone: "bad" }))
  it("flips for numbers where lower is better, like bounce rate", () =>
    expect(formatChange(0.5, 0.4, "points", { lowerIsBetter: true })).toMatchObject({ direction: "up", tone: "bad" }))
})
