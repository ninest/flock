// Custom events: the list (count and unique Visitors per name) and one Custom event's
// drill-down, with its count over time, a breakdown by a string or boolean Event property
// and statistics for a numeric Event property over time. Follows the shared date range and
// filters; clicking a breakdown row adds its value as a filter.
import type {
  CustomEventDetail,
  CustomEventStats,
  Environment,
  NumericStats,
  PropertyFilter,
  ReportRangeQuery
} from "@flock/shared"
import { type CSSProperties, useState } from "react"
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { request } from "./api.ts"
import { isComplete } from "./top-list.tsx"
import { queryDeps } from "./filters.tsx"
import { usePoll } from "./use-poll.ts"

const muted: CSSProperties = { fontSize: 14, color: "#666" }
const section: CSSProperties = { border: "1px solid #ccc", borderRadius: 8, padding: 12, margin: "12px 0", display: "grid", gap: 12 }
const table: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 14 }
const cell: CSSProperties = { padding: "4px 6px", borderBottom: "1px solid #eee", textAlign: "left" }
const num: CSSProperties = { ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" }
const COLOR = "#2a6fdb"

const formatNumber = (value: number | null | undefined) =>
  value === null || value === undefined ? "–" : value.toLocaleString(undefined, { maximumFractionDigits: 2 })

const bucketLabel = (interval: "hour" | "day", bucket: string) =>
  interval === "hour"
    ? bucket.slice(11, 16)
    : new Date(`${bucket}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })

const SeriesChart = ({ label, data }: { label: string; data: ReadonlyArray<{ label: string; value: number | null }> }) => (
  <div style={{ width: "100%", height: 200 }} role="img" aria-label={`${label} over time`}>
    <ResponsiveContainer>
      <LineChart data={[...data]} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="#eee" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#666" }} tickLine={false} axisLine={{ stroke: "#ddd" }} minTickGap={16} />
        <YAxis tick={{ fontSize: 12, fill: "#666" }} tickLine={false} axisLine={false} width={48} />
        <Tooltip formatter={(value) => (typeof value === "number" ? formatNumber(value) : "–")} />
        <Line type="monotone" dataKey="value" name={label} stroke={COLOR} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  </div>
)

export const CustomEventsReport = ({ environment, range: query, onAddFilter }: {
  environment: Environment
  range: ReportRangeQuery
  onAddFilter: (filter: PropertyFilter) => void
}) => {
  const [selected, setSelected] = useState<string>()
  const valid = isComplete(query)
  const { data, error } = usePoll(
    () => valid ? request((api) => api.customEvents.list({ params: { environmentId: environment.id }, query })) : Promise.resolve(undefined),
    [environment.id, ...queryDeps(query)]
  )
  return (
    <section style={section} data-testid="custom-events">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <strong>
          {selected
            ? <><button type="button" onClick={() => setSelected(undefined)} style={{ all: "unset", color: "#06c", cursor: "pointer" }}>Custom events</button> / <code>{selected}</code></>
            : "Custom events"}
        </strong>
      </div>
      {!valid ? <p style={muted}>Pick a start and end date.</p> : null}
      {selected && valid
        ? <Drilldown environment={environment} name={selected} query={query} onAddFilter={onAddFilter} />
        : (
          <>
            {error && !data ? <p role="alert" style={muted}>Could not load Custom events.</p> : null}
            {data?.events.length === 0 ? <p style={muted}>No Custom events in this range. Send one with <code>flock.track("name", {"{ … }"})</code>.</p> : null}
            {data && data.events.length > 0
              ? (
                <table style={table}>
                  <thead>
                    <tr><th style={cell}>Name</th><th style={num}>Events</th><th style={num}>Unique Visitors</th></tr>
                  </thead>
                  <tbody>
                    {data.events.map((event) => (
                      <tr key={event.name}>
                        <td style={cell}>
                          <button type="button" onClick={() => setSelected(event.name)} style={{ all: "unset", color: "#06c", cursor: "pointer" }}>
                            <code>{event.name}</code>
                          </button>
                        </td>
                        <td style={num}>{formatNumber(event.count)}</td>
                        <td style={num}>{formatNumber(event.visitors)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
              : null}
          </>
        )}
    </section>
  )
}

const Drilldown = ({ environment, name, query, onAddFilter }: {
  environment: Environment
  name: string
  query: ReportRangeQuery
  onAddFilter: (filter: PropertyFilter) => void
}) => {
  const [metric, setMetric] = useState<"count" | "visitors">("count")
  const { data, error } = usePoll(
    () => request((api) => api.customEvents.detail({ params: { environmentId: environment.id }, query: { ...query, name } })),
    [environment.id, name, ...queryDeps(query)]
  )
  if (!data) return error ? <p role="alert" style={muted}>Could not load <code>{name}</code>.</p> : <p style={muted}>Loading…</p>
  const categorical = data.properties.filter((p) => p.types.includes("string") || p.types.includes("boolean")).map((p) => p.key)
  const numeric = data.properties.filter((p) => p.types.includes("number")).map((p) => p.key)
  const label = metric === "count" ? "Events" : "Unique Visitors"
  return (
    <>
      <div style={{ display: "flex", gap: 8 }}>
        {(["count", "visitors"] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={m === metric}
            onClick={() => setMetric(m)}
            data-testid={`custom-event-${m}`}
            style={{ all: "unset", cursor: "pointer", padding: 8, borderRadius: 6, border: `1px solid ${m === metric ? COLOR : "#e5e5e5"}`, minWidth: 120 }}
          >
            <div style={muted}>{m === "count" ? "Events" : "Unique Visitors"}</div>
            <div style={{ fontSize: 24, fontWeight: 600 }}>{formatNumber(data.totals[m])}</div>
          </button>
        ))}
      </div>
      <SeriesChart label={label} data={data.series.map((b) => ({ label: bucketLabel(data.interval, b.bucket), value: b[metric] }))} />
      <PropertyBreakdown environment={environment} detail={data} query={query} keys={categorical} onAddFilter={onAddFilter} />
      <PropertyStats environment={environment} detail={data} query={query} keys={numeric} />
    </>
  )
}

const PropertyPicker = ({ label, keys, value, onChange }: { label: string; keys: ReadonlyArray<string>; value: string; onChange: (key: string) => void }) => (
  <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
    <strong>{label}</strong>
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {keys.map((key) => <option key={key} value={key}>{key}</option>)}
    </select>
  </label>
)

/** Keeps a chosen Event property while it still exists; otherwise the first one. */
const useChosen = (keys: ReadonlyArray<string>) => {
  const [chosen, setChosen] = useState<string>()
  return [chosen !== undefined && keys.includes(chosen) ? chosen : keys[0], setChosen] as const
}

const PropertyBreakdown = (
  { environment, detail, query, keys, onAddFilter }: {
    environment: Environment
    detail: CustomEventDetail
    query: ReportRangeQuery
    keys: ReadonlyArray<string>
    onAddFilter: (filter: PropertyFilter) => void
  }
) => {
  const [property, setProperty] = useChosen(keys)
  const { data } = usePoll(
    () =>
      property === undefined
        ? Promise.resolve(undefined)
        : request((api) => api.customEvents.breakdown({ params: { environmentId: environment.id }, query: { ...query, name: detail.name, property } })),
    [environment.id, detail.name, property, ...queryDeps(query)]
  )
  if (property === undefined) return <p style={muted}>No string or boolean Event properties to break down by.</p>
  const total = data?.rows.reduce((sum, row) => sum + row.count, 0) ?? 0
  return (
    <div data-testid="custom-event-breakdown" style={{ display: "grid", gap: 8 }}>
      <PropertyPicker label="Breakdown by" keys={keys} value={property} onChange={setProperty} />
      {data
        ? (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 4 }}>
            {data.rows.map((row) => (
              <li key={row.value ?? "\u0000"} style={{ position: "relative", padding: "2px 6px", fontSize: 14 }}>
                <div style={{ position: "absolute", inset: 0, width: `${(row.count / Math.max(total, 1)) * 100}%`, background: "#e8f0fc", borderRadius: 4 }} />
                <div style={{ position: "relative", display: "flex", justifyContent: "space-between" }}>
                  {row.value === null
                    ? <em style={{ color: "#888" }}>(not set)</em>
                    : (
                      <button
                        type="button"
                        title={`Filter by ${property} is ${row.value}`}
                        onClick={() => onAddFilter({ property, op: "is", value: row.value! })}
                        style={{ all: "unset", cursor: "pointer" }}
                      >
                        {row.value}
                      </button>
                    )}
                  <span>{formatNumber(row.count)}</span>
                </div>
              </li>
            ))}
          </ul>
        )
        : null}
    </div>
  )
}

const STATS: ReadonlyArray<{ key: Exclude<keyof NumericStats, "count">; label: string }> = [
  { key: "average", label: "Average" },
  { key: "sum", label: "Sum" },
  { key: "min", label: "Min" },
  { key: "max", label: "Max" },
  { key: "median", label: "Median" }
]

const PropertyStats = (
  { environment, detail, query, keys }: { environment: Environment; detail: CustomEventDetail; query: ReportRangeQuery; keys: ReadonlyArray<string> }
) => {
  const [property, setProperty] = useChosen(keys)
  const [stat, setStat] = useState<(typeof STATS)[number]["key"]>("average")
  const { data } = usePoll<CustomEventStats | undefined>(
    () =>
      property === undefined
        ? Promise.resolve(undefined)
        : request((api) => api.customEvents.stats({ params: { environmentId: environment.id }, query: { ...query, name: detail.name, property } })),
    [environment.id, detail.name, property, ...queryDeps(query)]
  )
  if (property === undefined) return <p style={muted}>No numeric Event properties.</p>
  const label = `${STATS.find((s) => s.key === stat)!.label} ${property}`
  return (
    <div data-testid="custom-event-stats" style={{ display: "grid", gap: 8 }}>
      <PropertyPicker label="Statistics for" keys={keys} value={property} onChange={setProperty} />
      <p style={{ ...muted, margin: 0 }}>Only numeric values count. {data ? `${formatNumber(data.totals.count)} Events had one.` : null}</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))", gap: 8 }}>
        {STATS.map((s) => (
          <button
            key={s.key}
            type="button"
            aria-pressed={s.key === stat}
            onClick={() => setStat(s.key)}
            data-testid={`custom-event-stat-${s.key}`}
            style={{ all: "unset", cursor: "pointer", padding: 8, borderRadius: 6, border: `1px solid ${s.key === stat ? COLOR : "#e5e5e5"}` }}
          >
            <div style={muted}>{s.label}</div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>{formatNumber(data?.totals[s.key])}</div>
          </button>
        ))}
      </div>
      {data ? <SeriesChart label={label} data={data.series.map((b) => ({ label: bucketLabel(data.interval, b.bucket), value: b[stat] }))} /> : null}
    </div>
  )
}
