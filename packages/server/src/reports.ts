// Reports: (Member, Environment, date range) -> dashboard numbers. The dashboard never touches SQL.
import { PgClient } from "@effect/sql-pg"
import type { BreakdownRow, EnvironmentId, EnvironmentNotFound, MemberId } from "@flock/shared"
import { Context, DateTime, Effect, Layer } from "effect"
import { Projects } from "./projects.ts"

export interface DateRange {
  readonly from: DateTime.Utc
  readonly to: DateTime.Utc
}

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
    by: { readonly property: string; readonly event: string }
  ) => Effect.Effect<ReadonlyArray<BreakdownRow>, EnvironmentNotFound>
  /** Every Event property key seen in the range, sorted. */
  readonly propertyKeys: (
    member: MemberId,
    environmentId: EnvironmentId,
    range: DateRange
  ) => Effect.Effect<ReadonlyArray<string>, EnvironmentNotFound>
}>()("flock/Reports") {
  static readonly layer = Layer.effect(
    Reports,
    Effect.gen(function*() {
      const sql = yield* PgClient.PgClient

      const projects = yield* Projects

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
        by: { readonly property: string; readonly event: string }
      ) {
        yield* projects.environment(member, environmentId)
        return yield* sql<BreakdownRow>`
          SELECT properties ->> ${by.property} AS value, count(*)::int AS count FROM event
          WHERE environment_id = ${environmentId} AND name = ${by.event}
            AND ts >= ${DateTime.toDateUtc(range.from)} AND ts < ${DateTime.toDateUtc(range.to)}
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

      return Reports.of({ pageviewCount, breakdown, propertyKeys })
    })
  )
}
