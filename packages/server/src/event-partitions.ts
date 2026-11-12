// Daily partitions of the `event` table (UTC days).
// A background fiber keeps partitions from yesterday to a week ahead; Ingest also
// calls `ensureDay` before inserting so an Event can never miss its partition.
import { PgClient } from "@effect/sql-pg"
import { Context, DateTime, Duration, Effect, Layer, Schedule } from "effect"
import type { SqlError } from "effect/sql/SqlError"

const DAYS_BEHIND = 1
const DAYS_AHEAD = 7

const dayStart = (dt: DateTime.Utc) => DateTime.startOf(dt, "day")
const partitionName = (day: DateTime.Utc) => `event_p${DateTime.formatIso(day).slice(0, 10).replaceAll("-", "")}`

export class EventPartitions extends Context.Service<EventPartitions, {
  /** Makes sure the partition holding `at` exists. Cheap after the first call per day. */
  readonly ensureDay: (at: DateTime.Utc) => Effect.Effect<void, SqlError>
  /** Makes sure partitions exist from yesterday to DAYS_AHEAD days after `now`. */
  readonly ensureAhead: (now: DateTime.Utc) => Effect.Effect<void, SqlError>
}>()("flock/EventPartitions") {
  static readonly layer = Layer.effect(
    EventPartitions,
    Effect.gen(function*() {
      const sql = yield* PgClient.PgClient
      const known = new Set<string>()

      const create = (day: DateTime.Utc) => {
        const name = partitionName(day)
        const from = DateTime.formatIso(day)
        const to = DateTime.formatIso(DateTime.add(day, { days: 1 }))
        // Identifiers and bounds come from a DateTime, never from input.
        return sql.unsafe(
          `CREATE TABLE IF NOT EXISTS "${name}" PARTITION OF event FOR VALUES FROM ('${from}') TO ('${to}')`
        ).pipe(
          // Two servers creating the same partition at once can race past IF NOT EXISTS.
          Effect.catch((error) =>
            sql<{ exists: boolean }>`SELECT to_regclass(${name}) IS NOT NULL AS exists`.pipe(
              Effect.flatMap(([row]) => (row?.exists ? Effect.void : Effect.fail(error)))
            )
          )
        )
      }

      const ensureDay = (at: DateTime.Utc) => {
        const day = dayStart(at)
        const name = partitionName(day)
        if (known.has(name)) return Effect.void
        return create(day).pipe(Effect.tap(() => Effect.sync(() => known.add(name))))
      }

      const ensureAhead = (now: DateTime.Utc) =>
        Effect.forEach(
          Array.from({ length: DAYS_BEHIND + DAYS_AHEAD + 1 }, (_, i) => DateTime.add(now, { days: i - DAYS_BEHIND })),
          ensureDay,
          { discard: true }
        )

      return EventPartitions.of({ ensureDay, ensureAhead })
    })
  )

  /** Creates partitions ahead of time on boot, then every few hours. */
  static readonly maintenance = Layer.effectDiscard(
    Effect.gen(function*() {
      const partitions = yield* EventPartitions
      const run = DateTime.now.pipe(Effect.flatMap(partitions.ensureAhead))
      yield* run // on boot: fail fast if partitions can't be created
      yield* run.pipe(
        Effect.catchCause((cause) => Effect.logError("Creating Event partitions failed", cause)),
        Effect.repeat(Schedule.spaced(Duration.hours(6))),
        Effect.forkScoped
      )
    })
  )
}
