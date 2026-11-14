// The Events tab: every Custom event sent in the range on the left, each with a sparkline over the
// range and its change against the previous period; the selected one on the right
// with its count over time, a breakdown for each string or boolean Event property, and statistics
// for each numeric one. Clicking a breakdown row adds its value as a Filter. The count chart draws
// the Environment's Annotations like the overview's (owners may delete them from their details).
import type { CustomEventDetail, Environment, EventPropertyFilter, ProjectId, ReportRangeQuery } from "@flock/shared"
import { useNavigate } from "@tanstack/react-router"
import { request } from "./api.ts"
import { AnnotationDetails, useChartAnnotations } from "./chart-annotations.tsx"
import { formatChange } from "./change.ts"
import { bucketLabel } from "./chart-scale.ts"
import { barWidth, formatCount, formatNumber, formatPercent } from "./format.ts"
import { isComplete, type ProjectSearch, queryDeps, reportQuery } from "./project-search.ts"
import { Sparkline } from "./sparkline-chart.tsx"
import { TrendChart } from "./trend-chart.tsx"
import { barStyle, Detail, Notice, pending, Rows, wide } from "./ui.tsx"
import { usePoll } from "./use-poll.ts"

/** A list row's sparkline: narrower than the Projects page's, to leave room for the name. */
const SPARK_LIST_WIDTH = 72

export const CustomEvents = ({ projectId, environment, environments, search, timeZone, isOwner, onAddFilter }: {
  projectId: ProjectId
  environment: Environment
  environments: ReadonlyArray<Environment>
  search: ProjectSearch
  timeZone: string
  /** Owners may delete Annotations from the chart. */
  isOwner: boolean
  onAddFilter: (filter: EventPropertyFilter) => void
}) => {
  const navigate = useNavigate()
  const query = reportQuery(search)
  const complete = isComplete(query)
  const { data, error } = usePoll(
    () => complete ? request((api) => api.customEvents.list({ params: { environmentId: environment.id }, query })) : Promise.resolve(undefined),
    [environment.id, ...queryDeps(query)]
  )
  const selected = search.event ?? data?.events[0]?.name
  const select = (event: string | undefined) =>
    void navigate({ to: "/projects/$projectId", params: { projectId }, search: { ...search, event }, replace: event === undefined })
  return (
    <div className="page split">
      <section data-testid="custom-events">
        <h1>Custom events</h1>
        {!complete ? <Notice>Pick both dates.</Notice> : !data ? pending(error, "Custom events") : data.events.length === 0 ? (
          <Notice>No Custom events in this range. Send one with <code>flock.track("name", {"{ … }"})</code>.</Notice>
        ) : (
          <Rows
            variant="select"
            columns={[
              { label: "Event" },
              { label: "Trend", width: SPARK_LIST_WIDTH + 8 },
              { label: "Events", width: 72 },
              { label: "Change", width: 64, wide: true },
              { label: "Unique Visitors", width: 112, wide: true }
            ]}
          >
            {data.events.map((e) => {
              const change = formatChange(e.count, e.previousCount, "percent")
              return (
                <button key={e.name} type="button" role="row" className="row" aria-current={e.name === selected} onClick={() => select(e.name)}>
                  <span>{e.name}</span>
                  <span className="spark-cell">
                    <Sparkline values={e.series.map((b) => b.count)} label={`Events per ${data.interval}`} width={SPARK_LIST_WIDTH} />
                  </span>
                  <span>{formatCount(e.count)}</span>
                  <span className="kpi-change" data-tone={change.tone} title="Against the previous period" {...wide}>{change.label}</span>
                  <span {...wide}>{formatCount(e.visitors)}</span>
                </button>
              )
            })}
          </Rows>
        )}
      </section>
      <Detail open={search.event !== undefined} onClose={() => select(undefined)}>
        {complete && selected !== undefined && (
          <Drilldown
            projectId={projectId}
            environment={environment}
            environments={environments}
            name={selected}
            query={query}
            timeZone={timeZone}
            isOwner={isOwner}
            onAddFilter={onAddFilter}
          />
        )}
      </Detail>
    </div>
  )
}

const Drilldown = ({ projectId, environment, environments, name, query, timeZone, isOwner, onAddFilter }: {
  projectId: ProjectId
  environment: Environment
  environments: ReadonlyArray<Environment>
  name: string
  query: ReportRangeQuery
  timeZone: string
  isOwner: boolean
  onAddFilter: (filter: EventPropertyFilter) => void
}) => {
  const { data, error, reload } = usePoll(
    () => request((api) => api.customEvents.detail({ params: { environmentId: environment.id }, query: { ...query, name } })),
    [environment.id, name, ...queryDeps(query)]
  )
  const pills = useChartAnnotations(
    data && { annotations: data.annotations, buckets: data.series.map((b) => b.bucket), interval: data.interval, timeZone }
  )
  if (!data || data.name !== name) return pending(error, name)
  // The app's own Event properties. Flock's ($browser, $os, …) are on the Dashboard already.
  const own = data.properties.filter((p) => !p.key.startsWith("$"))
  const categorical = own.filter((p) => p.types.includes("string") || p.types.includes("boolean")).map((p) => p.key)
  const numeric = own.filter((p) => p.types.includes("number")).map((p) => p.key)
  return (
    <>
      <h2>{name}</h2>
      <p className="dim">
        {formatCount(data.totals.count)} {data.totals.count === 1 ? "Event" : "Events"} from {formatCount(data.totals.visitors)}{" "}
        {data.totals.visitors === 1 ? "Visitor" : "Visitors"}
      </p>
      <TrendChart
        name="Events"
        labels={data.series.map((b) => bucketLabel(data.interval, b.bucket))}
        values={data.series.map((b) => b.count)}
        format={formatCount}
        height={200}
        {...pills.chart}
      />
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
      {categorical.map((key) => (
        <PropertyBreakdown key={key} environment={environment} detail={data} query={query} eventProperty={key} onAddFilter={onAddFilter} />
      ))}
      {numeric.length > 0 && <PropertyStats environment={environment} detail={data} query={query} keys={numeric} />}
    </>
  )
}

/** One string or boolean Event property: how many Events had each value. */
const PropertyBreakdown = ({ environment, detail, query, eventProperty, onAddFilter }: {
  environment: Environment
  detail: CustomEventDetail
  query: ReportRangeQuery
  eventProperty: string
  onAddFilter: (filter: EventPropertyFilter) => void
}) => {
  const { data, error } = usePoll(
    () => request((api) => api.customEvents.breakdown({ params: { environmentId: environment.id }, query: { ...query, name: detail.name, eventProperty } })),
    [environment.id, detail.name, eventProperty, ...queryDeps(query)]
  )
  const total = data?.rows.reduce((sum, row) => sum + row.count, 0) ?? 0
  const max = Math.max(0, ...(data?.rows ?? []).map((r) => r.count))
  return (
    <div className="detail-block" data-testid="custom-event-breakdown">
      <Rows variant="bars" title={<code>{eventProperty}</code>} columns={[{ label: eventProperty }, { label: "Events", width: 80 }, { label: "Share", width: 64 }]}>
        {!data ? pending(error, eventProperty) : data.rows.map((row) => {
          const cells = (
            <>
              <span className={row.value === null ? "muted" : undefined}>{row.value ?? "Not set"}</span>
              <span>{formatCount(row.count)}</span>
              <span>{formatPercent(total > 0 ? row.count / total : 0)}</span>
            </>
          )
          return row.value === null
            ? <div key="not-set" role="row" className="row" style={barStyle(barWidth(row.count, max))}>{cells}</div>
            : (
              <button
                key={row.value}
                type="button"
                role="row"
                className="row"
                style={barStyle(barWidth(row.count, max))}
                title={`Filter by ${eventProperty} is ${row.value}`}
                onClick={() => onAddFilter({ eventProperty, op: "is", value: row.value! })}
              >
                {cells}
              </button>
            )
        })}
      </Rows>
    </div>
  )
}

/** The numeric Event properties: average, median, sum, min and max of each, one row per property. */
const PropertyStats = ({ environment, detail, query, keys }: {
  environment: Environment
  detail: CustomEventDetail
  query: ReportRangeQuery
  keys: ReadonlyArray<string>
}) => (
  <div className="detail-block" data-testid="custom-event-stats">
    <Rows
      title="Numbers"
      columns={[
        { label: "Numbers" },
        { label: "Average", width: 88 },
        { label: "Median", width: 80, wide: true },
        { label: "Sum", width: 88 },
        { label: "Min", width: 64, wide: true },
        { label: "Max", width: 64, wide: true }
      ]}
    >
      {keys.map((key) => <StatsRow key={key} environment={environment} detail={detail} query={query} eventProperty={key} />)}
    </Rows>
    <p className="dim" style={{ marginTop: 8 }}>Only numeric values count.</p>
  </div>
)

const StatsRow = ({ environment, detail, query, eventProperty }: {
  environment: Environment
  detail: CustomEventDetail
  query: ReportRangeQuery
  eventProperty: string
}) => {
  const { data } = usePoll(
    () => request((api) => api.customEvents.stats({ params: { environmentId: environment.id }, query: { ...query, name: detail.name, eventProperty } })),
    [environment.id, detail.name, eventProperty, ...queryDeps(query)]
  )
  const t = data?.totals
  return (
    <div role="row" className="row">
      <span><code>{eventProperty}</code></span>
      <span>{formatNumber(t?.average)}</span>
      <span {...wide}>{formatNumber(t?.median)}</span>
      <span>{formatNumber(t?.sum)}</span>
      <span {...wide}>{formatNumber(t?.min)}</span>
      <span {...wide}>{formatNumber(t?.max)}</span>
    </div>
  )
}
