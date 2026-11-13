// Queries: (Member, Environment, range, filters) -> dashboard numbers. Every report SQL lives
// behind this one service; the dashboard never touches SQL. The reports on local days start from
// `scopedEvents`, the Environment's Events inside the range that match the filters, with their
// local time bucket, so every report counts the same filtered Events.
import { PgClient } from "@effect/sql-pg"
import type {
  BreakdownRow,
  CustomEventBreakdown,
  CustomEventDetail,
  CustomEventList,
  CustomEventStats,
  EnvironmentId,
  EnvironmentNotFound,
  MemberId,
  NumericStats,
  Overview,
  OverviewNumbers,
  EventPropertyFilters,
  ReportRangeQuery,
  SessionDetail,
  SessionList,
  SessionStatus,
  SessionsQuery,
  SessionSummary,
  Top,
  TopQuery
} from "@flock/shared"
import { SESSION_EVENT_LIMIT, SessionNotFound, SESSIONS_PAGE_SIZE, TOP_LIMIT } from "@flock/shared"
import { Context, DateTime, Effect, Layer } from "effect"
import type { SqlError } from "effect/sql/SqlError"
import type { Fragment } from "effect/sql/Statement"
import { matchesFilters, pathOf, referringDomainOf } from "./filters.ts"
import { Projects } from "./projects.ts"
import { type ReportRange, resolveRange } from "./report-range.ts"
import { SESSION_TIMEOUT_MINUTES } from "./sessions.ts"

/** An exact `[from, to)` time range, for the reports that don't work on local days. */
export interface DateRange {
  readonly from: DateTime.Utc
  readonly to: DateTime.Utc
}

/**
 * What every report is asked: who is asking, about which Environment, and the report's query
 * (its range, filters and report-specific fields, as the HTTP API receives them).
 */
export interface ReportRequest<Q> {
  readonly member: MemberId
  readonly environmentId: EnvironmentId
  readonly query: Q & { readonly filters?: EventPropertyFilters | undefined }
}

type Report<Q, A> = (request: ReportRequest<Q>) => Effect.Effect<A, EnvironmentNotFound>

export class Queries extends Context.Service<Queries, {
  /** Unique Visitors, Pageviews, Sessions, bounce rate and visit duration: totals and a time series. */
  readonly overview: Report<ReportRangeQuery, Overview>
  /** A ranked-list report: top pages, entry and exit pages, referrers, UTM tags or audience. */
  readonly top: Report<TopQuery, Top>
  /** The live counter: unique Visitors with an Event in the last 30 minutes. */
  readonly liveVisitors: Report<{}, number>
  readonly pageviewCount: Report<DateRange, number>
  /** Counts `event` Events by the value of one Event property, most frequent first, `null` last. */
  readonly breakdown: Report<DateRange & { readonly eventProperty: string; readonly event: string }, ReadonlyArray<BreakdownRow>>
  /** Every Event property key seen in the range, sorted. */
  readonly eventPropertyKeys: Report<DateRange, ReadonlyArray<string>>
  /** The Custom events in the range (built-in `$` events never appear), most frequent first. */
  readonly customEvents: Report<ReportRangeQuery, CustomEventList>
  /** One Custom event: totals, a time series and its Event property keys with their types. */
  readonly customEvent: Report<ReportRangeQuery & { readonly name: string }, CustomEventDetail>
  readonly customEventBreakdown: Report<ReportRangeQuery & { readonly name: string; readonly eventProperty: string }, CustomEventBreakdown>
  /** Numeric stats of one Event property; only JSON numbers count. */
  readonly customEventStats: Report<ReportRangeQuery & { readonly name: string; readonly eventProperty: string }, CustomEventStats>
  /** Recent sessions: Sessions with an Event in the range that matches every filter, most recent activity first. */
  readonly sessions: Report<SessionsQuery, SessionList>
  /** One Session's summary, origin and Session timeline; `filters` mark the matching Events. */
  readonly session: (
    request: ReportRequest<{ readonly sessionId: string }>
  ) => Effect.Effect<SessionDetail, EnvironmentNotFound | SessionNotFound>
}>()("flock/Queries") {
  static readonly layer = Layer.effect(Queries, Effect.gen(function*() {
    const sql = yield* PgClient.PgClient
    const projects = yield* Projects

    /** Fails with EnvironmentNotFound unless the Member may read the Environment; returns its time zone. */
    const checkAccess = (request: ReportRequest<unknown>) => projects.environment(request.member, request.environmentId)

    /** The access check, then the query's date range picker resolved to local days in the Project's time zone. */
    const checkAccessAndResolveRange = (request: ReportRequest<ReportRangeQuery>) =>
      Effect.gen(function*() {
        const environment = yield* checkAccess(request)
        const range = resolveRange(request.query, environment.timeZone, yield* DateTime.now)
        return { environmentId: environment.id, range, filters: request.query.filters } satisfies ReportScope
      })

    /**
     * CTE `scoped`: the Environment's Events in the range that match the filters (only Custom
     * events with `customOnly`), with `bucket`, their local bucket start.
     */
    const scopedEvents = ({ environmentId, filters, range }: ReportScope, options: { readonly customOnly?: boolean } = {}) => sql`
      scoped AS (
        SELECT e.*, date_trunc(${range.interval}, e.ts AT TIME ZONE ${range.timeZone}) AS bucket
        FROM event e
        WHERE e.environment_id = ${environmentId}
          ${options.customOnly ? sql`AND e.name NOT LIKE '$%'` : sql``}
          AND e.ts >= (${range.from}::date::timestamp AT TIME ZONE ${range.timeZone})
          AND e.ts < ((${range.to}::date + 1)::timestamp AT TIME ZONE ${range.timeZone})
          AND ${matchesFilters(sql, filters)}
      )`

    /**
     * CTE `sessions` over `scoped`: per Session in range, `bucket` where it starts, `duration` in
     * seconds, and `bounce`, a Session with a single Event.
     */
    const scopedSessions = sql`
      sessions AS (
        SELECT session_id, min(bucket) AS bucket,
               extract(epoch FROM max(ts) - min(ts)) AS duration, count(*) = 1 AS bounce
        FROM scoped WHERE session_id IS NOT NULL
        GROUP BY session_id
      )`

    /** CTE `buckets`: every local bucket start in the range. */
    const buckets = (range: ReportRange) => sql`
      buckets AS (
        SELECT generate_series(
          ${range.from}::date::timestamp,
          (${range.to}::date + 1)::timestamp - ('1 ' || ${range.interval})::interval,
          ('1 ' || ${range.interval})::interval
        ) AS bucket
      )`
    /** The `to_char` format of a bucket: `2026-03-01T13:00` (hour) or `2026-03-01` (day). */
    const bucketLabel = (range: ReportRange) => range.interval === "hour" ? `YYYY-MM-DD"T"HH24:MI` : "YYYY-MM-DD"

    /** `[from, to)` as a condition on `ts`. */
    const inDateRange = ({ from, to }: DateRange) => sql`ts >= ${DateTime.toDateUtc(from)} AND ts < ${DateTime.toDateUtc(to)}`

    /** A report's SqlError is a defect, and its span is named after it. */
    const report = <Q, A, E = never>(
      name: string,
      run: (request: ReportRequest<Q>) => Effect.Effect<A, EnvironmentNotFound | NoInfer<E> | SqlError>
    ): (request: ReportRequest<Q>) => Effect.Effect<A, EnvironmentNotFound | E> =>
      (request) => run(request).pipe(Effect.catchTag("SqlError", Effect.die), Effect.withSpan(`Queries.${name}`))

    // Traffic reports.

    const eventNumbers = sql`
      count(DISTINCT visitor_id)::int AS visitors,
      count(*) FILTER (WHERE name = '$pageview')::int AS pageviews`
    const sessionNumbers = sql`
      count(*)::int AS sessions,
      avg(bounce::int)::float8 AS bounce_rate,
      round(avg(duration))::int AS visit_duration`

    const overview = report("overview", (request: ReportRequest<ReportRangeQuery>) =>
      Effect.gen(function*() {
        const scope = yield* checkAccessAndResolveRange(request)
        const { range } = scope
        const [totals] = yield* sql<NumbersRow>`
          WITH ${scopedEvents(scope)}, ${scopedSessions}
          SELECT ev.*, se.* FROM (SELECT ${eventNumbers} FROM scoped) ev, (SELECT ${sessionNumbers} FROM sessions) se`
        const series = yield* sql<NumbersRow & { readonly bucket: string }>`
          WITH ${scopedEvents(scope)}, ${scopedSessions}, ${buckets(range)}
          SELECT to_char(b.bucket, ${bucketLabel(range)}) AS bucket,
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
      }))

    /** The first (or last) Pageview of each Session in the range, as `properties`. */
    const sessionPageview = (which: "first" | "last") => sql`
      SELECT DISTINCT ON (session_id) properties FROM scoped
      WHERE name = '$pageview' AND session_id IS NOT NULL
      ORDER BY session_id, ${which === "first" ? sql`ts ASC, received_at ASC` : sql`ts DESC, received_at DESC`}`

    /** One SELECT per ranked-list report, over the `scoped` CTE, yielding `value` and `count` rows. */
    const topRows = (kind: TopQuery["report"]) => {
      switch (kind) {
        case "pages":
          return sql`SELECT ${pathOf(sql)} AS value, count(*)::int AS count
            FROM scoped WHERE name = '$pageview' GROUP BY 1`
        case "entryPages":
        case "exitPages":
          return sql`SELECT ${pathOf(sql)} AS value, count(*)::int AS count
            FROM (${sessionPageview(kind === "entryPages" ? "first" : "last")}) s GROUP BY 1`
        case "referrers":
          return sql`SELECT ${referringDomainOf(sql)} AS value, count(*)::int AS count
            FROM (${sessionPageview("first")}) s GROUP BY 1`
        case "utmSources":
        case "utmMediums":
        case "utmCampaigns": {
          const tag = UTM_TAGS[kind]
          const value = sql`coalesce(properties ->> ${"$" + tag}, properties ->> ${tag})`
          return sql`SELECT ${value} AS value, count(*)::int AS count
            FROM (${sessionPageview("first")}) s WHERE ${value} IS NOT NULL AND ${value} <> '' GROUP BY 1`
        }
        case "countries":
        case "browsers":
        case "oses":
        case "devices":
          return sql`SELECT properties ->> ${AUDIENCE[kind]} AS value, count(*)::int AS count
            FROM scoped WHERE name = '$pageview' GROUP BY 1`
      }
    }

    const top = report("top", (request: ReportRequest<TopQuery>) =>
      Effect.gen(function*() {
        const scope = yield* checkAccessAndResolveRange(request)
        const { range } = scope
        const rows = yield* sql<{ readonly value: string | null; readonly count: number }>`
          WITH ${scopedEvents(scope)}, ${scopedSessions}
          SELECT value, count FROM (${topRows(request.query.report)}) t
          ORDER BY count DESC, value ASC NULLS LAST
          LIMIT ${TOP_LIMIT}`
        return { from: range.from, to: range.to, timeZone: range.timeZone, report: request.query.report, rows }
      }))

    const liveVisitors = report("liveVisitors", (request: ReportRequest<{}>) =>
      Effect.gen(function*() {
        const environment = yield* checkAccess(request)
        const now = yield* DateTime.now
        const [row] = yield* sql<{ readonly visitors: number }>`
          SELECT count(DISTINCT visitor_id)::int AS visitors FROM event
          WHERE environment_id = ${environment.id}
            AND ts > ${DateTime.toDateUtc(DateTime.subtract(now, { minutes: LIVE_MINUTES }))}
            AND ts <= ${DateTime.toDateUtc(now)}
            AND ${matchesFilters(sql, request.query.filters)}`
        return row?.visitors ?? 0
      }))

    // Reports on an exact `[from, to)` range.

    const pageviewCount = report("pageviewCount", (request: ReportRequest<DateRange>) =>
      Effect.gen(function*() {
        const environment = yield* checkAccess(request)
        const [row] = yield* sql<{ count: number }>`
          SELECT count(*)::int AS count FROM event
          WHERE environment_id = ${environment.id} AND name = '$pageview' AND ${inDateRange(request.query)}`
        return row?.count ?? 0
      }))

    const breakdown = report(
      "breakdown",
      (request: ReportRequest<DateRange & { readonly eventProperty: string; readonly event: string }>) =>
        Effect.gen(function*() {
          const environment = yield* checkAccess(request)
          const { event, filters, eventProperty } = request.query
          return yield* sql<BreakdownRow>`
            SELECT properties ->> ${eventProperty} AS value, count(*)::int AS count FROM event
            WHERE environment_id = ${environment.id} AND name = ${event}
              AND ${inDateRange(request.query)}
              AND ${matchesFilters(sql, filters)}
            GROUP BY 1
            ORDER BY count DESC, value ASC NULLS LAST`
        })
    )

    const eventPropertyKeys = report("eventPropertyKeys", (request: ReportRequest<DateRange>) =>
      Effect.gen(function*() {
        const environment = yield* checkAccess(request)
        const rows = yield* sql<{ key: string }>`
          SELECT DISTINCT jsonb_object_keys(properties) AS key FROM event
          WHERE environment_id = ${environment.id} AND ${inDateRange(request.query)}
          ORDER BY key`
        return rows.map((row) => row.key)
      }))

    // Custom event reports.

    const customEvents = report("customEvents", (request: ReportRequest<ReportRangeQuery>) =>
      Effect.gen(function*() {
        const scope = yield* checkAccessAndResolveRange(request)
        const events = yield* sql<{ name: string; count: number; visitors: number }>`
          WITH ${scopedEvents(scope, { customOnly: true })}
          SELECT name, count(*)::int AS count, count(DISTINCT visitor_id)::int AS visitors
          FROM scoped GROUP BY name
          ORDER BY count DESC, name ASC`
        return { ...scope.range, events }
      }))

    const customEvent = report("customEvent", (request: ReportRequest<ReportRangeQuery & { readonly name: string }>) =>
      Effect.gen(function*() {
        const scope = yield* checkAccessAndResolveRange(request)
        const { range } = scope
        const { name } = request.query
        const scoped = scopedEvents(scope, { customOnly: true })
        const numbers = sql`count(*)::int AS count, count(DISTINCT visitor_id)::int AS visitors`
        const [totals] = yield* sql<{ count: number; visitors: number }>`
          WITH ${scoped}
          SELECT ${numbers} FROM scoped WHERE name = ${name}`
        const series = yield* sql<{ bucket: string; count: number; visitors: number }>`
          WITH ${scoped}, ${buckets(range)}
          SELECT to_char(b.bucket, ${bucketLabel(range)}) AS bucket,
                 coalesce(e.count, 0) AS count, coalesce(e.visitors, 0) AS visitors
          FROM buckets b
          LEFT JOIN (SELECT bucket, ${numbers} FROM scoped WHERE name = ${name} GROUP BY bucket) e
            ON e.bucket = b.bucket
          ORDER BY b.bucket`
        const properties = yield* sql<{ key: string; types: Array<"string" | "number" | "boolean"> }>`
          WITH ${scoped}
          SELECT p.key, array_agg(DISTINCT jsonb_typeof(p.value) ORDER BY jsonb_typeof(p.value)) AS types
          FROM scoped, jsonb_each(scoped.properties) p
          WHERE scoped.name = ${name} AND jsonb_typeof(p.value) IN ('string', 'number', 'boolean')
          GROUP BY p.key
          ORDER BY p.key`
        return {
          ...range,
          name,
          totals: { count: totals?.count ?? 0, visitors: totals?.visitors ?? 0 },
          series,
          properties
        }
      }))

    const customEventBreakdown = report(
      "customEventBreakdown",
      (request: ReportRequest<ReportRangeQuery & { readonly name: string; readonly eventProperty: string }>) =>
        Effect.gen(function*() {
          const scope = yield* checkAccessAndResolveRange(request)
          const rows = yield* sql<{ value: string | null; count: number }>`
            WITH ${scopedEvents(scope, { customOnly: true })}
            SELECT properties ->> ${request.query.eventProperty} AS value, count(*)::int AS count
            FROM scoped WHERE name = ${request.query.name}
            GROUP BY 1
            ORDER BY count DESC, value ASC NULLS LAST`
          return { ...scope.range, rows }
        })
    )

    /** Only JSON numbers count; strings, booleans, nulls, arrays and missing values are skipped. */
    const customEventStats = report(
      "customEventStats",
      (request: ReportRequest<ReportRangeQuery & { readonly name: string; readonly eventProperty: string }>) =>
        Effect.gen(function*() {
          const scope = yield* checkAccessAndResolveRange(request)
          const { range } = scope
          const { name, eventProperty } = request.query
          const scoped = scopedEvents(scope, { customOnly: true })
          const numbers = sql`
            numbers AS (
              SELECT bucket, (properties ->> ${eventProperty})::float8 AS value FROM scoped
              WHERE name = ${name} AND jsonb_typeof(properties -> ${eventProperty}) = 'number'
            )`
          const aggregates = sql`
            count(value)::int AS count, avg(value) AS average, sum(value) AS sum,
            min(value) AS min, max(value) AS max,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY value) AS median`
          const [totals] = yield* sql<NumericStats>`
            WITH ${scoped}, ${numbers}
            SELECT ${aggregates} FROM numbers`
          const series = yield* sql<NumericStats & { readonly bucket: string }>`
            WITH ${scoped}, ${numbers}, ${buckets(range)}
            SELECT to_char(b.bucket, ${bucketLabel(range)}) AS bucket, coalesce(n.count, 0) AS count,
                   n.average, n.sum, n.min, n.max, n.median
            FROM buckets b
            LEFT JOIN (SELECT bucket, ${aggregates} FROM numbers GROUP BY bucket) n ON n.bucket = b.bucket
            ORDER BY b.bucket`
          return { ...range, totals: totals ?? emptyStats, series }
        })
    )

    /** Identified: the Visitor ID is one a device was linked to by Identify (ADR 0005). */
    const isIdentified = (projectId: string, visitorId: string) =>
      sql`SELECT 1 FROM visitor_alias WHERE project_id = ${projectId} AND visitor_id = ${visitorId} LIMIT 1`.pipe(
        Effect.map((rows) => rows.length > 0)
      )

    // Sessions.

    /**
     * SELECT list summarising the Sessions in `from` (rows of `sessionBounds`), aliased `s`, from all their Events: the first Event (audience) and the first Pageview
     * (entry page, referrer, UTM tags) as `first_event` and `first_pageview` laterals.
     */
    const sessionSummary = (environmentId: EnvironmentId, from: Fragment) => sql`
      s.session_id AS id, s.started_at, s.last_seen_at, s.events,
      round(extract(epoch FROM s.last_seen_at - s.started_at))::int AS duration,
      fe.properties ->> '$country' AS country, fe.properties ->> '$device' AS device,
      fe.properties ->> '$browser' AS browser, fe.properties ->> '$os' AS os,
      fe.visitor_id,
      CASE WHEN fp.properties IS NULL THEN NULL ELSE ${pathOf(sql, "fp.properties")} END AS entry_page,
      ${referringDomainOf(sql, "fp.properties")} AS referring_domain,
      nullif(fp.properties ->> '$referrer', '') AS referrer,
      coalesce(fp.properties ->> '$utm_source', fp.properties ->> 'utm_source') AS utm_source,
      coalesce(fp.properties ->> '$utm_medium', fp.properties ->> 'utm_medium') AS utm_medium,
      coalesce(fp.properties ->> '$utm_campaign', fp.properties ->> 'utm_campaign') AS utm_campaign
      FROM ${from} s
      CROSS JOIN LATERAL (
        SELECT properties, visitor_id FROM event
        WHERE environment_id = ${environmentId} AND session_id = s.session_id
        ORDER BY ts, received_at LIMIT 1
      ) fe
      LEFT JOIN LATERAL (
        SELECT properties FROM event
        WHERE environment_id = ${environmentId} AND session_id = s.session_id AND name = '$pageview'
        ORDER BY ts, received_at LIMIT 1
      ) fp ON TRUE`

    /** CTE `s`: the given Sessions' first and last Event and Event count, over all their Events. */
    const sessionBounds = (environmentId: EnvironmentId, ids: Fragment) => sql`
      s AS (
        SELECT session_id, min(ts) AS started_at, max(ts) AS last_seen_at, count(*)::int AS events
        FROM event
        WHERE environment_id = ${environmentId} AND session_id IN (${ids})
        GROUP BY session_id
      )`

    const sessions = report("sessions", (request: ReportRequest<SessionsQuery>) =>
      Effect.gen(function*() {
        const scope = yield* checkAccessAndResolveRange(request)
        const now = yield* DateTime.now
        const cursor = request.query.cursor === undefined ? undefined : parseCursor(request.query.cursor)
        const rows = yield* sql<SessionRow>`
          WITH ${scopedEvents(scope)},
          ${sessionBounds(scope.environmentId, sql`SELECT DISTINCT session_id FROM scoped WHERE session_id IS NOT NULL`)},
          page AS (
            SELECT * FROM s
            ${cursor === undefined ? sql`` : sql`WHERE (last_seen_at, session_id) < (${cursor.lastSeenAt}, ${cursor.id})`}
            ORDER BY last_seen_at DESC, session_id DESC
            LIMIT ${SESSIONS_PAGE_SIZE + 1}
          )
          SELECT ${sessionSummary(scope.environmentId, sql`page`)}
          ORDER BY s.last_seen_at DESC, s.session_id DESC`
        const page = rows.slice(0, SESSIONS_PAGE_SIZE)
        const last = page.at(-1)
        return {
          sessions: page.map((row) => toSummary(row, now)),
          nextCursor: rows.length > SESSIONS_PAGE_SIZE && last ? formatCursor(last) : null
        }
      }))

    const session = report<{ readonly sessionId: string }, SessionDetail, SessionNotFound>("session", (request: ReportRequest<{ readonly sessionId: string }>) =>
      Effect.gen(function*() {
        const environment = yield* checkAccess(request)
        const { filters, sessionId } = request.query
        const now = yield* DateTime.now
        const [row] = yield* sql<SessionRow>`
          WITH ${sessionBounds(environment.id, sql`${sessionId}`)}
          SELECT ${sessionSummary(environment.id, sql`s`)}`
        if (!row) return yield* Effect.fail(new SessionNotFound({ id: sessionId }))
        // The Visitor shows only in persistent Tracking mode (switching back to cookieless hides it, as
        // Visitors start afresh).
        const visitorId = environment.trackingMode === "persistent" ? row.visitorId : null
        const visitorIdentified = visitorId === null ? null : yield* isIdentified(environment.projectId, visitorId)
        const events = yield* sql<{
          readonly uuid: string
          readonly name: string
          readonly ts: Date
          readonly properties: Record<string, unknown>
          readonly matchesFilters: boolean
        }>`
          SELECT uuid, name, ts, properties, ${matchesFilters(sql, filters)} AS matches_filters FROM event
          WHERE environment_id = ${environment.id} AND session_id = ${sessionId}
          ORDER BY ts, received_at
          LIMIT ${SESSION_EVENT_LIMIT}`
        return {
          ...toSummary(row, now),
          referrer: row.referringDomain === null ? null : row.referrer,
          utmSource: row.utmSource,
          utmMedium: row.utmMedium,
          utmCampaign: row.utmCampaign,
          browser: row.browser,
          os: row.os,
          visitorId,
          visitorIdentified,
          timeline: events.map((e) => ({
            id: e.uuid,
            name: e.name,
            timestamp: DateTime.fromDateUnsafe(e.ts),
            properties: e.properties,
            matchesFilters: e.matchesFilters
          })),
          truncated: row.events > events.length
        }
      }))

    return Queries.of({
      overview,
      top,
      liveVisitors,
      pageviewCount,
      breakdown,
      eventPropertyKeys,
      customEvents,
      customEvent,
      customEventBreakdown,
      customEventStats,
      sessions,
      session
    })
  }))
}

/** A report after the access check: the Environment, its resolved local range and the filters. */
interface ReportScope {
  readonly environmentId: EnvironmentId
  readonly range: ReportRange
  readonly filters: EventPropertyFilters | undefined
}

/**
 * The UTM reports read `$utm_source` and friends, which Enrichment derives from the Pageview's
 * URL, or else a plain `utm_source` Event property sent by an app.
 */
const UTM_TAGS = { utmSources: "utm_source", utmMediums: "utm_medium", utmCampaigns: "utm_campaign" } as const

const AUDIENCE = { countries: "$country", browsers: "$browser", oses: "$os", devices: "$device" } as const

/** The live counter's window. */
const LIVE_MINUTES = 30

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

const emptyStats: NumericStats = { count: 0, average: null, sum: null, min: null, max: null, median: null }

/** A Session's summary row, as `sessionSummary` selects it. */
interface SessionRow {
  readonly id: string
  readonly startedAt: Date
  readonly lastSeenAt: Date
  readonly events: number
  readonly duration: number
  readonly country: string | null
  readonly device: string | null
  readonly browser: string | null
  readonly os: string | null
  readonly visitorId: string | null
  readonly entryPage: string | null
  readonly referringDomain: string | null
  readonly referrer: string | null
  readonly utmSource: string | null
  readonly utmMedium: string | null
  readonly utmCampaign: string | null
}

/** Under this many minutes since the last Event, the Visitor counts as active. */
const ACTIVE_MINUTES = 5

const sessionStatus = (lastSeenAt: Date, now: DateTime.Utc): SessionStatus => {
  const minutes = (DateTime.toEpochMillis(now) - lastSeenAt.getTime()) / 60_000
  return minutes < ACTIVE_MINUTES ? "active" : minutes <= SESSION_TIMEOUT_MINUTES ? "idle" : "ended"
}

const toSummary = (row: SessionRow, now: DateTime.Utc): SessionSummary => ({
  id: row.id,
  startedAt: DateTime.fromDateUnsafe(row.startedAt),
  lastSeenAt: DateTime.fromDateUnsafe(row.lastSeenAt),
  duration: row.duration,
  events: row.events,
  bounce: row.events === 1,
  entryPage: row.entryPage,
  referringDomain: row.referringDomain,
  country: row.country,
  device: row.device,
  status: sessionStatus(row.lastSeenAt, now)
})

/** A Recent sessions cursor (`SESSIONS_CURSOR`): the last row's activity time and ID, so the next page starts after it. */
const formatCursor = (row: SessionRow) => `${row.lastSeenAt.toISOString()}_${row.id}`

/** The schema has checked the cursor's shape. */
const parseCursor = (cursor: string) => {
  const i = cursor.indexOf("_")
  return { lastSeenAt: new Date(cursor.slice(0, i)), id: cursor.slice(i + 1) }
}
