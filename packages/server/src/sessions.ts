// Sessions: a run of one Visitor's Events with no gap over 30 minutes, assigned on the
// server as Events arrive.
import { PgClient } from "@effect/sql-pg"
import { Array as Arr, Context, DateTime, Effect, Layer } from "effect"
import type { SqlError } from "effect/sql/SqlError"
import { makeId } from "./keys.ts"
import type { VisitorId } from "./visitors.ts"

export const SESSION_TIMEOUT_MINUTES = 30

export interface SessionInput {
  readonly environmentId: string
  readonly visitorId: VisitorId
  /** The Event's timestamp. */
  readonly at: DateTime.Utc
}

export interface SessionAssignment {
  readonly sessionId: string
  /** Sessions this Event joined into `sessionId`; they no longer exist. */
  readonly absorbed: ReadonlyArray<string>
}

export class Sessions extends Context.Service<Sessions, {
  /**
   * The Session an Event at `at` belongs to: the Visitor's Session with activity within
   * 30 minutes of `at` (either side, so a late Event still joins it), or a new one. A late
   * Event within 30 minutes of several Sessions joins them into the earliest, which then
   * spans them all; the others are deleted and returned as `absorbed`, for Ingest to move
   * their Events (stored, or assigned earlier in the same batch) to `sessionId`.
   */
  readonly assign: (input: SessionInput) => Effect.Effect<SessionAssignment, SqlError>
  /** Deletes every Session in these Environments (with their Events, by Ingest). */
  readonly deleteAll: (environmentIds: ReadonlyArray<string>) => Effect.Effect<void, SqlError>
}>()("flock/Sessions") {
  static readonly layer = Layer.effect(
    Sessions,
    Effect.gen(function*() {
      const sql = yield* PgClient.PgClient

      const assign = Effect.fn("Sessions.assign")(function*(input: SessionInput) {
        const at = DateTime.toDateUtc(input.at)
        // One Visitor's Events are assigned one at a time, even across servers.
        yield* sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.environmentId}:${input.visitorId}`}, 0))`
        const [open, ...bridged] = yield* sql<{ id: string }>`
          SELECT id FROM session
          WHERE environment_id = ${input.environmentId} AND visitor_id = ${input.visitorId}
            AND last_seen_at >= ${at}::timestamptz - make_interval(mins => ${SESSION_TIMEOUT_MINUTES})
            AND started_at <= ${at}::timestamptz + make_interval(mins => ${SESSION_TIMEOUT_MINUTES})
          ORDER BY started_at, id`
        if (open) {
          const absorbed = bridged.map((session) => session.id)
          // The Sessions on either side of `at` are disjoint, so the earliest keeps its start.
          const [end] = Arr.isArrayNonEmpty(absorbed)
            ? yield* sql<{ lastSeenAt: Date }>`
              WITH gone AS (DELETE FROM session WHERE id IN ${sql.in(absorbed)} RETURNING last_seen_at)
              SELECT max(last_seen_at) AS last_seen_at FROM gone`
            : []
          yield* sql`
            UPDATE session
            SET started_at = least(started_at, ${at}), last_seen_at = greatest(last_seen_at, ${at}, ${end?.lastSeenAt ?? at})
            WHERE id = ${open.id}`
          return { sessionId: open.id, absorbed }
        }
        const id = makeId("ses")
        yield* sql`INSERT INTO session ${sql.insert({ id, environmentId: input.environmentId, visitorId: input.visitorId, startedAt: at, lastSeenAt: at })}`
        return { sessionId: id, absorbed: [] }
      }, (effect) => sql.withTransaction(effect))

      const deleteAll = (environmentIds: ReadonlyArray<string>) =>
        environmentIds.length === 0
          ? Effect.void
          : sql`DELETE FROM session WHERE environment_id IN ${sql.in(environmentIds)}`.pipe(Effect.asVoid)

      return Sessions.of({ assign, deleteAll })
    })
  )
}
