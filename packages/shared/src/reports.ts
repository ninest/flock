// Dashboard report schemas. Every report takes a date range in the Project's time zone.
import { Schema } from "effect"

const isLocalDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
}

/** A calendar day (`2026-03-01`) in the Project's time zone. */
export const LocalDate = Schema.String.check(
  Schema.makeFilter((value: string) => isLocalDate(value), { expected: "a date such as 2026-03-01" })
)

/**
 * The date range picker: today, the last 7 or 30 days (ending today), or custom
 * dates (`from` and `to` inclusive). Days are the Project's local days.
 */
export const ReportPeriod = Schema.Literals(["today", "7d", "30d", "custom"])
export type ReportPeriod = typeof ReportPeriod.Type

export const ReportRangeQuery = Schema.Struct({
  period: ReportPeriod,
  from: Schema.optional(LocalDate),
  to: Schema.optional(LocalDate)
}).check(
  Schema.makeFilter((q) =>
    q.period !== "custom"
      ? true
      : q.from === undefined || q.to === undefined
      ? "a custom period needs both from and to"
      : q.from > q.to
      ? "from must not be after to"
      : true
  )
)
export type ReportRangeQuery = typeof ReportRangeQuery.Type

/** Hourly buckets for a single day, daily buckets otherwise. */
export const ReportInterval = Schema.Literals(["hour", "day"])
export type ReportInterval = typeof ReportInterval.Type

export const OverviewQuery = ReportRangeQuery
export type OverviewQuery = ReportRangeQuery

/** The overview numbers for a range or one bucket of it. */
export const OverviewNumbers = Schema.Struct({
  /** Unique Visitors. */
  visitors: Schema.Number,
  pageviews: Schema.Number,
  sessions: Schema.Number,
  /** Share of Sessions (0 to 1) that are bounces: a single Event. Null without Sessions. */
  bounceRate: Schema.NullOr(Schema.Number),
  /** Average Session length in seconds, first to last Event. Null without Sessions. */
  visitDuration: Schema.NullOr(Schema.Number)
})
export type OverviewNumbers = typeof OverviewNumbers.Type

export const OverviewBucket = Schema.Struct({
  /** Local start of the bucket: `2026-03-01` (day) or `2026-03-01T13:00` (hour). */
  bucket: Schema.String,
  ...OverviewNumbers.fields
})
export type OverviewBucket = typeof OverviewBucket.Type

export const Overview = Schema.Struct({
  /** The resolved range, as local dates (inclusive). */
  from: Schema.String,
  to: Schema.String,
  timeZone: Schema.String,
  interval: ReportInterval,
  /** For the whole range: a Visitor seen on several days counts once. */
  totals: OverviewNumbers,
  /** Every bucket in the range, including empty ones. A Session counts in the bucket where it starts. */
  series: Schema.Array(OverviewBucket)
})
export type Overview = typeof Overview.Type
