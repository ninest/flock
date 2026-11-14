// Visitor identity, per Tracking mode (ADR 0002).
// Cookieless: the Visitor is a hash of the IP, user agent and Project with a salt that rotates
// every UTC day, so the same device is a new Visitor each day and the hash can't be reversed
// once the salt is deleted.
// Persistent: the Visitor is the ID the client sends (`distinct_id`): the random device ID the
// browser script stores, or, after Identify, the tracked app's own ID for that person.
import { PgClient } from "@effect/sql-pg"
import { Context, DateTime, Effect, Layer } from "effect"
import type { SqlError } from "effect/sql/SqlError"
import { createHash, randomBytes } from "node:crypto"

/** A Visitor ID, unique within a Project. */
export type VisitorId = string

export interface CookielessVisitorInput {
  readonly projectId: string
  readonly ip: string
  readonly userAgent: string
  /** When the Event was received; picks the day's salt. */
  readonly at: DateTime.Utc
}

export interface IdentifyInput {
  readonly projectId: string
  /** The device's own persistent Visitor ID. */
  readonly deviceId: VisitorId
  /** The tracked app's ID for the person, which becomes the Visitor ID. */
  readonly visitorId: VisitorId
}

const utcDay = (at: DateTime.Utc) => DateTime.formatIso(at).slice(0, 10)

export class Visitors extends Context.Service<Visitors, {
  readonly cookieless: (input: CookielessVisitorInput) => Effect.Effect<VisitorId, SqlError>
  /** The Visitor for a client-sent persistent ID: the identified Visitor if the ID is an identified device's. */
  readonly persistent: (input: { readonly projectId: string; readonly distinctId: string }) => Effect.Effect<VisitorId, SqlError>
  /**
   * Links a device to an identified Visitor: from now on its Events count as that Visitor, and its
   * earlier Events and Sessions in the Project move over to it. A device that already identified
   * as someone else switches to the new ID (the person signed in as another account). An ID that
   * was ever identified stays an identified Visitor, also once no device is linked to it, and is
   * never linked to another, so two identified Visitors are never merged.
   * Run it inside the ingest transaction.
   */
  readonly identify: (input: IdentifyInput) => Effect.Effect<void, SqlError>
}>()("flock/Visitors") {
  static readonly layer = Layer.effect(
    Visitors,
    Effect.gen(function*() {
      const sql = yield* PgClient.PgClient
      const salts = new Map<string, string>()

      /** The salt for a UTC day, shared by every server; creating it deletes earlier days' salts. */
      const saltFor = (day: string) => {
        const cached = salts.get(day)
        if (cached !== undefined) return Effect.succeed(cached)
        return Effect.gen(function*() {
          const created = yield* sql`
            INSERT INTO visitor_salt (day, salt) VALUES (${day}::date, ${randomBytes(32).toString("base64")})
            ON CONFLICT (day) DO NOTHING RETURNING 1`
          if (created.length > 0) yield* sql`DELETE FROM visitor_salt WHERE day < ${day}::date`
          const [row] = yield* sql<{ salt: string }>`SELECT salt FROM visitor_salt WHERE day = ${day}::date`
          // Only a clock jumping back to an already-deleted day lands here.
          const salt = row?.salt ?? randomBytes(32).toString("base64")
          salts.clear() // keep one day in memory
          salts.set(day, salt)
          return salt
        })
      }

      const cookieless = Effect.fn("Visitors.cookieless")(function*(input: CookielessVisitorInput) {
        const salt = yield* saltFor(utcDay(input.at))
        return createHash("sha256")
          .update([salt, input.projectId, input.ip, input.userAgent].join("\0"))
          .digest("base64url")
          .slice(0, 22)
      })

      const persistent = Effect.fn("Visitors.persistent")(function*(input: { readonly projectId: string; readonly distinctId: string }) {
        const [alias] = yield* sql<{ visitorId: string }>`
          SELECT visitor_id FROM visitor_alias WHERE project_id = ${input.projectId} AND device_id = ${input.distinctId}`
        return alias?.visitorId ?? input.distinctId
      })

      const identify = Effect.fn("Visitors.identify")(function*({ deviceId, projectId, visitorId }: IdentifyInput) {
        if (deviceId === visitorId) return
        // Recorded for good: the ID stays identified when its devices later switch to another one.
        yield* sql`
          INSERT INTO identified_visitor ${sql.insert({ projectId, visitorId })}
          ON CONFLICT (project_id, visitor_id) DO NOTHING`
        const [identified] = yield* sql`
          SELECT 1 FROM identified_visitor WHERE project_id = ${projectId} AND visitor_id = ${deviceId}`
        if (identified) return
        yield* sql`
          INSERT INTO visitor_alias ${sql.insert({ projectId, deviceId, visitorId })}
          ON CONFLICT (project_id, device_id) DO UPDATE SET visitor_id = excluded.visitor_id`
        const environments = sql`SELECT id FROM environment WHERE project_id = ${projectId}`
        yield* sql`UPDATE event SET visitor_id = ${visitorId} WHERE environment_id IN (${environments}) AND visitor_id = ${deviceId}`
        yield* sql`UPDATE session SET visitor_id = ${visitorId} WHERE environment_id IN (${environments}) AND visitor_id = ${deviceId}`
      })

      return Visitors.of({ cookieless, persistent, identify })
    })
  )
}
