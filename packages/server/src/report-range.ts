// Turns the date range picker (today, 7 days, 30 days, custom) into local dates and a
// bucket interval in the Project's time zone. Shared by every dashboard report.
import type { ReportInterval, ReportRangeQuery } from "@flock/shared"
import { DateTime } from "effect"

export interface ReportRange {
  /** First and last local day, inclusive (`2026-03-01`). */
  readonly from: string
  readonly to: string
  readonly timeZone: string
  readonly interval: ReportInterval
}

/** The local calendar day of an instant in a time zone. */
export const localDate = (at: DateTime.Utc, timeZone: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(DateTime.toDateUtc(at))

/** The local day `days` after `date` (`2026-03-01`). */
export const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Resolves the picker against `now`. The query schema guarantees `from`/`to` for custom ranges. */
export const resolveRange = (query: ReportRangeQuery, timeZone: string, now: DateTime.Utc): ReportRange => {
  const today = localDate(now, timeZone)
  const [from, to] = query.period === "today"
    ? [today, today]
    : query.period === "7d"
    ? [addDays(today, -6), today]
    : query.period === "30d"
    ? [addDays(today, -29), today]
    : [query.from!, query.to!]
  return { from, to, timeZone, interval: from === to ? "hour" : "day" }
}
