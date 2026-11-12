// Ingest: a batch of raw Events for one Environment, plus who sent it -> stored Events.
// Each Event goes through a pipeline of steps (enrichment, Visitor derivation, Session assignment,
// then insert); add new steps as their own services rather than growing this one.
import { PgClient } from "@effect/sql-pg"
import { type IngestBatch, type IngestResult, UnknownKey } from "@flock/shared"
import { Array as Arr, Context, DateTime, Effect, Layer } from "effect"
import { Enrichment, type RequestContext } from "./enrichment.ts"
import { EventPartitions } from "./event-partitions.ts"
import { Sessions } from "./sessions.ts"
import { Visitors } from "./visitors.ts"

export class Ingest extends Context.Service<Ingest, {
  readonly send: (batch: IngestBatch, request: RequestContext) => Effect.Effect<IngestResult, UnknownKey>
}>()("flock/Ingest") {
  static readonly layer = Layer.effect(
    Ingest,
    Effect.gen(function*() {
      const sql = yield* PgClient.PgClient
      const partitions = yield* EventPartitions
      const enrichment = yield* Enrichment
      const visitors = yield* Visitors
      const sessions = yield* Sessions

      const send = Effect.fn("Ingest.send")(function*(batch: IngestBatch, request: RequestContext) {
        const [environment] = yield* sql<{ id: string; projectId: string }>`
          SELECT id, project_id FROM environment WHERE key = ${batch.key}`
        if (!environment) return yield* new UnknownKey({ message: "No Environment has this key" })

        const receivedAt = yield* DateTime.now
        const ts = DateTime.toDateUtc(receivedAt)
        yield* partitions.ensureDay(receivedAt)

        // Step 1: enrichment (audience properties are shared by the batch).
        const audience = yield* enrichment.audience(request)

        // Step 2: Visitor derivation (outside the transaction: it may create the day's salt).
        const withVisitors = yield* Effect.forEach(batch.events, (event) =>
          visitors.cookieless({ projectId: environment.projectId, ip: request.ip ?? "", userAgent: request.userAgent ?? "", at: receivedAt })
            .pipe(Effect.map((visitorId) => ({ event, visitorId }))))

        // Step 3: Session assignment and the insert, in one transaction.
        return yield* sql.withTransaction(Effect.gen(function*() {
          const rows = yield* Effect.forEach(withVisitors, ({ event, visitorId }) =>
            sessions.assign({ environmentId: environment.id, visitorId, at: receivedAt }).pipe(
              Effect.map((sessionId) => ({
                environmentId: environment.id,
                uuid: event.uuid,
                name: event.name,
                ts,
                receivedAt: ts,
                visitorId,
                sessionId,
                properties: sql.json(enrichment.enrich(event.properties ?? {}, audience))
              }))
            ))
          if (!Arr.isArrayNonEmpty(rows)) return { accepted: 0, rejected: [] }
          const inserted = yield* sql`INSERT INTO event ${sql.insert(rows)} RETURNING 1`
          return { accepted: inserted.length, rejected: [] }
        }))
      }, (effect) => Effect.catchTag(effect, "SqlError", Effect.die))

      return Ingest.of({ send })
    })
  )
}
