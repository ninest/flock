// Ingest: a batch of raw Events for one Environment, plus who sent it -> stored Events.
// Each Event goes through a pipeline of steps (enrichment, Visitor derivation, Session assignment,
// then insert); add new steps as their own services rather than growing this one.
import { PgClient } from "@effect/sql-pg"
import { type IngestBatch, type IngestEvent, type IngestResult, type TrackingMode, UnknownKey } from "@flock/shared"
import { Array as Arr, Context, DateTime, Effect, Layer } from "effect"
import { Enrichment, type RequestContext } from "./enrichment.ts"
import { EventPartitions } from "./event-partitions.ts"
import { Sessions } from "./sessions.ts"
import { Visitors } from "./visitors.ts"

/** The Built-in event the browser script sends on `identify(id)`, with `$anon_distinct_id` the device's own ID. */
const IDENTIFY = "$identify"

export class Ingest extends Context.Service<Ingest, {
  readonly send: (batch: IngestBatch, request: RequestContext) => Effect.Effect<IngestResult, UnknownKey>
  /** What the browser script needs to know about an Environment key's Project. */
  readonly config: (key: string) => Effect.Effect<{ readonly trackingMode: TrackingMode }, UnknownKey>
}>()("flock/Ingest") {
  static readonly layer = Layer.effect(
    Ingest,
    Effect.gen(function*() {
      const sql = yield* PgClient.PgClient
      const partitions = yield* EventPartitions
      const enrichment = yield* Enrichment
      const visitors = yield* Visitors
      const sessions = yield* Sessions

      const environmentWithKey = Effect.fn("Ingest.environmentWithKey")(function*(key: string) {
        const [environment] = yield* sql<{ id: string; projectId: string; trackingMode: TrackingMode }>`
          SELECT e.id, e.project_id, p.tracking_mode
          FROM environment e JOIN project p ON p.id = e.project_id
          WHERE e.key = ${key}`
        if (!environment) return yield* new UnknownKey({ message: "No Environment has this key" })
        return environment
      })

      const config = (key: string) =>
        environmentWithKey(key).pipe(
          Effect.map(({ trackingMode }) => ({ trackingMode })),
          Effect.catchTag("SqlError", Effect.die)
        )

      const send = Effect.fn("Ingest.send")(function*(batch: IngestBatch, request: RequestContext) {
        const environment = yield* environmentWithKey(batch.key)

        const receivedAt = yield* DateTime.now
        const ts = DateTime.toDateUtc(receivedAt)
        yield* partitions.ensureDay(receivedAt)

        // Step 1: enrichment (audience properties are shared by the batch).
        const audience = yield* enrichment.audience(request)

        // Step 2: Visitor derivation. Cookieless Visitors first, outside the transaction (it may
        // create the day's salt); persistent ones inside it, after the batch's Identify Events.
        const persistentMode = environment.trackingMode === "persistent"
        const cookielessVisitor = visitors.cookieless({
          projectId: environment.projectId,
          ip: request.ip ?? "",
          userAgent: request.userAgent ?? "",
          at: receivedAt
        })
        const needsCookieless = batch.events.some((event) => !persistentMode || event.distinct_id === undefined)
        const cookielessId = needsCookieless ? yield* cookielessVisitor : ""

        const visitorOf = (event: IngestEvent) =>
          persistentMode && event.distinct_id !== undefined
            ? visitors.persistent({ projectId: environment.projectId, distinctId: event.distinct_id })
            : Effect.succeed(cookielessId)

        // Step 3: Session assignment and the insert, in one transaction.
        return yield* sql.withTransaction(Effect.gen(function*() {
          if (persistentMode) {
            for (const event of batch.events) {
              const deviceId = event.properties?.$anon_distinct_id
              if (event.name === IDENTIFY && event.distinct_id !== undefined && typeof deviceId === "string") {
                yield* visitors.identify({ projectId: environment.projectId, deviceId, visitorId: event.distinct_id })
              }
            }
          }
          const withVisitors = yield* Effect.forEach(batch.events, (event) =>
            visitorOf(event).pipe(Effect.map((visitorId) => ({ event, visitorId }))))
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

      return Ingest.of({ send, config })
    })
  )
}
