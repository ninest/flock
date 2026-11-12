// Ingest: a batch of raw Events for one Environment -> stored Events.
import { PgClient } from "@effect/sql-pg"
import { type IngestBatch, type IngestResult, UnknownKey } from "@flock/shared"
import { Array as Arr, Context, DateTime, Effect, Layer } from "effect"
import { Enrichment, type RequestContext } from "./enrichment.ts"
import { EventPartitions } from "./event-partitions.ts"

export class Ingest extends Context.Service<Ingest, {
  readonly send: (batch: IngestBatch, request: RequestContext) => Effect.Effect<IngestResult, UnknownKey>
}>()("flock/Ingest") {
  static readonly layer = Layer.effect(
    Ingest,
    Effect.gen(function*() {
      const sql = yield* PgClient.PgClient
      const partitions = yield* EventPartitions
      const enrichment = yield* Enrichment

      const send = Effect.fn("Ingest.send")(function*(batch: IngestBatch, request: RequestContext) {
        const [environment] = yield* sql<{ id: string }>`SELECT id FROM environment WHERE key = ${batch.key}`
        if (!environment) return yield* new UnknownKey({ message: "No Environment has this key" })

        const receivedAt = yield* DateTime.now
        const ts = DateTime.toDateUtc(receivedAt)
        yield* partitions.ensureDay(receivedAt)
        const audience = yield* enrichment.audience(request)
        const rows = batch.events.map((event) => ({
          environmentId: environment.id,
          uuid: event.uuid,
          name: event.name,
          ts,
          receivedAt: ts,
          properties: sql.json(enrichment.enrich(event.properties ?? {}, audience))
        }))
        if (!Arr.isArrayNonEmpty(rows)) return { accepted: 0, rejected: [] }
        const inserted = yield* sql`INSERT INTO event ${sql.insert(rows)} RETURNING 1`
        return { accepted: inserted.length, rejected: [] }
      }, (effect) => Effect.catchTag(effect, "SqlError", Effect.die))

      return Ingest.of({ send })
    })
  )
}
