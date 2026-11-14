// The Dashboard tab, top to bottom: the five headline numbers with their change against the
// previous period (click one to chart it), the chart with the previous period as a grey line,
// Recent Sessions, then Pages, Sources, Countries and Devices as a 2×2 grid.
import type { Environment, EventPropertyFilter, OverviewNumbers, ProjectId, ReportRangeQuery } from "@flock/shared"
import { DateTime } from "effect"
import { useState } from "react"
import { placeAnnotations } from "./annotations.ts"
import { request } from "./api.ts"
import { Breakdown, BREAKDOWNS } from "./breakdown.tsx"
import { type ChangeUnit, formatChange } from "./change.ts"
import { AddAnnotation, AnnotationDetails } from "./chart-annotations.tsx"
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

export const Dashboard = ({ projectId, environment, search, timeZone, isOwner, onAddFilter }: {
  projectId: ProjectId
  environment: Environment
  search: ProjectSearch
  timeZone: string
  /** Owners add and delete Annotations. */
  isOwner: boolean
  onAddFilter: (filter: EventPropertyFilter) => void
}) => {
  const query = reportQuery(search)
  return (
    <div className="page">
      <Overview projectId={projectId} environment={environment} query={query} timeZone={timeZone} isOwner={isOwner} />
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

const Overview = ({ projectId, environment, query, timeZone, isOwner }: {
  projectId: ProjectId
  environment: Environment
  query: ReportRangeQuery
  timeZone: string
  isOwner: boolean
}) => {
  const [metricKey, setMetricKey] = useState<Metric>("visitors")
  // The bucket whose Annotations are open, by name so it survives each poll.
  const [openBucket, setOpenBucket] = useState<string>()
  const [adding, setAdding] = useState(false)
  const phone = useIsPhone()
  const complete = isComplete(query)
  const { data, error, reload } = usePoll(
    () => complete ? request((api) => api.reports.overview({ params: { environmentId: environment.id }, query })) : Promise.resolve(undefined),
    [environment.id, ...queryDeps(query)]
  )
  const metric = METRICS.find((m) => m.key === metricKey)!
  const buckets = data?.series.map((b) => b.bucket) ?? []
  const placed = data
    ? placeAnnotations(
      data.annotations.map((a) => ({ annotation: a, at: DateTime.toEpochMillis(a.at) })),
      buckets,
      data.interval,
      timeZone
    )
    : []
  const open = placed.find((p) => buckets[p.index] === openBucket)
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
            <button type="button" className="link" onClick={() => { setAdding(true); setOpenBucket(undefined) }}>+ Add Annotation</button>
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
              annotations={placed.map((p) => ({ index: p.index, label: p.annotations[0]!.annotation.label, count: p.annotations.length }))}
              selectedAnnotation={open?.index}
              onAnnotation={(index) => {
                setAdding(false)
                setOpenBucket((current) => (current === buckets[index] ? undefined : buckets[index]))
              }}
            />
          )
          : error
          ? <Notice alert>Could not load the overview.</Notice>
          : <div style={{ height: phone ? 210 : 300 }} />}
        {open && (
          <AnnotationDetails
            projectId={projectId}
            annotations={open.annotations.map((p) => p.annotation)}
            timeZone={timeZone}
            isOwner={isOwner}
            onClose={() => setOpenBucket(undefined)}
            onDeleted={reload}
          />
        )}
        {adding && (
          <AddAnnotation
            projectId={projectId}
            timeZone={timeZone}
            onCancel={() => setAdding(false)}
            onAdded={async () => {
              setAdding(false)
              await reload()
            }}
          />
        )}
      </div>
    </>
  )
}
