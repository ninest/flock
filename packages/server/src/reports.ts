// Reports (the Queries module): (Member, Environment, date range) -> dashboard numbers.
// The dashboard never touches SQL. Each report starts from `scopedEvents`, the
// Environment's Events inside the range that match the filters, with their local time
// bucket, so every report counts the same filtered Events.
import { PgClient } from "@effect/sql-pg"
import type {
  BreakdownRow,
  EnvironmentId,
  EnvironmentNotFound,
  MemberId,
  Overview,
  OverviewNumbers,
  OverviewQuery,
  PropertyFilter,
  Top,
  TopQuery
} from "@flock/shared"
import { TOP_LIMIT } from "@flock/shared"
import { Context, DateTime, Effect, Layer } from "effect"
import { matchesFilters, pathOf, referringDomainOf } from "./filters.ts"
import { Projects } from "./projects.ts"
import { type ReportRange, resolveRange } from "./report-range.ts"

/**
 * The UTM reports read `$utm_source` and friends, which Enrichment derives from the Pageview's
 * URL, or else a plain `utm_source` Event property sent by an app.
 */
const UTM_TAGS = { utmSources: "utm_source", utmMediums: "utm_medium", utmCampaigns: "utm_campaign" } as const

/** The live counter's window. */
const LIVE_MINUTES = 30

const AUDIENCE = { countries: "$country", browsers: "$browser", oses: "$os", devices: "$device" } as const

export interface DateRange {
  readonly from: DateTime.Utc
  readonly to: DateTime.Utc
}

interface NumbersRow {
  readonly visitors: number
  readonly pageviews: number
  readonly sessions: number
  readonly bounceRate: number | null
  readonly visitDuration: number | null
}

const toNumbers = (row: NumbersRow | undefined): OverviewNumbers => ({
  visitors: row?.visitors ?? 0,
  pageviews: row?.pageviews ?? 0,
  sessions: row?.sessions ?? 0,
  bounceRate: row?.bounceRate ?? null,
  visitDuration: row?.visitDuration ?? null
})

export class Reports extends Context.Service<Reports, {
  readonly pageviewCount: (
    member: MemberId,
    environmentId: EnvironmentId,
    range: DateRange
  ) => Effect.Effect<number, EnvironmentNotFound>
  /** Counts `event` Events by the value of one Event property, most frequent first, `null` last. */
  readonly breakdown: (
    member: MemberId,
    environmentId: EnvironmentId,
    range: DateRange,
    by: { readonly property: string; readonly event: string; readonly filters?: ReadonlyArray<PropertyFilter> | undefined }
  ) => Effect.Effect<ReadonlyArray<BreakdownRow>, EnvironmentNotFound>
  /** Every Event property key seen in the range, sorted. */
  readonly propertyKeys: (
    member: MemberId,
    environmentId: EnvironmentId,
    range: DateRange
  ) => Effect.Effect<ReadonlyArray<string>, EnvironmentNotFound>
  /** Unique Visitors, Pageviews, Sessions, bounce rate and visit duration: totals and a time series. */
  readonly overview: (
    member: MemberId,
    environmentId: EnvironmentId,
    query: OverviewQuery
  ) => Effect.Effect<Overview, EnvironmentNotFound>
  /** The live counter: unique Visitors with an Event in the last 30 minutes. */
  readonly liveVisitors: (
    member: MemberId,
    environmentId: EnvironmentId,
    filters?: ReadonlyArray<PropertyFilter>
  ) => Effect.Effect<number, EnvironmentNotFound>
  /** A ranked-list report: top pages, entry and exit pages, referrers, UTM tags or audience. */
  readonly top: (
    member: MemberId,
    environmentId: EnvironmentId,
    query: TopQuery
  ) => Effect.Effect<Top, EnvironmentNotFound>
}>()("flock/Reports") {
  static readonly layer = Layer.effect(
    Reports,
    Effect.gen(function*() {
      const sql = yield* PgClient.PgClient

      const projects = yield* Projects

      /** Access check plus the range resolved in the Project's time zone. */
      const scope = (member: MemberId, environmentId: EnvironmentId, query: OverviewQuery) =>
        Effect.gen(function*() {
          const environment = yield* projects.environment(member, environmentId)
          const range = resolveRange(query, environment.timeZone, yield* DateTime.now)
          return { environmentId: environment.id, range, filters: query.filters }
        })

      /**
       * CTEs `scoped` (Events in range, with `bucket`, their local bucket start) and `sessions`
       * (per Session in range: `bucket` where it starts, `duration` in seconds, `bounce`).
       * A bounce is a Session with a single Event.
       */
      const scopedEvents = (environmentId: string, range: ReportRange, filters: ReadonlyArray<PropertyFilter> | undefined) => sql`
        scoped AS (
          SELECT e.*, date_trunc(${range.interval}, e.ts AT TIME ZONE ${range.timeZone}) AS bucket
          FROM event e
          WHERE e.environment_id = ${environmentId}
            AND e.ts >= (${range.from}::date::timestamp AT TIME ZONE ${range.timeZone})
            AND e.ts < ((${range.to}::date + 1)::timestamp AT TIME ZONE ${range.timeZone})
            AND ${matchesFilters(sql, filters)}
        ),
        sessions AS (
          SELECT session_id, min(bucket) AS bucket,
                 extract(epoch FROM max(ts) - min(ts)) AS duration, count(*) = 1 AS bounce
          FROM scoped WHERE session_id IS NOT NULL
          GROUP BY session_id
        )`

      const eventNumbers = sql`
        count(DISTINCT visitor_id)::int AS visitors,
        count(*) FILTER (WHERE name = '$pageview')::int AS pageviews`
      const sessionNumbers = sql`
        count(*)::int AS sessions,
        avg(bounce::int)::float8 AS bounce_rate,
        round(avg(duration))::int AS visit_duration`

      const overview = Effect.fn("Reports.overview")(function*(member: MemberId, environmentId: EnvironmentId, query: OverviewQuery) {
        const { environmentId: id, range, filters } = yield* scope(member, environmentId, query)
        const label = range.interval === "hour" ? `YYYY-MM-DD"T"HH24:MI` : "YYYY-MM-DD"

        const [totals] = yield* sql<NumbersRow>`
          WITH ${scopedEvents(id, range, filters)}
          SELECT ev.*, se.* FROM (SELECT ${eventNumbers} FROM scoped) ev, (SELECT ${sessionNumbers} FROM sessions) se`

        const series = yield* sql<NumbersRow & { readonly bucket: string }>`
          WITH ${scopedEvents(id, range, filters)},
          buckets AS (
            SELECT generate_series(
              ${range.from}::date::timestamp,
              (${range.to}::date + 1)::timestamp - ('1 ' || ${range.interval})::interval,
              ('1 ' || ${range.interval})::interval
            ) AS bucket
          )
          SELECT to_char(b.bucket, ${label}) AS bucket,
                 coalesce(ev.visitors, 0) AS visitors, coalesce(ev.pageviews, 0) AS pageviews,
                 coalesce(se.sessions, 0) AS sessions, se.bounce_rate, se.visit_duration
          FROM buckets b
          LEFT JOIN (SELECT bucket, ${eventNumbers} FROM scoped GROUP BY bucket) ev ON ev.bucket = b.bucket
          LEFT JOIN (SELECT bucket, ${sessionNumbers} FROM sessions GROUP BY bucket) se ON se.bucket = b.bucket
          ORDER BY b.bucket`

        return {
          ...range,
          totals: toNumbers(totals),
          series: series.map((row) => ({ bucket: row.bucket, ...toNumbers(row) }))
        }
      }, (effect) => Effect.catchTag(effect, "SqlError", Effect.die))

      /** The first (or last) Pageview of each Session in the range, as `properties`. */
      const sessionPageview = (which: "first" | "last") => sql`
        SELECT DISTINCT ON (session_id) properties FROM scoped
        WHERE name = '$pageview' AND session_id IS NOT NULL
        ORDER BY session_id, ${which === "first" ? sql`ts ASC, received_at ASC` : sql`ts DESC, received_at DESC`}`

      /** One SELECT per report, over the `scoped` CTE, yielding `value` and `count` rows. */
      const topRows = (report: TopQuery["report"]) => {
        switch (report) {
          case "pages":
            return sql`SELECT ${pathOf(sql)} AS value, count(*)::int AS count
              FROM scoped WHERE name = '$pageview' GROUP BY 1`
          case "entryPages":
          case "exitPages":
            return sql`SELECT ${pathOf(sql)} AS value, count(*)::int AS count
              FROM (${sessionPageview(report === "entryPages" ? "first" : "last")}) s GROUP BY 1`
          case "referrers":
            return sql`SELECT ${referringDomainOf(sql)} AS value, count(*)::int AS count
              FROM (${sessionPageview("first")}) s GROUP BY 1`
          case "utmSources":
          case "utmMediums":
          case "utmCampaigns": {
            const tag = UTM_TAGS[report]
            const value = sql`coalesce(properties ->> ${"$" + tag}, properties ->> ${tag})`
            return sql`SELECT ${value} AS value, count(*)::int AS count
              FROM (${sessionPageview("first")}) s WHERE ${value} IS NOT NULL AND ${value} <> '' GROUP BY 1`
          }
          case "countries":
          case "browsers":
          case "oses":
          case "devices":
            return sql`SELECT properties ->> ${AUDIENCE[report]} AS value, count(*)::int AS count
              FROM scoped WHERE name = '$pageview' GROUP BY 1`
        }
      }

      const top = Effect.fn("Reports.top")(function*(member: MemberId, environmentId: EnvironmentId, query: TopQuery) {
        const { environmentId: id, range, filters } = yield* scope(member, environmentId, query)
        const rows = yield* sql<{ readonly value: string | null; readonly count: number }>`
          WITH ${scopedEvents(id, range, filters)}
          SELECT value, count FROM (${topRows(query.report)}) t
          ORDER BY count DESC, value ASC NULLS LAST
          LIMIT ${TOP_LIMIT}`
        return { from: range.from, to: range.to, timeZone: range.timeZone, report: query.report, rows }
      }, (effect) => Effect.catchTag(effect, "SqlError", Effect.die))

      const liveVisitors = Effect.fn("Reports.liveVisitors")(function*(
        member: MemberId,
        environmentId: EnvironmentId,
        filters?: ReadonlyArray<PropertyFilter>
      ) {
        const environment = yield* projects.environment(member, environmentId)
        const now = yield* DateTime.now
        const [row] = yield* sql<{ readonly visitors: number }>`
          SELECT count(DISTINCT visitor_id)::int AS visitors FROM event
          WHERE environment_id = ${environment.id}
            AND ts > ${DateTime.toDateUtc(DateTime.subtract(now, { minutes: LIVE_MINUTES }))}
            AND ts <= ${DateTime.toDateUtc(now)}
            AND ${matchesFilters(sql, filters)}`
        return row?.visitors ?? 0
      }, (effect) => Effect.catchTag(effect, "SqlError", Effect.die))

      const pageviewCount = Effect.fn("Reports.pageviewCount")(function*(member: MemberId, environmentId: EnvironmentId, range: DateRange) {
        yield* projects.environment(member, environmentId)
        const [row] = yield* sql<{ count: number }>`
          SELECT count(*)::int AS count FROM event
          WHERE environment_id = ${environmentId} AND name = '$pageview'
            AND ts >= ${DateTime.toDateUtc(range.from)} AND ts < ${DateTime.toDateUtc(range.to)}`
        return row?.count ?? 0
      }, (effect) => Effect.catchTag(effect, "SqlError", Effect.die))

      const breakdown = Effect.fn("Reports.breakdown")(function*(
        member: MemberId,
        environmentId: EnvironmentId,
        range: DateRange,
        by: { readonly property: string; readonly event: string; readonly filters?: ReadonlyArray<PropertyFilter> | undefined }
      ) {
        yield* projects.environment(member, environmentId)
        return yield* sql<BreakdownRow>`
          SELECT properties ->> ${by.property} AS value, count(*)::int AS count FROM event
          WHERE environment_id = ${environmentId} AND name = ${by.event}
            AND ts >= ${DateTime.toDateUtc(range.from)} AND ts < ${DateTime.toDateUtc(range.to)}
            AND ${matchesFilters(sql, by.filters)}
          GROUP BY 1
          ORDER BY count DESC, value ASC NULLS LAST`
      }, (effect) => Effect.catchTag(effect, "SqlError", Effect.die))

      const propertyKeys = Effect.fn("Reports.propertyKeys")(function*(member: MemberId, environmentId: EnvironmentId, range: DateRange) {
        yield* projects.environment(member, environmentId)
        const rows = yield* sql<{ key: string }>`
          SELECT DISTINCT jsonb_object_keys(properties) AS key FROM event
          WHERE environment_id = ${environmentId}
            AND ts >= ${DateTime.toDateUtc(range.from)} AND ts < ${DateTime.toDateUtc(range.to)}
          ORDER BY key`
        return rows.map((row) => row.key)
      }, (effect) => Effect.catchTag(effect, "SqlError", Effect.die))

      return Reports.of({ pageviewCount, overview, breakdown, propertyKeys, top, liveVisitors })
    })
  )
}
