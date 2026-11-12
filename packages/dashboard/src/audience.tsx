// Audience reports for one Environment: Pageviews by country, browser, OS and device,
// as ranked lists with proportional bars.
import type { BreakdownRow, Environment } from "@flock/shared"
import { DateTime } from "effect"
import type { CSSProperties } from "react"
import { request } from "./api.ts"
import { usePoll } from "./use-poll.ts"

const muted: CSSProperties = { fontSize: 14, color: "#666" }
const card: CSSProperties = { border: "1px solid #ccc", borderRadius: 8, padding: 12 }

const last30Days = () => {
  const to = DateTime.nowUnsafe()
  return { from: DateTime.subtract(to, { days: 30 }), to: DateTime.add(to, { minutes: 1 }) }
}

const countryNames = new Intl.DisplayNames(undefined, { type: "region" })
const countryName = (code: string) => {
  try {
    return countryNames.of(code) ?? code
  } catch {
    return code
  }
}

interface Report {
  readonly title: string
  readonly property: string
  readonly label?: (value: string) => string
}

const REPORTS: ReadonlyArray<Report> = [
  { title: "Countries", property: "$country", label: countryName },
  { title: "Browsers", property: "$browser" },
  { title: "Operating systems", property: "$os" },
  { title: "Devices", property: "$device", label: (value) => value.charAt(0).toUpperCase() + value.slice(1) }
]

const LIMIT = 10

export const AudienceReports = ({ environment }: { environment: Environment }) => (
  <section style={{ margin: "12px 0" }}>
    <h3 style={{ marginBottom: 4 }}>Audience</h3>
    <p style={{ ...muted, marginTop: 0 }}>Pageviews in the last 30 days</p>
    <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
      {REPORTS.map((report) => <Breakdown key={report.property} environment={environment} report={report} />)}
    </div>
    <p style={{ ...muted, fontSize: 12 }}>
      <a href="https://db-ip.com" style={{ color: "inherit" }}>IP Geolocation by DB-IP</a>
    </p>
  </section>
)

const Breakdown = ({ environment, report }: { environment: Environment; report: Report }) => {
  const { data, error } = usePoll(
    () =>
      request((api) =>
        api.reports.breakdown({
          params: { environmentId: environment.id },
          query: { ...last30Days(), property: report.property }
        })
      ),
    [environment.id, report.property]
  )
  return (
    <article style={card} data-testid={`breakdown-${report.property}`}>
      <strong>{report.title}</strong>
      {error && !data ? <p role="alert" style={muted}>Could not load.</p> : null}
      {!data && !error ? <p style={muted}>Loading…</p> : null}
      {data?.length === 0 ? <p style={muted}>No Pageviews yet.</p> : null}
      {data && data.length > 0 ? <Rows rows={data} label={report.label} /> : null}
    </article>
  )
}

const Rows = ({ rows, label }: { rows: ReadonlyArray<BreakdownRow>; label: Report["label"] }) => {
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
            <span style={row.value === null ? muted : undefined}>
              {row.value === null ? "Unknown" : label ? label(row.value) : row.value}
            </span>
            <span title={`${Math.round((row.count / total) * 100)}%`}>{row.count}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}
