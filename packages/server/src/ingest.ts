// Ingest: a batch of raw Events for one Environment, plus who sent it -> stored Events.
// Pipeline, one step each: key -> Environment, origin check, bot filter, per-Event
// validation and limits, Event time, enrichment, Visitor derivation, then (in one
// transaction) dedupe by Event UUID, Session assignment and the insert. The rules are
// pure functions in ingest-rules.ts; add new steps as their own services rather than
// growing this one.
import { PgClient } from "@effect/sql-pg"
import { type IngestBatch, type IngestEvent, type IngestRejection, type IngestResult, OriginNotAllowed, type TrackingMode, UnknownKey } from "@flock/shared"
import { Array as Arr, Context, DateTime, Effect, Layer, Result } from "effect"
import type { SqlError } from "effect/sql/SqlError"
import { Enrichment, type RequestContext } from "./enrichment.ts"
import { EventPartitions } from "./event-partitions.ts"
import { ANON_DISTINCT_ID, displayNameOf, eventTime, IDENTIFY, isBot, originAllowed, rawUuid, validateEvent } from "./ingest-rules.ts"
import { Sessions } from "./sessions.ts"
import { type VisitorId, Visitors } from "./visitors.ts"

interface ValidEvent {
  readonly event: IngestEvent
  /** The Event time: the client timestamp if recent enough, else the receive time. */
  readonly ts: DateTime.Utc
}

export class Ingest extends Context.Service<Ingest, {
  readonly send: (batch: IngestBatch, request: RequestContext) => Effect.Effect<IngestResult, UnknownKey | OriginNotAllowed>
  /**
   * Deletes every Event in these Environments, with their UUIDs (so the same Events can be sent
   * again) and Sessions. Joins the caller's transaction, if any.
   */
  readonly deleteEvents: (environmentIds: ReadonlyArray<string>) => Effect.Effect<void, SqlError>
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

      const environmentByKey = (key: string) =>
        sql<{ id: string; projectId: string; allowedOrigins: ReadonlyArray<string>; trackingMode: TrackingMode }>`
          SELECT e.id, e.project_id, e.allowed_origins, p.tracking_mode
          FROM environment e JOIN project p ON p.id = e.project_id
          WHERE e.key = ${key}`.pipe(
          Effect.flatMap(([environment]) =>
            environment ? Effect.succeed(environment) : Effect.fail(new UnknownKey({ message: "No Environment has this key" }))
          )
        )

      const config = (key: string) =>
        environmentByKey(key).pipe(
          Effect.map(({ trackingMode }) => ({ trackingMode })),
          Effect.catchTag("SqlError", Effect.die)
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
       * In persistent Tracking mode, the batch's new Identify Events are applied first, so every
       * Event in it (and the device's earlier ones) counts as the identified Visitor.
       */
      const insertNew = (input: {
        readonly environmentId: string
        readonly events: ReadonlyArray<ValidEvent>
        readonly receivedAt: DateTime.Utc
        readonly audience: Readonly<Record<string, unknown>>
        /** Persistent Tracking mode: the Project whose Identify links and persistent Visitor IDs apply. */
        readonly persistentProjectId: string | undefined
        /** The cookieless Visitor, for Events not attributed to a persistent Visitor ID. */
        readonly cookielessVisitorId: VisitorId
      }) =>
        Effect.gen(function*() {
          const { audience, cookielessVisitorId, environmentId, persistentProjectId: projectId, receivedAt } = input
          const visitorOf = (event: IngestEvent) =>
            projectId !== undefined && event.distinct_id !== undefined
              ? visitors.persistent({ projectId, distinctId: event.distinct_id })
              : Effect.succeed(cookielessVisitorId)
          const byUuid = new Map(input.events.map((e) => [e.event.uuid.toLowerCase(), e] as const))
          const uuids = Arr.map(Arr.fromIterable(byUuid.keys()), (uuid) => ({ environmentId, uuid }))
          if (!Arr.isArrayNonEmpty(uuids)) return 0
          for (const { ts } of byUuid.values()) yield* partitions.ensureDay(ts)
          yield* sql.withTransaction(Effect.gen(function*() {
            const fresh = yield* sql<{ uuid: string }>`
              INSERT INTO event_uuid ${sql.insert(uuids)}
              ON CONFLICT DO NOTHING RETURNING uuid`
            const events = fresh.map(({ uuid }) => ({ uuid, ...byUuid.get(uuid)! }))
            if (projectId !== undefined) {
              for (const { event, ts } of events) {
                if (event.name !== IDENTIFY) continue
                const deviceId = event.properties![ANON_DISTINCT_ID] as string // checked by validateEvent
                yield* visitors.identify({ projectId, deviceId, visitorId: event.distinct_id!, displayName: displayNameOf(event), at: ts })
              }
            }
            // A late Event can join Sessions into one (see Sessions.assign): their stored Events
            // move to it here, and `joinedInto` does the same for this batch's rows below.
            const joinedInto = new Map<string, string>()
            const assigned = yield* Effect.forEach(events, ({ event, ts, uuid }) => Effect.gen(function*() {
              const visitorId = yield* visitorOf(event)
              const { absorbed, sessionId } = yield* sessions.assign({ environmentId, visitorId, at: ts })
              if (absorbed.length > 0) {
                for (const id of absorbed) joinedInto.set(id, sessionId)
                yield* sql`
                  UPDATE event SET session_id = ${sessionId}
                  WHERE environment_id = ${environmentId} AND session_id IN ${sql.in(absorbed)}`
              }
              return {
                environmentId,
                uuid,
                name: event.name,
                ts: DateTime.toDateUtc(ts),
                receivedAt: DateTime.toDateUtc(receivedAt),
                visitorId,
                sessionId,
                properties: sql.json(enrichment.enrich(event.properties ?? {}, audience))
              }
            }))
            /** The Session that `sessionId` is part of by the end of the batch, following every join after it was assigned. */
            const survivingSession = (sessionId: string): string => {
              const joined = joinedInto.get(sessionId)
              return joined === undefined ? sessionId : survivingSession(joined)
            }
            const rows = assigned.map((row) => ({ ...row, sessionId: survivingSession(row.sessionId) }))
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
        // Visitor derivation (ADR 0002). Persistent Tracking mode trusts the client's `distinct_id`
        // (resolved inside the transaction); cookieless mode ignores it. The cookieless Visitor is
        // derived outside the transaction: it may create the day's salt.
        const persistent = environment.trackingMode === "persistent"
        const needsCookieless = !persistent || valid.some(({ event }) => event.distinct_id === undefined)
        const cookielessVisitorId = needsCookieless
          ? yield* visitors.cookieless({
            projectId: environment.projectId,
            ip: request.ip ?? "",
            userAgent: request.userAgent ?? "",
            at: receivedAt
          })
          : ""
        // A repeated UUID is ignored but still reported as accepted, so retries look like successes.
        const accepted = yield* insertNew({
          environmentId: environment.id,
          events: valid,
          receivedAt,
          audience,
          persistentProjectId: persistent ? environment.projectId : undefined,
          cookielessVisitorId
        })
        return { accepted, rejected }
      }, (effect) => Effect.catchTag(effect, "SqlError", Effect.die))

      const deleteEvents = (environmentIds: ReadonlyArray<string>) =>
        environmentIds.length === 0 ? Effect.void : Effect.all([
          sql`DELETE FROM event WHERE environment_id IN ${sql.in(environmentIds)}`,
          sql`DELETE FROM event_uuid WHERE environment_id IN ${sql.in(environmentIds)}`,
          sessions.deleteAll(environmentIds)
        ], { discard: true })

      return Ingest.of({ send, config, deleteEvents })
    })
  )
}
