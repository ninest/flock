// Reports: (Member, Environment, date range) -> dashboard numbers. The dashboard never touches SQL.
import { PgClient } from "@effect/sql-pg"
import type { EnvironmentId, EnvironmentNotFound, MemberId } from "@flock/shared"
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

      return Reports.of({ pageviewCount })
    })
  )
}
