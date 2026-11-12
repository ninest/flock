// Custom event reports: (Member, Environment, date range) -> the Custom event list and
// one Custom event's drill-down. Built-in events (names starting with `$`) never appear.
// Ranges and buckets are local to the Project's time zone, like the overview.
import { PgClient } from "@effect/sql-pg"
import {
  type CustomEventBreakdown,
  type CustomEventDetail,
  type CustomEventList,
  type CustomEventStats,
  CurrentMember,
  type EnvironmentId,
  type EnvironmentNotFound,
  FlockApi,
  type MemberId,
  type NumericStats,
  type PropertyFilter,
  type ReportRangeQuery
} from "@flock/shared"
import { Context, DateTime, Effect, Layer } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { matchesFilters } from "./filters.ts"
import { Projects } from "./projects.ts"
import { type ReportRange, resolveRange } from "./report-range.ts"

const emptyStats: NumericStats = { count: 0, average: null, sum: null, min: null, max: null, median: null }

type Report<A, Q = {}> = (
  member: MemberId,
  environmentId: EnvironmentId,
  query: ReportRangeQuery & Q
) => Effect.Effect<A, EnvironmentNotFound>

export class CustomEvents extends Context.Service<CustomEvents, {
  readonly list: Report<CustomEventList>
  readonly detail: Report<CustomEventDetail, { readonly name: string }>
  readonly breakdown: Report<CustomEventBreakdown, { readonly name: string; readonly property: string }>
  readonly stats: Report<CustomEventStats, { readonly name: string; readonly property: string }>
}>()("flock/CustomEvents") {
  static readonly layer = Layer.effect(
    CustomEvents,
    Effect.gen(function*() {
      const sql = yield* PgClient.PgClient
      const projects = yield* Projects

      const scope = (member: MemberId, environmentId: EnvironmentId, query: ReportRangeQuery) =>
        Effect.gen(function*() {
          const environment = yield* projects.environment(member, environmentId)
          return {
            id: environment.id,
            range: resolveRange(query, environment.timeZone, yield* DateTime.now),
            filters: query.filters
          }
        })

      /**
       * CTE `scoped`: the Environment's Custom events in range that match the filters, with
       * `bucket`, their local bucket start.
       */
      const scoped = (environmentId: string, range: ReportRange, filters: ReadonlyArray<PropertyFilter> | undefined) => sql`
        scoped AS (
          SELECT e.*, date_trunc(${range.interval}, e.ts AT TIME ZONE ${range.timeZone}) AS bucket
          FROM event e
          WHERE e.environment_id = ${environmentId}
            AND e.name NOT LIKE '$%'
            AND e.ts >= (${range.from}::date::timestamp AT TIME ZONE ${range.timeZone})
            AND e.ts < ((${range.to}::date + 1)::timestamp AT TIME ZONE ${range.timeZone})
            AND ${matchesFilters(sql, filters)}
        )`

      const list: CustomEvents["Service"]["list"] = (member, environmentId, query) =>
        Effect.gen(function*() {
          const { id, range, filters } = yield* scope(member, environmentId, query)
          const events = yield* sql<{ name: string; count: number; visitors: number }>`
            WITH ${scoped(id, range, filters)}
            SELECT name, count(*)::int AS count, count(DISTINCT visitor_id)::int AS visitors
            FROM scoped GROUP BY name
            ORDER BY count DESC, name ASC`
          return { ...range, events }
        }).pipe(Effect.catchTag("SqlError", Effect.die), Effect.withSpan("CustomEvents.list"))

      /** CTE `buckets`: every local bucket start in the range, and `label`, its display form. */
      const buckets = (range: ReportRange) => sql`
        buckets AS (
          SELECT generate_series(
            ${range.from}::date::timestamp,
            (${range.to}::date + 1)::timestamp - ('1 ' || ${range.interval})::interval,
            ('1 ' || ${range.interval})::interval
          ) AS bucket
        )`
      const label = (range: ReportRange) => range.interval === "hour" ? `YYYY-MM-DD"T"HH24:MI` : "YYYY-MM-DD"

      const detail: CustomEvents["Service"]["detail"] = (member, environmentId, query) =>
        Effect.gen(function*() {
          const { id, range, filters } = yield* scope(member, environmentId, query)
          const numbers = sql`count(*)::int AS count, count(DISTINCT visitor_id)::int AS visitors`
          const [totals] = yield* sql<{ count: number; visitors: number }>`
            WITH ${scoped(id, range, filters)}
            SELECT ${numbers} FROM scoped WHERE name = ${query.name}`
          const series = yield* sql<{ bucket: string; count: number; visitors: number }>`
            WITH ${scoped(id, range, filters)}, ${buckets(range)}
            SELECT to_char(b.bucket, ${label(range)}) AS bucket,
                   coalesce(e.count, 0) AS count, coalesce(e.visitors, 0) AS visitors
            FROM buckets b
            LEFT JOIN (SELECT bucket, ${numbers} FROM scoped WHERE name = ${query.name} GROUP BY bucket) e
              ON e.bucket = b.bucket
            ORDER BY b.bucket`
          const properties = yield* sql<{ key: string; types: Array<"string" | "number" | "boolean"> }>`
            WITH ${scoped(id, range, filters)}
            SELECT p.key, array_agg(DISTINCT jsonb_typeof(p.value) ORDER BY jsonb_typeof(p.value)) AS types
            FROM scoped, jsonb_each(scoped.properties) p
            WHERE scoped.name = ${query.name} AND jsonb_typeof(p.value) IN ('string', 'number', 'boolean')
            GROUP BY p.key
            ORDER BY p.key`
          return {
            ...range,
            name: query.name,
            totals: { count: totals?.count ?? 0, visitors: totals?.visitors ?? 0 },
            series,
            properties
          }
        }).pipe(Effect.catchTag("SqlError", Effect.die), Effect.withSpan("CustomEvents.detail"))

      const breakdown: CustomEvents["Service"]["breakdown"] = (member, environmentId, query) =>
        Effect.gen(function*() {
          const { id, range, filters } = yield* scope(member, environmentId, query)
          const rows = yield* sql<{ value: string | null; count: number }>`
            WITH ${scoped(id, range, filters)}
            SELECT properties ->> ${query.property} AS value, count(*)::int AS count
            FROM scoped WHERE name = ${query.name}
            GROUP BY 1
            ORDER BY count DESC, value ASC NULLS LAST`
          return { ...range, rows }
        }).pipe(Effect.catchTag("SqlError", Effect.die), Effect.withSpan("CustomEvents.breakdown"))

      /** Only JSON numbers count; strings, booleans, nulls, arrays and missing values are skipped. */
      const stats: CustomEvents["Service"]["stats"] = (member, environmentId, query) =>
        Effect.gen(function*() {
          const { id, range, filters } = yield* scope(member, environmentId, query)
          const numbers = sql`
            numbers AS (
              SELECT bucket, (properties ->> ${query.property})::float8 AS value FROM scoped
              WHERE name = ${query.name} AND jsonb_typeof(properties -> ${query.property}) = 'number'
            )`
          const aggregates = sql`
            count(value)::int AS count, avg(value) AS average, sum(value) AS sum,
            min(value) AS min, max(value) AS max,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY value) AS median`
          const [totals] = yield* sql<NumericStats>`
            WITH ${scoped(id, range, filters)}, ${numbers}
            SELECT ${aggregates} FROM numbers`
          const series = yield* sql<NumericStats & { readonly bucket: string }>`
            WITH ${scoped(id, range, filters)}, ${numbers}, ${buckets(range)}
            SELECT to_char(b.bucket, ${label(range)}) AS bucket, coalesce(n.count, 0) AS count,
                   n.average, n.sum, n.min, n.max, n.median
            FROM buckets b
            LEFT JOIN (SELECT bucket, ${aggregates} FROM numbers GROUP BY bucket) n ON n.bucket = b.bucket
            ORDER BY b.bucket`
          return { ...range, totals: totals ?? emptyStats, series }
        }).pipe(Effect.catchTag("SqlError", Effect.die), Effect.withSpan("CustomEvents.stats"))

      return CustomEvents.of({ list, detail, breakdown, stats })
    })
  )
}

export const CustomEventsHandlers = HttpApiBuilder.group(FlockApi, "customEvents", Effect.fn(function*(handlers) {
  const customEvents = yield* CustomEvents
  return handlers
    .handle("list", ({ params, query }) => CurrentMember.use(({ id }) => customEvents.list(id, params.environmentId, query)))
    .handle("detail", ({ params, query }) => CurrentMember.use(({ id }) => customEvents.detail(id, params.environmentId, query)))
    .handle("breakdown", ({ params, query }) => CurrentMember.use(({ id }) => customEvents.breakdown(id, params.environmentId, query)))
    .handle("stats", ({ params, query }) => CurrentMember.use(({ id }) => customEvents.stats(id, params.environmentId, query)))
}))
