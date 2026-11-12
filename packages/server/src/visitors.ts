// Visitor identity. Cookieless Tracking mode (ADR 0002): the Visitor is a hash of the
// IP, user agent and Project with a salt that rotates every UTC day, so the same device
// is a new Visitor each day and the hash can't be reversed once the salt is deleted.
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

const utcDay = (at: DateTime.Utc) => DateTime.formatIso(at).slice(0, 10)

export class Visitors extends Context.Service<Visitors, {
  readonly cookieless: (input: CookielessVisitorInput) => Effect.Effect<VisitorId, SqlError>
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

      return Visitors.of({ cookieless })
    })
  )
}
