// Turns the date range picker (today, 7 days, 30 days, custom) into local dates and a
// bucket interval in the Project's time zone. Shared by every dashboard report.
import type { EnvironmentId, EventPropertyFilters, ProjectId, ReportInterval, ReportRangeQuery } from "@flock/shared"
import { DateTime } from "effect"

export interface ReportRange {
  /** First and last local day, inclusive (`2026-03-01`). */
  readonly from: string
  readonly to: string
  readonly timeZone: string
  readonly interval: ReportInterval
  /**
   * Local wall-clock end (exclusive, `2026-02-28T09:15:00`) within `to`, or null for the whole day.
   * Only the previous period of a range of only today has one: yesterday up to the current time of day.
   */
  readonly until: string | null
}

/** A report after the access check: the Environment, its resolved local range and the filters. */
export interface ReportScope {
  readonly environmentId: EnvironmentId
  readonly projectId: ProjectId
  readonly range: ReportRange
  readonly filters: EventPropertyFilters | undefined
}

/** The local calendar day of an instant in a time zone. */
export const localDate = (at: DateTime.Utc, timeZone: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(DateTime.toDateUtc(at))

/** The local wall-clock time of an instant in a time zone, `09:15:00`. */
const localTime = (at: DateTime.Utc, timeZone: string): string =>
  new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .format(DateTime.toDateUtc(at))

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

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
  return { from, to, timeZone, interval: from === to ? "hour" : "day", until: null }
}

/**
 * The previous period of a resolved range: the same number of local days, ending the day before
 * it starts, with the same interval so its buckets line up one for one. For a range of only today
 * (`today`, or a custom range from today to today) it is yesterday from local midnight up to the
 * current local time of day, so a morning compares with yesterday morning.
 */
export const resolvePreviousRange = (current: ReportRange, now: DateTime.Utc): ReportRange => {
  const days = daysBetween(current.from, current.to) + 1
  const from = addDays(current.from, -days)
  const to = addDays(current.from, -1)
  const today = localDate(now, current.timeZone)
  const until = current.from === today && current.to === today ? `${to}T${localTime(now, current.timeZone)}` : null
  return { ...current, from, to, until }
}
