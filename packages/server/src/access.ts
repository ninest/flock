// Access: who may become a Member, who is an Instance admin, and the
// FLOCK_ADMIN_EMAIL bootstrap. Open sign-up and Invites will extend `canSignUp`.
import { PgClient } from "@effect/sql-pg"
import { Member, MemberId } from "@flock/shared"
import { Context, Effect, Layer, Option, type Redacted } from "effect"
import type { SqlError } from "effect/sql/SqlError"

export interface AuthSettings {
  /**
   * The origin Members open the dashboard on, e.g. https://flock.example.com.
   * When unset, each request's own origin is used.
   */
  readonly publicUrl: Option.Option<string>
  /** More origins allowed to call the auth API (e.g. the dev dashboard). */
  readonly trustedOrigins: ReadonlyArray<string>
  /** Signs session cookies; at least 32 random characters. Generated and kept in Postgres when unset. */
  readonly secret: Option.Option<Redacted.Redacted<string>>
  /** Signing up or signing in with this email makes the Member an Instance admin. */
  readonly adminEmail: Option.Option<string>
}

export class AuthConfig extends Context.Service<AuthConfig, AuthSettings>()("flock/AuthConfig") {}

export type SignUpVerdict = { readonly ok: true } | { readonly ok: false; readonly code: string; readonly message: string }

const sameEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

export class Access extends Context.Service<Access, {
  /** Whether a new login may be created for this email. */
  readonly canSignUp: (email: string) => Effect.Effect<SignUpVerdict>
  /** Called whenever a Member signs in (including right after sign-up). */
  readonly signedIn: (memberId: MemberId) => Effect.Effect<void, SqlError>
  readonly member: (memberId: MemberId) => Effect.Effect<Option.Option<Member>, SqlError>
  readonly memberByEmail: (email: string) => Effect.Effect<Option.Option<Member>, SqlError>
  readonly grantAdmin: (memberId: MemberId) => Effect.Effect<void, SqlError>
  /** The session-signing secret generated on first boot, for Instances without BETTER_AUTH_SECRET. */
  readonly generatedSecret: Effect.Effect<string, SqlError>
}>()("flock/Access") {
  static readonly layer = Layer.effect(
    Access,
    Effect.gen(function*() {
      const sql = yield* PgClient.PgClient
      const { adminEmail } = yield* AuthConfig
      const isAdminEmail = (email: string) => Option.exists(adminEmail, (admin) => sameEmail(admin, email))

      const select = (where: ReturnType<typeof sql.and>) =>
        sql<{ id: string; email: string; name: string; isAdmin: boolean }>`
          SELECT m.id, m.email, m.name, a.member_id IS NOT NULL AS is_admin
          FROM member m LEFT JOIN instance_admin a ON a.member_id = m.id
          WHERE ${where}`.pipe(
          Effect.map((rows) => Option.fromNullishOr(rows[0]).pipe(Option.map((row) => new Member({ ...row, id: MemberId.make(row.id) }))))
        )

      const member = (memberId: MemberId) => select(sql.and([sql`m.id = ${memberId}`]))
      const grantAdmin = (memberId: MemberId) =>
        sql`INSERT INTO instance_admin (member_id) VALUES (${memberId}) ON CONFLICT DO NOTHING`.pipe(Effect.asVoid)

      return Access.of({
        canSignUp: (email) =>
          Effect.succeed(
            isAdminEmail(email)
              ? { ok: true }
              : { ok: false, code: "SIGN_UP_CLOSED", message: "Sign-up is closed on this Instance. Ask an Instance admin for an Invite." }
          ),
        signedIn: (memberId) =>
          Effect.gen(function*() {
            const found = yield* member(memberId)
            if (Option.isSome(found) && !found.value.isAdmin && isAdminEmail(found.value.email)) {
              yield* grantAdmin(memberId)
            }
          }),
        member,
        memberByEmail: (email) => select(sql.and([sql`lower(m.email) = ${email.trim().toLowerCase()}`])),
        grantAdmin,
        generatedSecret: Effect.gen(function*() {
          const candidate = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
          yield* sql`INSERT INTO instance_secret (name, value) VALUES ('auth', ${candidate}) ON CONFLICT DO NOTHING`
          const [row] = yield* sql<{ value: string }>`SELECT value FROM instance_secret WHERE name = 'auth'`
          return row!.value
        })
      })
    })
  )
}
