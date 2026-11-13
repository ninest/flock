// Event property filters for the Project page: the URL search params that hold the shared date range
// and filters, the chips that show and remove filters, and the form that adds one. Every
// report sends the same range and filters, so a filtered view can be shared or bookmarked.
import {
  type Environment,
  type FilterOperator,
  LocalDate,
  type EventPropertyFilter,
  EventPropertyFilters,
  ReportPeriod,
  type ReportRangeQuery
} from "@flock/shared"
import { DateTime, Option, Schema } from "effect"
import { type CSSProperties, type FormEvent, useState } from "react"
import { request } from "./api.ts"
import { usePoll } from "./use-poll.ts"

/** The Project page's search params: `?env=dev&period=custom&from=…&to=…&filters=[…]`. */
export interface ProjectSearch {
  readonly env?: string
  readonly period?: ReportRangeQuery["period"]
  readonly from?: string | undefined
  readonly to?: string | undefined
  readonly filters?: EventPropertyFilters
}

const decode = <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S, value: unknown) =>
  Option.getOrUndefined(Schema.decodeUnknownOption(schema)(value)) as S["Type"] | undefined

/** Keeps only valid search params, so a hand-edited URL can't break the reports. */
export const validateProjectSearch = (search: Record<string, unknown>): ProjectSearch => {
  // TanStack Router parses JSON search values, so `filters` arrives as an array.
  const filters = decode(EventPropertyFilters, search.filters)
  const result: { -readonly [K in keyof ProjectSearch]: ProjectSearch[K] } = {}
  if (typeof search.env === "string" && search.env !== "") result.env = search.env
  const period = decode(ReportPeriod, search.period)
  if (period !== undefined) result.period = period
  const from = decode(LocalDate, search.from)
  if (from !== undefined) result.from = from
  const to = decode(LocalDate, search.to)
  if (to !== undefined) result.to = to
  if (filters !== undefined && filters.length > 0) result.filters = filters
  return result
}

/** The shared report query (date range plus filters) a Project page's search params describe. */
export const reportQuery = (search: ProjectSearch): ReportRangeQuery => ({
  period: search.period ?? "7d",
  ...(search.period === "custom" ? { from: search.from, to: search.to } : {}),
  ...(search.filters ? { filters: search.filters } : {})
})

/** The search params for a report query; the default range (`7d`) and no filters stay out of the URL. */
export const searchFor = (query: ReportRangeQuery): Omit<ProjectSearch, "env"> => ({
  ...(query.period === "7d" ? {} : { period: query.period }),
  ...(query.period === "custom" ? { from: query.from, to: query.to } : {}),
  ...(query.filters && query.filters.length > 0 ? { filters: query.filters } : {})
})

/** usePoll dependencies for a report query: reload when the range or filters change. */
export const queryDeps = (query: ReportRangeQuery) => [query.period, query.from, query.to, JSON.stringify(query.filters ?? [])]

const sameFilter = (a: EventPropertyFilter, b: EventPropertyFilter) => a.eventProperty === b.eventProperty && a.op === b.op && a.value === b.value

/** Adds a filter (once) to a report query. */
export const withFilter = (query: ReportRangeQuery, filter: EventPropertyFilter): ReportRangeQuery => {
  const filters = query.filters ?? []
  return filters.some((f) => sameFilter(f, filter)) ? query : { ...query, filters: [...filters, filter] }
}

const OPERATORS: ReadonlyArray<{ value: FilterOperator; label: string }> = [
  { value: "is", label: "is" },
  { value: "isNot", label: "is not" },
  { value: "contains", label: "contains" }
]

/** Keys every Environment can filter by; `$path` and `$referring_domain` are derived. */
const SUGGESTED_KEYS = ["$path", "$country", "$region", "$browser", "$os", "$device", "$referring_domain", "$utm_source", "$utm_medium", "$utm_campaign"]

const chip: CSSProperties = {
  display: "inline-flex",
  gap: 6,
  alignItems: "center",
  padding: "2px 4px 2px 10px",
  borderRadius: 999,
  background: "#e8eefc",
  fontSize: 14
}

/** The active filters as removable chips, plus a form to add one. */
export const FilterBar = ({ environment, query, onChange }: {
  environment: Environment
  query: ReportRangeQuery
  onChange: (query: ReportRangeQuery) => void
}) => {
  const filters = query.filters ?? []
  const [adding, setAdding] = useState(false)
  const remove = (index: number) => onChange({ ...query, filters: filters.filter((_, i) => i !== index) })
  return (
    <div data-testid="filters" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "12px 0" }}>
      <strong style={{ fontSize: 14 }}>Filters</strong>
      {filters.length === 0 && !adding ? <span style={{ fontSize: 14, color: "#666" }}>None. Click a row in a report to add one.</span> : null}
      {filters.map((filter, i) => (
        <span key={`${filter.eventProperty}-${filter.op}-${filter.value}`} style={chip} data-testid="filter-chip">
          <code>{filter.eventProperty}</code> {OPERATORS.find((o) => o.value === filter.op)?.label} <strong>{filter.value}</strong>
          <button
            type="button"
            aria-label={`Remove filter ${filter.eventProperty}`}
            onClick={() => remove(i)}
            style={{ all: "unset", cursor: "pointer", padding: "0 6px", color: "#666" }}
          >
            ×
          </button>
        </span>
      ))}
      {adding
        ? <AddFilter environment={environment} onAdd={(f) => {
          onChange(withFilter(query, f))
          setAdding(false)
        }} onCancel={() => setAdding(false)} />
        : <button type="button" onClick={() => setAdding(true)}>Add filter</button>}
      {filters.length > 1 ? <button type="button" onClick={() => onChange({ ...query, filters: [] })}>Clear all</button> : null}
    </div>
  )
}

const AddFilter = ({ environment, onAdd, onCancel }: {
  environment: Environment
  onAdd: (filter: EventPropertyFilter) => void
  onCancel: () => void
}) => {
  // Suggest the Event property keys seen in the last 30 days.
  const { data } = usePoll(() => {
    const to = DateTime.makeUnsafe(Date.now())
    return request((api) =>
      api.reports.eventPropertyKeys({ params: { environmentId: environment.id }, query: { from: DateTime.subtract(to, { days: 30 }), to } })
    )
  }, [environment.id], 60_000)
  const keys = [...new Set([...SUGGESTED_KEYS, ...(data?.keys ?? [])])]
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const eventProperty = String(form.get("eventProperty")).trim()
    if (eventProperty === "") return
    onAdd({ eventProperty, op: String(form.get("op")) as FilterOperator, value: String(form.get("value")) })
  }
  return (
    <form onSubmit={submit} style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <input name="eventProperty" list="filter-keys" placeholder="Event property" required maxLength={200} aria-label="Event property" autoFocus />
      <datalist id="filter-keys">{keys.map((key) => <option key={key} value={key} />)}</datalist>
      <select name="op" aria-label="Operator" defaultValue="is">
        {OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <input name="value" placeholder="Value" maxLength={1000} aria-label="Value" />
      <button type="submit">Apply</button>
      <button type="button" onClick={onCancel}>Cancel</button>
    </form>
  )
}
