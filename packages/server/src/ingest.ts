// Ingest: a batch of raw Events for one Environment -> stored Events.
// Pipeline, one step each: key -> Environment, origin check, bot filter, per-Event
// validation and limits, Event time, then an idempotent insert by Event UUID.
import { PgClient } from "@effect/sql-pg"
import { type IngestBatch, type IngestEvent, type IngestRejection, type IngestResult, OriginNotAllowed, UnknownKey } from "@flock/shared"
import { Array as Arr, Context, DateTime, Effect, Layer, Result } from "effect"
import { EventPartitions } from "./event-partitions.ts"
import { eventTime, isBot, originAllowed, rawUuid, validateEvent } from "./ingest-rules.ts"

/** What Ingest knows about the HTTP request a batch came in. */
export interface IngestRequest {
  /** The `Origin` header; browsers send it, servers and native apps usually don't. */
  readonly origin?: string | undefined
  readonly userAgent?: string | undefined
}

interface ValidEvent {
  readonly event: IngestEvent
  readonly ts: DateTime.Utc
}

export class Ingest extends Context.Service<Ingest, {
  readonly send: (batch: IngestBatch, request: IngestRequest) => Effect.Effect<IngestResult, UnknownKey | OriginNotAllowed>
}>()("flock/Ingest") {
  static readonly layer = Layer.effect(
    Ingest,
    Effect.gen(function*() {
      const sql = yield* PgClient.PgClient
      const partitions = yield* EventPartitions

      const environmentByKey = (key: string) =>
        sql<{ id: string; allowedOrigins: ReadonlyArray<string> }>`
          SELECT id, allowed_origins FROM environment WHERE key = ${key}`.pipe(
          Effect.flatMap(([environment]) =>
            environment ? Effect.succeed(environment) : Effect.fail(new UnknownKey({ message: "No Environment has this key" }))
          )
        )

      /** Splits the batch into valid Events (with their time) and rejections. */
      const validate = (events: ReadonlyArray<unknown>, receivedAt: DateTime.Utc) => {
        const valid: Array<ValidEvent> = []
        const rejected: Array<IngestRejection> = []
        events.forEach((raw, index) => {
          const result = validateEvent(raw)
          if (Result.isSuccess(result)) valid.push({ event: result.success, ts: eventTime(result.success.timestamp, receivedAt) })
          else rejected.push({ index, uuid: rawUuid(raw), reason: result.failure })
        })
        return { valid, rejected }
      }

      /**
       * Stores Events whose UUID is new to the Environment; returns how many distinct Events it got. The event table is partitioned
       * by day, so uniqueness lives in event_uuid, written in the same transaction (ADR 0003).
       */
      const insertNew = (environmentId: string, events: ReadonlyArray<ValidEvent>, receivedAt: DateTime.Utc) =>
        Effect.gen(function*() {
          const byUuid = new Map(events.map((e) => [e.event.uuid.toLowerCase(), e] as const))
          const rows = Arr.map(Arr.fromIterable(byUuid.keys()), (uuid) => ({ environmentId, uuid }))
          if (!Arr.isArrayNonEmpty(rows)) return 0
          for (const { ts } of byUuid.values()) yield* partitions.ensureDay(ts)
          yield* sql.withTransaction(Effect.gen(function*() {
            const fresh = yield* sql<{ uuid: string }>`
              INSERT INTO event_uuid ${sql.insert(rows)}
              ON CONFLICT DO NOTHING RETURNING uuid`
            const events = fresh.map(({ uuid }) => {
              const { event, ts } = byUuid.get(uuid)!
              return {
                environmentId,
                uuid,
                name: event.name,
                ts: DateTime.toDateUtc(ts),
                receivedAt: DateTime.toDateUtc(receivedAt),
                properties: sql.json(event.properties ?? {})
              }
            })
            if (Arr.isArrayNonEmpty(events)) yield* sql`INSERT INTO event ${sql.insert(events)}`
          }))
          return rows.length
        })

      const send = Effect.fn("Ingest.send")(function*(batch: IngestBatch, request: IngestRequest) {
        const environment = yield* environmentByKey(batch.key)
        if (!originAllowed(request.origin, environment.allowedOrigins)) {
          return yield* new OriginNotAllowed({
            message: `This Environment doesn't accept Events from ${request.origin}. Add it to the Environment's allowed origins.`
          })
        }
        // Bots are dropped silently: nothing stored, nothing to learn from the response.
        if (isBot(request.userAgent)) return { accepted: 0, rejected: [] }

        const receivedAt = yield* DateTime.now
        const { rejected, valid } = validate(batch.events, receivedAt)
        // A repeated UUID is ignored but still reported as accepted, so retries look like successes.
        const accepted = yield* insertNew(environment.id, valid, receivedAt)
        return { accepted, rejected }
      }, (effect) => Effect.catchTag(effect, "SqlError", Effect.die))

      return Ingest.of({ send })
    })
  )
}
