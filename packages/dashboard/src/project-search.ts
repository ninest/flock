// The Project page's URL search params: which tab and selection is open, the Environment, and the
// date range and Filters every report follows. Kept in the URL so any view can be shared or bookmarked.
import {
  type EventPropertyFilter,
  EventPropertyFilters,
  LocalDate,
  ReportPeriod,
  type ReportRangeQuery
} from "@flock/shared"
import { Option, Schema } from "effect"
import { EVENT_MEASURES, type EventMeasure, type Statistic, STATISTICS } from "./custom-event-charts.ts"

/** The Project page's tabs after the Dashboard (the default, kept out of the URL). */
export const PROJECT_TABS = ["live", "events", "visitors"] as const
export type ProjectTab = (typeof PROJECT_TABS)[number]

/** `?env=dev&tab=events&event=signup&measure=visitors&number=price&stat=median&q=user_&period=custom&from=…&to=…&filters=[…]`. */
export interface ProjectSearch {
  /** The Environment's name; `production` when absent. */
  readonly env?: string | undefined
  readonly tab?: ProjectTab
  /** The Custom event open on the Events tab. */
  readonly event?: string | undefined
  /** What the Custom event's chart counts; Events when absent. */
  readonly measure?: EventMeasure | undefined
  /** The numeric Event property charted on the Events tab; the event's first when absent. */
  readonly number?: string | undefined
  /** The statistic of `number` charted; average when absent. */
  readonly stat?: Statistic | undefined
  /** The Session open on the Live tab. */
  readonly live?: string | undefined
  /** The start of an identified Visitor ID searched for on the Visitors tab. */
  readonly q?: string | undefined
  readonly period?: ReportRangeQuery["period"]
  readonly from?: string | undefined
  readonly to?: string | undefined
  readonly filters?: EventPropertyFilters
}

const decode = <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S, value: unknown) =>
  Option.getOrUndefined(Schema.decodeUnknownOption(schema)(value)) as S["Type"] | undefined

const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : undefined)

/** Keeps only valid search params, so a hand-edited URL can't break the reports. */
export const validateProjectSearch = (search: Record<string, unknown>): ProjectSearch => {
  const result: { -readonly [K in keyof ProjectSearch]: ProjectSearch[K] } = {}
  const env = text(search.env)
  if (env !== undefined) result.env = env
  if (PROJECT_TABS.includes(search.tab as ProjectTab)) result.tab = search.tab as ProjectTab
  const event = text(search.event)
  if (event !== undefined) result.event = event
  const measure = EVENT_MEASURES.find((m) => m.key === search.measure)
  if (measure !== undefined) result.measure = measure.key
  const number = text(search.number)
  if (number !== undefined) result.number = number
  const stat = STATISTICS.find((s) => s.key === search.stat)
  if (stat !== undefined) result.stat = stat.key
  const live = text(search.live)
  if (live !== undefined) result.live = live
  const q = text(search.q)
  if (q !== undefined) result.q = q
  const period = decode(ReportPeriod, search.period)
  if (period !== undefined) result.period = period
  const from = decode(LocalDate, search.from)
  if (from !== undefined) result.from = from
  const to = decode(LocalDate, search.to)
  if (to !== undefined) result.to = to
  // TanStack Router parses JSON search values, so `filters` arrives as an array.
  const filters = decode(EventPropertyFilters, search.filters)
  if (filters !== undefined && filters.length > 0) result.filters = filters
  return result
}

/** The report query (date range plus Filters) the search params describe. */
export const reportQuery = (search: ProjectSearch): ReportRangeQuery => ({
  period: search.period ?? "7d",
  ...(search.period === "custom" ? { from: search.from, to: search.to } : {}),
  ...(search.filters ? { filters: search.filters } : {})
})

/** The search params for a report query; the default range (`7d`) and no Filters stay out of the URL. */
export const searchFor = (query: ReportRangeQuery): Pick<ProjectSearch, "period" | "from" | "to" | "filters"> => ({
  ...(query.period === "7d" ? {} : { period: query.period }),
  ...(query.period === "custom" ? { from: query.from, to: query.to } : {}),
  ...(query.filters && query.filters.length > 0 ? { filters: query.filters } : {})
})

/** `search` with its range and Filters replaced by `query`'s; the Environment, tab and selection stay. */
export const withQuery = (search: ProjectSearch, query: ReportRangeQuery): ProjectSearch => {
  const { period: _period, from: _from, to: _to, filters: _filters, ...rest } = search
  return { ...rest, ...searchFor(query) }
}

/** Only the range, Filters and Environment: what carries over between tabs, pages and Projects. */
export const sharedSearch = (search: ProjectSearch): ProjectSearch => withQuery(search.env ? { env: search.env } : {}, reportQuery(search))

/** usePoll dependencies for a report query: reload when the range or Filters change. */
export const queryDeps = (query: ReportRangeQuery) => [query.period, query.from, query.to, JSON.stringify(query.filters ?? [])]

/** True when the range can be sent: a custom range needs both dates. */
export const isComplete = (query: ReportRangeQuery) => query.period !== "custom" || (query.from !== undefined && query.to !== undefined)

const sameFilter = (a: EventPropertyFilter, b: EventPropertyFilter) => a.eventProperty === b.eventProperty && a.op === b.op && a.value === b.value

/** Adds a Filter (once) to a report query. */
export const withFilter = (query: ReportRangeQuery, filter: EventPropertyFilter): ReportRangeQuery => {
  const filters = query.filters ?? []
  return filters.some((f) => sameFilter(f, filter)) ? query : { ...query, filters: [...filters, filter] }
}
