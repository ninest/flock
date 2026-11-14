import { describe, expect, it } from "vitest"
import { chartedProperty, eventSeries, statisticSeries } from "./custom-event-charts.ts"

const detailSeries = [
  { bucket: "2026-03-01", count: 12, visitors: 5 },
  { bucket: "2026-03-02", count: 0, visitors: 0 },
  { bucket: "2026-03-03", count: 7, visitors: 3 }
]

describe("eventSeries", () => {
  it("charts Event count by default", () => {
    const chart = eventSeries(detailSeries, undefined)
    expect(chart.name).toBe("Events")
    expect(chart.values).toEqual([12, 0, 7])
  })
  it("charts unique Visitors", () => {
    const chart = eventSeries(detailSeries, "visitors")
    expect(chart.name).toBe("Unique Visitors")
    expect(chart.values).toEqual([5, 0, 3])
  })
})

const empty = { count: 0, average: null, sum: null, min: null, max: null, median: null }
const statsSeries = [
  { bucket: "2026-03-01", count: 3, average: 20, sum: 60, min: 5, max: 40, median: 15 },
  { bucket: "2026-03-02", ...empty },
  { bucket: "2026-03-03", count: 1, average: 9.5, sum: 9.5, min: 9.5, max: 9.5, median: 9.5 }
]

describe("statisticSeries", () => {
  it("charts the average by default", () => {
    const chart = statisticSeries(statsSeries, "price", undefined)
    expect(chart.name).toBe("Average price")
    expect(chart.values).toEqual([20, null, 9.5])
  })
  it("charts the chosen statistic, leaving a gap where a bucket had no numeric value", () => {
    expect(statisticSeries(statsSeries, "price", "sum").values).toEqual([60, null, 9.5])
    expect(statisticSeries(statsSeries, "price", "min").values).toEqual([5, null, 9.5])
    expect(statisticSeries(statsSeries, "price", "max").values).toEqual([40, null, 9.5])
    const median = statisticSeries(statsSeries, "price", "median")
    expect(median.name).toBe("Median price")
    expect(median.values).toEqual([15, null, 9.5])
  })
})

describe("chartedProperty", () => {
  it("is the requested numeric property when the event has it", () => expect(chartedProperty(["price", "items"], "items")).toBe("items"))
  it("falls back to the first numeric property", () => {
    expect(chartedProperty(["price", "items"], undefined)).toBe("price")
    expect(chartedProperty(["price", "items"], "duration")).toBe("price")
  })
  it("is none for an event with no numeric property", () => expect(chartedProperty([], "price")).toBeUndefined())
})
