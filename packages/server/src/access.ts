// Access: who may become a Member (Open sign-up, Invites and the FLOCK_ADMIN_EMAIL
// bootstrap), who is an Instance admin, and removing Members.
import { PgClient } from "@effect/sql-pg"
import { CreatedInvite, type InstanceSettings, Invite, InviteId, Member, MemberId } from "@flock/shared"
import { Context, DateTime, Effect, Layer, Option, type Redacted } from "effect"
import { createHash } from "node:crypto"
import type { SqlError } from "effect/sql/SqlError"
import { makeId } from "./keys.ts"

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

const signUpClosed: SignUpVerdict = {
  ok: false,
  code: "SIGN_UP_CLOSED",
  message: "Sign-up is closed on this Instance. Ask an Instance admin for an Invite."
}
const inviteInvalid: SignUpVerdict = {
  ok: false,
  code: "INVITE_INVALID",
  message: "This Invite has already been used or was revoked. Ask an Instance admin for a new one."
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("base64url")

interface InviteRow {
  readonly id: string
  readonly note: string
  readonly createdAt: Date
  readonly usedAt: Date | null
  readonly usedBy: string | null
}

const toInvite = (row: InviteRow) =>
  new Invite({
    id: InviteId.make(row.id),
    note: row.note,
    createdAt: DateTime.fromDateUnsafe(row.createdAt),
    usedAt: row.usedAt === null ? null : DateTime.fromDateUnsafe(row.usedAt),
    usedBy: row.usedBy
  })

export class Access extends Context.Service<Access, {
  /**
   * Whether a new login may be created for this email: always for FLOCK_ADMIN_EMAIL,
   * for anyone while Open sign-up is on, and otherwise only with an unused Invite
   * token, which this uses up.
   */
  readonly admitSignUp: (input: { readonly email: string; readonly invite: string | undefined }) => Effect.Effect<SignUpVerdict, SqlError>
  /** Called whenever a Member signs in (including right after sign-up). */
  readonly signedIn: (memberId: MemberId) => Effect.Effect<void, SqlError>
  readonly member: (memberId: MemberId) => Effect.Effect<Option.Option<Member>, SqlError>
  readonly memberByEmail: (email: string) => Effect.Effect<Option.Option<Member>, SqlError>
  readonly grantAdmin: (memberId: MemberId) => Effect.Effect<void, SqlError>
  readonly settings: Effect.Effect<InstanceSettings, SqlError>
  readonly updateSettings: (settings: InstanceSettings) => Effect.Effect<InstanceSettings, SqlError>
  readonly members: Effect.Effect<Array<Member>, SqlError>
  /** Deletes the Member with their sessions and logins. False when there was no such Member. */
  readonly removeMember: (memberId: MemberId) => Effect.Effect<boolean, SqlError>
  readonly invites: Effect.Effect<Array<Invite>, SqlError>
  readonly createInvite: (input: { readonly note: string; readonly createdBy: MemberId }) => Effect.Effect<CreatedInvite, SqlError>
  /** Deletes an unused Invite. False when there was no such unused Invite. */
  readonly revokeInvite: (inviteId: InviteId) => Effect.Effect<boolean, SqlError>
  /** The session-signing secret generated on first boot, for Instances without BETTER_AUTH_SECRET. */
  readonly generatedSecret: Effect.Effect<string, SqlError>
}>()("flock/Access") {
  static readonly layer = Layer.effect(
    Access,
    Effect.gen(function*() {
      const sql = yield* PgClient.PgClient
      const { adminEmail } = yield* AuthConfig
      const isAdminEmail = (email: string) => Option.exists(adminEmail, (admin) => sameEmail(admin, email))

      const selectMembers = (where: ReturnType<typeof sql.and>) =>
        sql<{ id: string; email: string; name: string; isAdmin: boolean }>`
          SELECT m.id, m.email, m.name, a.member_id IS NOT NULL AS is_admin
          FROM member m LEFT JOIN instance_admin a ON a.member_id = m.id
          WHERE ${where}
          ORDER BY m."createdAt", m.id`.pipe(
          Effect.map((rows) => rows.map((row) => new Member({ ...row, id: MemberId.make(row.id) })))
        )
      const select = (where: ReturnType<typeof sql.and>) =>
        selectMembers(where).pipe(Effect.map((members) => Option.fromNullishOr(members[0])))

      const settings = sql<{ openSignUp: boolean }>`SELECT open_sign_up FROM instance_settings`.pipe(
        Effect.map(([row]): InstanceSettings => ({ openSignUp: row?.openSignUp ?? false }))
      )

      const useInvite = (token: string, email: string) =>
        Effect.gen(function*() {
          const now = DateTime.toDateUtc(yield* DateTime.now)
          const used = yield* sql`
            UPDATE invite SET used_at = ${now}, used_by = ${email.trim().toLowerCase()}
            WHERE token_hash = ${hashToken(token)} AND used_at IS NULL
            RETURNING id`
          return used.length > 0
        })

      const member = (memberId: MemberId) => select(sql.and([sql`m.id = ${memberId}`]))
      const grantAdmin = (memberId: MemberId) =>
        sql`INSERT INTO instance_admin (member_id) VALUES (${memberId}) ON CONFLICT DO NOTHING`.pipe(Effect.asVoid)

      return Access.of({
        admitSignUp: ({ email, invite }) =>
          Effect.gen(function*() {
            if (isAdminEmail(email)) return { ok: true } as const
            if ((yield* settings).openSignUp) return { ok: true } as const
            if (invite === undefined || invite === "") return signUpClosed
            return (yield* useInvite(invite, email)) ? { ok: true } as const : inviteInvalid
          }),
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
        settings,
        updateSettings: ({ openSignUp }) =>
          sql`UPDATE instance_settings SET open_sign_up = ${openSignUp}`.pipe(Effect.andThen(settings)),
        members: selectMembers(sql.and([])),
        removeMember: (memberId) =>
          sql`DELETE FROM member WHERE id = ${memberId} RETURNING id`.pipe(Effect.map((rows) => rows.length > 0)),
        invites: sql<InviteRow>`
          SELECT id, note, created_at, used_at, used_by FROM invite ORDER BY created_at DESC, id`.pipe(
          Effect.map((rows) => rows.map(toInvite))
        ),
        createInvite: ({ createdBy, note }) =>
          Effect.gen(function*() {
            const token = `inv_${Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url")}`
            const [row] = yield* sql<InviteRow>`
              INSERT INTO invite ${
              sql.insert({
                id: makeId("invite"),
                tokenHash: hashToken(token),
                note: note.trim(),
                createdBy,
                createdAt: DateTime.toDateUtc(yield* DateTime.now)
              })
            }
              RETURNING id, note, created_at, used_at, used_by`
            return new CreatedInvite({ invite: toInvite(row!), token })
          }),
        revokeInvite: (inviteId) =>
          sql`DELETE FROM invite WHERE id = ${inviteId} AND used_at IS NULL RETURNING id`.pipe(
            Effect.map((rows) => rows.length > 0)
          ),
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
