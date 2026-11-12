// The overview: date range picker, the five headline numbers, and the selected one over time.
import type { Environment, Overview, OverviewBucket, OverviewNumbers, OverviewQuery, ReportPeriod } from "@flock/shared"
import { type CSSProperties, useState } from "react"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { request } from "./api.ts"
import { usePoll } from "./use-poll.ts"

const muted: CSSProperties = { fontSize: 14, color: "#666" }
const SERIES_COLOR = "#2a6fdb"

type Metric = keyof OverviewNumbers

const formatDuration = (seconds: number) => {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

const metrics: ReadonlyArray<{ key: Metric; label: string; format: (value: number) => string }> = [
  { key: "visitors", label: "Unique Visitors", format: (v) => v.toLocaleString() },
  { key: "pageviews", label: "Pageviews", format: (v) => v.toLocaleString() },
  { key: "sessions", label: "Sessions", format: (v) => v.toLocaleString() },
  { key: "bounceRate", label: "Bounce rate", format: (v) => `${Math.round(v * 100)}%` },
  { key: "visitDuration", label: "Visit duration", format: formatDuration }
]

const periods: ReadonlyArray<{ value: ReportPeriod; label: string }> = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "custom", label: "Custom" }
]

/** The date range picker. Custom ranges are local dates in the Project's time zone. */
export const RangePicker = ({ query, onChange }: { query: OverviewQuery; onChange: (query: OverviewQuery) => void }) => {
  const [from, setFrom] = useState(query.from ?? "")
  const [to, setTo] = useState(query.to ?? "")
  const applyCustom = (f: string, t: string) => {
    setFrom(f)
    setTo(t)
    if (f && t && f <= t) onChange({ period: "custom", from: f, to: t })
  }
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <select
        value={query.period}
        data-testid="date-range"
        onChange={(e) => {
          const period = e.target.value as ReportPeriod
          if (period !== "custom") onChange({ period })
          else onChange({ period, from: from || undefined, to: to || undefined })
        }}
      >
        {periods.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
      </select>
      {query.period === "custom" && (
        <>
          <input type="date" value={from} max={to || undefined} onChange={(e) => applyCustom(e.target.value, to)} aria-label="From" />
          <span>to</span>
          <input type="date" value={to} min={from || undefined} onChange={(e) => applyCustom(from, e.target.value)} aria-label="To" />
        </>
      )}
    </div>
  )
}

const bucketLabel = (overview: Overview, bucket: string) =>
  overview.interval === "hour" ? bucket.slice(11, 16) : new Date(`${bucket}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  })

const Chart = ({ overview, metric }: { overview: Overview; metric: (typeof metrics)[number] }) => {
  const data = overview.series.map((b: OverviewBucket) => ({ label: bucketLabel(overview, b.bucket), value: b[metric.key] }))
  return (
    <div style={{ width: "100%", height: 240 }} role="img" aria-label={`${metric.label} over time`}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#eee" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#666" }} tickLine={false} axisLine={{ stroke: "#ddd" }} minTickGap={16} />
          <YAxis
            tick={{ fontSize: 12, fill: "#666" }}
            tickLine={false}
            axisLine={false}
            width={48}
            allowDecimals={metric.key === "bounceRate"}
            tickFormatter={(v: number) => metric.format(v)}
          />
          <Tooltip
            formatter={(value) => (typeof value === "number" ? metric.format(value) : "–")}
            labelStyle={{ color: "#333" }}
          />
          <Area
            type="monotone"
            dataKey="value"
            name={metric.label}
            stroke={SERIES_COLOR}
            strokeWidth={2}
            fill={SERIES_COLOR}
            fillOpacity={0.12}
            connectNulls
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export const OverviewReport = ({ environment, timeZone }: { environment: Environment; timeZone: string }) => {
  const [query, setQuery] = useState<OverviewQuery>({ period: "7d" })
  const [metricKey, setMetricKey] = useState<Metric>("visitors")
  const valid = query.period !== "custom" || (query.from !== undefined && query.to !== undefined)
  const { data, error } = usePoll(
    () => valid ? request((api) => api.reports.overview({ params: { environmentId: environment.id }, query })) : Promise.resolve(undefined),
    [environment.id, query.period, query.from, query.to]
  )
  const metric = metrics.find((m) => m.key === metricKey)!
  return (
    <section style={{ border: "1px solid #ccc", borderRadius: 8, padding: 12, margin: "12px 0", display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <strong>Overview</strong>
        <RangePicker query={query} onChange={setQuery} />
      </div>
      {error && !data ? <p role="alert">Could not load the overview.</p> : null}
      {!valid ? <p style={muted}>Pick a start and end date.</p> : null}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
        {metrics.map((m) => {
          const value = data?.totals[m.key]
          const selected = m.key === metricKey
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => setMetricKey(m.key)}
              aria-pressed={selected}
              data-testid={`overview-${m.key}`}
              style={{
                all: "unset",
                cursor: "pointer",
                padding: 8,
                borderRadius: 6,
                border: `1px solid ${selected ? SERIES_COLOR : "#e5e5e5"}`
              }}
            >
              <div style={muted}>{m.label}</div>
              <div style={{ fontSize: 24, fontWeight: 600 }}>{value === undefined || value === null ? "–" : m.format(value)}</div>
            </button>
          )
        })}
      </div>
      {data ? <Chart overview={data} metric={metric} /> : null}
      {data ? <p style={{ ...muted, margin: 0 }}>{data.from === data.to ? data.from : `${data.from} to ${data.to}`} · {timeZone}</p> : null}
    </section>
  )
}
