// The Dashboard tab, top to bottom: the five headline numbers (click one to chart it), the chart,
// Recent Sessions, then Pages, Sources, Countries and Devices as a 2×2 grid.
import type { Environment, EventPropertyFilter, OverviewNumbers, ProjectId, ReportRangeQuery } from "@flock/shared"
import { useState } from "react"
import { request } from "./api.ts"
import { Breakdown, BREAKDOWNS } from "./breakdown.tsx"
import { bucketLabel } from "./chart-scale.ts"
import { formatCount, formatDuration, formatPercent } from "./format.ts"
import { isComplete, type ProjectSearch, queryDeps, reportQuery } from "./project-search.ts"
import { RecentSessions } from "./sessions.tsx"
import { TrendChart } from "./trend-chart.tsx"
import { Notice, useIsPhone } from "./ui.tsx"
import { usePoll } from "./use-poll.ts"

type Metric = keyof OverviewNumbers

const METRICS: ReadonlyArray<{ key: Metric; label: string; format: (value: number) => string }> = [
  { key: "visitors", label: "Unique Visitors", format: formatCount },
  { key: "pageviews", label: "Pageviews", format: formatCount },
  { key: "sessions", label: "Sessions", format: formatCount },
  { key: "bounceRate", label: "Bounce rate", format: formatPercent },
  { key: "visitDuration", label: "Visit duration", format: formatDuration }
]

export const Dashboard = ({ projectId, environment, search, timeZone, onAddFilter }: {
  projectId: ProjectId
  environment: Environment
  search: ProjectSearch
  timeZone: string
  onAddFilter: (filter: EventPropertyFilter) => void
}) => {
  const query = reportQuery(search)
  return (
    <div className="page">
      <Overview environment={environment} query={query} />
      <RecentSessions key={`${environment.id}-${queryDeps(query).join("|")}`} projectId={projectId} environment={environment} query={query} search={search} timeZone={timeZone} />
      <div className="breakdowns">
        {BREAKDOWNS.map((reports) => (
          <Breakdown key={reports[0]!.report} environment={environment} query={query} reports={reports} onAddFilter={onAddFilter} />
        ))}
        <p className="attribution">
          <a href="https://db-ip.com">IP Geolocation by DB-IP</a>
        </p>
      </div>
    </div>
  )
}

const Overview = ({ environment, query }: { environment: Environment; query: ReportRangeQuery }) => {
  const [metricKey, setMetricKey] = useState<Metric>("visitors")
  const phone = useIsPhone()
  const complete = isComplete(query)
  const { data, error } = usePoll(
    () => complete ? request((api) => api.reports.overview({ params: { environmentId: environment.id }, query })) : Promise.resolve(undefined),
    [environment.id, ...queryDeps(query)]
  )
  const metric = METRICS.find((m) => m.key === metricKey)!
  return (
    <>
      <div className="kpis">
        {METRICS.map((m) => {
          const value = data?.totals[m.key]
          return (
            <button key={m.key} type="button" aria-pressed={m.key === metricKey} onClick={() => setMetricKey(m.key)} data-testid={`overview-${m.key}`}>
              <span>{m.label}</span>
              <strong>{value === undefined || value === null ? "–" : m.format(value)}</strong>
            </button>
          )
        })}
      </div>
      <div className="chart-block">
        {!complete
          ? <Notice>Pick both dates.</Notice>
          : data
          ? (
            <TrendChart
              name={metric.label}
              labels={data.series.map((b) => bucketLabel(data.interval, b.bucket))}
              values={data.series.map((b) => b[metric.key])}
              format={metric.format}
              height={phone ? 210 : 300}
            />
          )
          : error
          ? <Notice alert>Could not load the overview.</Notice>
          : <div style={{ height: phone ? 210 : 300 }} />}
      </div>
    </>
  )
}
