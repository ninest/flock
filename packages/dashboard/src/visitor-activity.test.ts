import { describe, expect, it } from "vitest"
import { activityWeeks } from "./visitor-activity.ts"

const days = (from: string, counts: ReadonlyArray<number>) =>
  counts.map((events, i) => {
    const d = new Date(`${from}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + i)
    return { date: d.toISOString().slice(0, 10), events }
  })

describe("activityWeeks", () => {
  it("lays the days out in Monday-first weeks, with blanks before the first day and after the last", () => {
    // 2026-03-04 is a Wednesday; 2026-03-10 a Tuesday.
    const weeks = activityWeeks(days("2026-03-04", [0, 1, 0, 0, 0, 0, 0]))
    expect(weeks.map((w) => w.map((d) => d?.date ?? null))).toEqual([
      [null, null, "2026-03-04", "2026-03-05", "2026-03-06", "2026-03-07", "2026-03-08"],
      ["2026-03-09", "2026-03-10", null, null, null, null, null]
    ])
  })

  it("shades each day from 0 (no Events) to 4 (the busiest day)", () => {
    const [week] = activityWeeks(days("2026-03-02", [0, 1, 2, 3, 4, 8, 7]))
    expect(week!.map((d) => d!.level)).toEqual([0, 1, 1, 2, 2, 4, 4])
  })

  it("gives no weeks for no days", () => {
    expect(activityWeeks([])).toEqual([])
  })
})
