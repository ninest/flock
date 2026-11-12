// Ingest: a batch of raw Events for one Environment, plus who sent it -> stored Events.
// Pipeline, one step each: key -> Environment, origin check, bot filter, per-Event
// validation and limits, Event time, enrichment, Visitor derivation, then (in one
// transaction) dedupe by Event UUID, Session assignment and the insert. The rules are
// pure functions in ingest-rules.ts; add new steps as their own services rather than
// growing this one.
import { PgClient } from "@effect/sql-pg"
import { type IngestBatch, type IngestEvent, type IngestRejection, type IngestResult, OriginNotAllowed, UnknownKey } from "@flock/shared"
import { Array as Arr, Context, DateTime, Effect, Layer, Result } from "effect"
import { Enrichment, type RequestContext } from "./enrichment.ts"
import { EventPartitions } from "./event-partitions.ts"
import { eventTime, isBot, originAllowed, rawUuid, validateEvent } from "./ingest-rules.ts"
import { Sessions } from "./sessions.ts"
import { type VisitorId, Visitors } from "./visitors.ts"

interface ValidEvent {
  readonly event: IngestEvent
  /** The Event time: the client timestamp if recent enough, else the receive time. */
  readonly ts: DateTime.Utc
}

export class Ingest extends Context.Service<Ingest, {
  readonly send: (batch: IngestBatch, request: RequestContext) => Effect.Effect<IngestResult, UnknownKey | OriginNotAllowed>
}>()("flock/Ingest") {
  static readonly layer = Layer.effect(
    Ingest,
    Effect.gen(function*() {
      const sql = yield* PgClient.PgClient
      const partitions = yield* EventPartitions
      const enrichment = yield* Enrichment
      const visitors = yield* Visitors
      const sessions = yield* Sessions

      const environmentByKey = (key: string) =>
        sql<{ id: string; projectId: string; allowedOrigins: ReadonlyArray<string> }>`
          SELECT id, project_id, allowed_origins FROM environment WHERE key = ${key}`.pipe(
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
       * Stores Events whose UUID is new to the Environment; returns how many distinct Events
       * it got. The event table is partitioned by day, so uniqueness lives in event_uuid,
       * written in the same transaction (ADR 0004). Repeated Events never reach Sessions.
       */
      const insertNew = (input: {
        readonly environmentId: string
        readonly events: ReadonlyArray<ValidEvent>
        readonly receivedAt: DateTime.Utc
        readonly audience: Readonly<Record<string, unknown>>
        readonly visitorId: VisitorId
      }) =>
        Effect.gen(function*() {
          const { audience, environmentId, receivedAt, visitorId } = input
          const byUuid = new Map(input.events.map((e) => [e.event.uuid.toLowerCase(), e] as const))
          const uuids = Arr.map(Arr.fromIterable(byUuid.keys()), (uuid) => ({ environmentId, uuid }))
          if (!Arr.isArrayNonEmpty(uuids)) return 0
          for (const { ts } of byUuid.values()) yield* partitions.ensureDay(ts)
          yield* sql.withTransaction(Effect.gen(function*() {
            const fresh = yield* sql<{ uuid: string }>`
              INSERT INTO event_uuid ${sql.insert(uuids)}
              ON CONFLICT DO NOTHING RETURNING uuid`
            const rows = yield* Effect.forEach(fresh, ({ uuid }) => {
              const { event, ts } = byUuid.get(uuid)!
              return sessions.assign({ environmentId, visitorId, at: ts }).pipe(
                Effect.map((sessionId) => ({
                  environmentId,
                  uuid,
                  name: event.name,
                  ts: DateTime.toDateUtc(ts),
                  receivedAt: DateTime.toDateUtc(receivedAt),
                  visitorId,
                  sessionId,
                  properties: sql.json(enrichment.enrich(event.properties ?? {}, audience))
                }))
              )
            })
            if (Arr.isArrayNonEmpty(rows)) yield* sql`INSERT INTO event ${sql.insert(rows)}`
          }))
          return uuids.length
        })

      const send = Effect.fn("Ingest.send")(function*(batch: IngestBatch, request: RequestContext) {
        const environment = yield* environmentByKey(batch.key)
        if (!originAllowed(request.origin ?? undefined, environment.allowedOrigins)) {
          return yield* new OriginNotAllowed({
            message: `This Environment doesn't accept Events from ${request.origin}. Add it to the Environment's allowed origins.`
          })
        }
        // Bots are dropped silently: nothing stored, nothing to learn from the response.
        if (isBot(request.userAgent ?? undefined)) return { accepted: 0, rejected: [] }

        const receivedAt = yield* DateTime.now
        const { rejected, valid } = validate(batch.events, receivedAt)
        if (valid.length === 0) return { accepted: 0, rejected }

        // Enrichment: audience properties are shared by the batch.
        const audience = yield* enrichment.audience(request)
        // Visitor derivation, outside the transaction: it may create the day's salt.
        const visitorId = yield* visitors.cookieless({
          projectId: environment.projectId,
          ip: request.ip ?? "",
          userAgent: request.userAgent ?? "",
          at: receivedAt
        })
        // A repeated UUID is ignored but still reported as accepted, so retries look like successes.
        const accepted = yield* insertNew({ environmentId: environment.id, events: valid, receivedAt, audience, visitorId })
        return { accepted, rejected }
      }, (effect) => Effect.catchTag(effect, "SqlError", Effect.die))

      return Ingest.of({ send })
    })
  )
}
