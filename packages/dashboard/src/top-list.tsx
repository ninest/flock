// A ranked-list report card (the `top` endpoint) with proportional bars. One card can offer
// several reports as tabs, e.g. top, entry and exit pages. Follows the shared date range and
// filters; clicking a row adds its value as a filter.
import type { Environment, PropertyFilter, ReportRangeQuery, TopReport, TopRow } from "@flock/shared"
import { type CSSProperties, useState } from "react"
import { request } from "./api.ts"
import { queryDeps } from "./filters.tsx"
import { usePoll } from "./use-poll.ts"

export const muted: CSSProperties = { fontSize: 14, color: "#666" }
const card: CSSProperties = { border: "1px solid #ccc", borderRadius: 8, padding: 12 }

const LIMIT = 10

export interface TopTab {
  readonly report: TopReport
  readonly title: string
  /** What the counts are, e.g. "Pageviews" or "Sessions". */
  readonly unit: string
  /** Display text for a value. */
  readonly label?: (value: string) => string
  /** What a `null` value means (default "Unknown"). */
  readonly nullLabel?: string
  /** The Event property a row's value filters by, e.g. `$path` for pages. */
  readonly filterKey: string
}

/** True when the range can be sent: a custom range needs both dates. */
export const isComplete = (range: ReportRangeQuery) =>
  range.period !== "custom" || (range.from !== undefined && range.to !== undefined)

export const TopList = (
  { environment, range, tabs, onAddFilter }: {
    environment: Environment
    range: ReportRangeQuery
    tabs: ReadonlyArray<TopTab>
    onAddFilter: (filter: PropertyFilter) => void
  }
) => {
  const [selected, setSelected] = useState(0)
  const tab = tabs[selected] ?? tabs[0]!
  const complete = isComplete(range)
  const { data, error } = usePoll(
    () =>
      complete
        ? request((api) =>
          api.reports.top({ params: { environmentId: environment.id }, query: { ...range, report: tab.report } })
        )
        : Promise.resolve(undefined),
    [environment.id, tab.report, ...queryDeps(range)]
  )
  const rows = data?.report === tab.report ? data.rows : undefined
  return (
    <article style={card} data-testid={`top-${tab.report}`}>
      <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
        {tabs.length === 1 ? <strong>{tab.title}</strong> : tabs.map((t, i) => (
          <button
            key={t.report}
            type="button"
            aria-pressed={i === selected}
            onClick={() => setSelected(i)}
            style={{
              all: "unset",
              cursor: "pointer",
              fontWeight: i === selected ? 600 : 400,
              color: i === selected ? "inherit" : "#666",
              borderBottom: i === selected ? "2px solid #2a6fdb" : "2px solid transparent"
            }}
          >
            {t.title}
          </button>
        ))}
        <span style={{ ...muted, fontSize: 12, marginLeft: "auto" }}>{tab.unit}</span>
      </div>
      {error && !rows ? <p role="alert" style={muted}>Could not load.</p> : null}
      {complete && !rows && !error ? <p style={muted}>Loading…</p> : null}
      {rows?.length === 0 ? <p style={muted}>Nothing in this range.</p> : null}
      {rows && rows.length > 0 ? <Rows rows={rows} tab={tab} onAddFilter={onAddFilter} /> : null}
    </article>
  )
}

const Rows = ({ rows, tab, onAddFilter }: {
  rows: ReadonlyArray<TopRow>
  tab: TopTab
  onAddFilter: (filter: PropertyFilter) => void
}) => {
  const total = rows.reduce((sum, row) => sum + row.count, 0)
  const max = Math.max(...rows.map((row) => row.count))
  return (
    <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0", display: "grid", gap: 4 }}>
      {rows.slice(0, LIMIT).map((row) => (
        <li key={row.value ?? ""} style={{ position: "relative", padding: "2px 6px", fontSize: 14 }}>
          <span
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              width: `${(row.count / max) * 100}%`,
              background: "#e8eefc",
              borderRadius: 4
            }}
          />
          <span style={{ position: "relative", display: "flex", justifyContent: "space-between", gap: 8 }}>
            {row.value === null
              ? <span style={{ ...muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tab.nullLabel ?? "Unknown"}</span>
              : (
                <button
                  type="button"
                  title={`Filter by ${tab.filterKey} is ${row.value}`}
                  onClick={() => onAddFilter({ property: tab.filterKey, op: "is", value: row.value! })}
                  style={{ all: "unset", cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {tab.label ? tab.label(row.value) : row.value}
                </button>
              )}
            <span title={`${Math.round((row.count / total) * 100)}%`}>{row.count.toLocaleString()}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}
