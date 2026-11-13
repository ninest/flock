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

/**
 * How a filter compares an Event property's value (as text: `34`, `true`):
 * - `is`: equals the value.
 * - `isNot`: anything else, including Events without the property.
 * - `contains`: includes the value, ignoring case. Events without the property don't match.
 */
export const FilterOperator = Schema.Literals(["is", "isNot", "contains"])
export type FilterOperator = typeof FilterOperator.Type

/**
 * A filter on one top-level Event property, such as `$country is DE`. Besides stored keys,
 * `$path` is the path of `$url` and `$referring_domain` the referrer's domain, the values the
 * pages and referrers reports show.
 */
export const EventPropertyFilter = Schema.Struct({
  eventProperty: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(200)),
  op: FilterOperator,
  value: Schema.String.check(Schema.isMaxLength(1000))
})
export type EventPropertyFilter = typeof EventPropertyFilter.Type

/** Filters combine with AND. */
export const EventPropertyFilters = Schema.Array(EventPropertyFilter).check(Schema.isMaxLength(20))
export type EventPropertyFilters = typeof EventPropertyFilters.Type

/** In a query string, filters travel as one JSON-encoded `filters` parameter. */
export const filtersField = { filters: Schema.optional(Schema.fromJsonString(EventPropertyFilters)) }

export const rangeFields = {
  period: ReportPeriod,
  from: Schema.optional(LocalDate),
  to: Schema.optional(LocalDate),
  ...filtersField
}

export const validRange = Schema.makeFilter((q: { readonly period: ReportPeriod; readonly from?: string | undefined; readonly to?: string | undefined }) =>
  q.period !== "custom"
    ? true
    : q.from === undefined || q.to === undefined
    ? "a custom period needs both from and to"
    : q.from > q.to
    ? "from must not be after to"
    : true
)

export const ReportRangeQuery = Schema.Struct(rangeFields).check(validRange)
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

/**
 * The ranked-list reports. Each counts unique Visitors per value, the same unit as the headline
 * Visitors number, and ranks by that count, most first. A Visitor counts once per value however
 * many Pageviews or Sessions they have with it.
 * - `pages`: Visitors per cleaned URL path (`/pricing`; no host, query or fragment) they viewed.
 *   Rows also carry `pageviews`, the path's Pageview count.
 * - `entryPages` / `exitPages`: Visitors per path of their Sessions' first / last Pageview.
 * - `referrers`: Visitors per referring domain of their Sessions' first Pageview (`www.` dropped).
 *   `null` is direct traffic: no referrer, or one from the page's own host.
 * - `utmSources` / `utmMediums` / `utmCampaigns`: Visitors per `utm_source` / `utm_medium` /
 *   `utm_campaign` of their Sessions' first Pageview. Sessions without the tag are left out.
 * - `countries` / `browsers` / `oses` / `devices`: Visitors per `$country` / `$browser` /
 *   `$os` / `$device` of their Pageviews; `null` when unknown.
 */
export const TopReport = Schema.Literals([
  "pages",
  "entryPages",
  "exitPages",
  "referrers",
  "utmSources",
  "utmMediums",
  "utmCampaigns",
  "countries",
  "browsers",
  "oses",
  "devices"
])
export type TopReport = typeof TopReport.Type

export const TopQuery = Schema.Struct({ ...rangeFields, report: TopReport }).check(validRange)
export type TopQuery = typeof TopQuery.Type

/**
 * One value of a ranked-list report and its unique Visitors. Optional columns are filled in only
 * by the reports they apply to.
 */
export const TopRow = Schema.Struct({
  value: Schema.NullOr(Schema.String),
  visitors: Schema.Number,
  /** `pages` only: the path's Pageviews. */
  pageviews: Schema.optional(Schema.Number)
})
export type TopRow = typeof TopRow.Type

/** At most this many rows come back, most frequent first. */
export const TOP_LIMIT = 100

export const Top = Schema.Struct({
  /** The resolved range, as local dates (inclusive). */
  from: Schema.String,
  to: Schema.String,
  timeZone: Schema.String,
  report: TopReport,
  rows: Schema.Array(TopRow)
})
export type Top = typeof Top.Type

/** Unique Visitors with an Event in the last 30 minutes. */
export const LiveVisitors = Schema.Struct({ visitors: Schema.Number })
export type LiveVisitors = typeof LiveVisitors.Type
