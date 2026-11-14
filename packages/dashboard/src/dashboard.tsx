// The Dashboard tab, top to bottom: the five headline numbers with their change against the
// previous period (click one to chart it), the chart with the previous period as a grey line,
// Recent Sessions, then Pages, Sources, Countries and Devices as a 2×2 grid.
import type { Environment, EventPropertyFilter, OverviewNumbers, ProjectId, ReportRangeQuery } from "@flock/shared"
import { useState } from "react"
import { request } from "./api.ts"
import { Breakdown, BREAKDOWNS } from "./breakdown.tsx"
import { type ChangeUnit, formatChange } from "./change.ts"
import { AnnotationDetails, AnnotationForm, useChartAnnotations } from "./chart-annotations.tsx"
import { bucketLabel } from "./chart-scale.ts"
import { formatCount, formatDuration, formatPercent } from "./format.ts"
import { isComplete, type ProjectSearch, queryDeps, reportQuery } from "./project-search.ts"
import { RecentSessions } from "./sessions.tsx"
import { TrendChart } from "./trend-chart.tsx"
import { Notice, useIsPhone } from "./ui.tsx"
import { usePoll } from "./use-poll.ts"

type Metric = keyof OverviewNumbers

const METRICS: ReadonlyArray<{
  key: Metric
  label: string
  format: (value: number) => string
  unit: ChangeUnit
  lowerIsBetter?: boolean
}> = [
  { key: "visitors", label: "Unique Visitors", format: formatCount, unit: "percent" },
  { key: "pageviews", label: "Pageviews", format: formatCount, unit: "percent" },
  { key: "sessions", label: "Sessions", format: formatCount, unit: "percent" },
  { key: "bounceRate", label: "Bounce rate", format: formatPercent, unit: "points", lowerIsBetter: true },
  { key: "visitDuration", label: "Visit duration", format: formatDuration, unit: "percent" }
]

export const Dashboard = ({ projectId, environment, environments, search, timeZone, isOwner, onAddFilter }: {
  projectId: ProjectId
  environment: Environment
  /** The Project's Environments, for the Annotation form's choice. */
  environments: ReadonlyArray<Environment>
  search: ProjectSearch
  timeZone: string
  /** Owners add and delete Annotations. */
  isOwner: boolean
  onAddFilter: (filter: EventPropertyFilter) => void
}) => {
  const query = reportQuery(search)
  return (
    <div className="page">
      <Overview projectId={projectId} environment={environment} environments={environments} query={query} timeZone={timeZone} isOwner={isOwner} />
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

const Overview = ({ projectId, environment, environments, query, timeZone, isOwner }: {
  projectId: ProjectId
  environment: Environment
  environments: ReadonlyArray<Environment>
  query: ReportRangeQuery
  timeZone: string
  isOwner: boolean
}) => {
  const [metricKey, setMetricKey] = useState<Metric>("visitors")
  const [adding, setAdding] = useState(false)
  const phone = useIsPhone()
  const complete = isComplete(query)
  const { data, error, reload } = usePoll(
    () => complete ? request((api) => api.reports.overview({ params: { environmentId: environment.id }, query })) : Promise.resolve(undefined),
    [environment.id, ...queryDeps(query)]
  )
  const metric = METRICS.find((m) => m.key === metricKey)!
  const pills = useChartAnnotations(
    data && { annotations: data.annotations, buckets: data.series.map((b) => b.bucket), interval: data.interval, timeZone }
  )
  return (
    <>
      <div className="kpis">
        {METRICS.map((m) => {
          const value = data?.totals[m.key]
          const change = data && formatChange(value, data.previous.totals[m.key], m.unit, { lowerIsBetter: m.lowerIsBetter })
          return (
            <button key={m.key} type="button" aria-pressed={m.key === metricKey} onClick={() => setMetricKey(m.key)} data-testid={`overview-${m.key}`}>
              <span>{m.label}</span>
              <strong>{value === undefined || value === null ? "–" : m.format(value)}</strong>
              <small className="kpi-change" data-tone={change?.tone} title="Against the previous period">
                {change ? change.label : "\u00a0"}
              </small>
            </button>
          )
        })}
      </div>
      <div className="chart-block">
        {isOwner && complete && !adding && (
          <div className="chart-head">
            <button type="button" className="link" onClick={() => { setAdding(true); pills.close() }}>+ Add Annotation</button>
          </div>
        )}
        {!complete
          ? <Notice>Pick both dates.</Notice>
          : data
          ? (
            <TrendChart
              name={metric.label}
              labels={data.series.map((b) => bucketLabel(data.interval, b.bucket))}
              values={data.series.map((b) => b[metric.key])}
              previous={{
                labels: data.previous.series.map((b) => bucketLabel(data.interval, b.bucket)),
                values: data.previous.series.map((b) => b[metric.key])
              }}
              format={metric.format}
              height={phone ? 210 : 300}
              {...pills.chart}
              onAnnotation={(index) => {
                setAdding(false)
                pills.chart.onAnnotation(index)
              }}
            />
          )
          : error
          ? <Notice alert>Could not load the overview.</Notice>
          : <div style={{ height: phone ? 210 : 300 }} />}
        {pills.open && (
          <AnnotationDetails
            projectId={projectId}
            annotations={pills.open}
            environments={environments}
            timeZone={timeZone}
            isOwner={isOwner}
            onClose={pills.close}
            onDeleted={reload}
          />
        )}
        {adding && (
          <AnnotationForm
            projectId={projectId}
            timeZone={timeZone}
            environments={environments}
            onCancel={() => setAdding(false)}
            onSaved={async () => {
              setAdding(false)
              await reload()
            }}
          />
        )}
      </div>
    </>
  )
}
