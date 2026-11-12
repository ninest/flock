import { Context, Schema } from "effect"
import { HttpApiMiddleware } from "effect/http-api"

export const MemberId = Schema.String.pipe(Schema.brand("MemberId"))
export type MemberId = typeof MemberId.Type

/** A person with a login on this Instance. */
export class Member extends Schema.Class<Member>("Member")({
  id: MemberId,
  email: Schema.String,
  name: Schema.String,
  /** Whether this Member is an Instance admin. */
  isAdmin: Schema.Boolean
}) {}

export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  "Unauthorized",
  { message: Schema.String },
  { httpApiStatus: 401 }
) {}

/** The signed-in Member, provided to handlers by MemberAuth. */
export class CurrentMember extends Context.Service<CurrentMember, {
  readonly id: MemberId
  readonly email: string
}>()("flock/CurrentMember") {}

/**
 * Requires a signed-in Member (a Better Auth session cookie). The browser sends the
 * cookie itself (same origin), so the client has nothing to add.
 */
export class MemberAuth extends HttpApiMiddleware.Service<MemberAuth, {
  provides: CurrentMember
}>()("flock/MemberAuth", {
  error: Unauthorized
}) {}

/** Instance-wide settings the Instance admin manages. */
export const InstanceSettings = Schema.Struct({
  /** Anyone may sign up without an Invite. Off by default. */
  openSignUp: Schema.Boolean
})
export type InstanceSettings = typeof InstanceSettings.Type

export const InviteId = Schema.String.pipe(Schema.brand("InviteId"))
export type InviteId = typeof InviteId.Type

/** A single-use offer to become a Member, shared by hand as a link. */
export class Invite extends Schema.Class<Invite>("Invite")({
  id: InviteId,
  /** Who the Invite is for, as the Instance admin noted it (e.g. "Alice"). */
  note: Schema.String,
  createdAt: Schema.DateTimeUtcFromString,
  /** Set once someone has signed up with this Invite. */
  usedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  /** The email of the Member who used it. */
  usedBy: Schema.NullOr(Schema.String)
}) {}

/** A newly created Invite with its secret token, which is only ever shown once. */
export class CreatedInvite extends Schema.Class<CreatedInvite>("CreatedInvite")({
  invite: Invite,
  /** Passed as `invite` in the sign-up request. */
  token: Schema.String
}) {}

/** The signed-in Member is not allowed to do this (e.g. not the Instance admin). */
export class Forbidden extends Schema.TaggedError<Forbidden>()(
  "Forbidden",
  { message: Schema.String },
  { httpApiStatus: 403 }
) {}

export class MemberNotFound extends Schema.TaggedError<MemberNotFound>()(
  "MemberNotFound",
  { id: MemberId },
  { httpApiStatus: 404 }
) {}

export class InviteNotFound extends Schema.TaggedError<InviteNotFound>()(
  "InviteNotFound",
  { id: InviteId },
  { httpApiStatus: 404 }
) {}

/** How Members can sign in on this Instance, for the sign-in page. */
export const SignInOptions = Schema.Struct({
  /** The email + password form. */
  password: Schema.Boolean,
  /** The OIDC issuer, by the name to show ("Sign in with …"), when one is configured. */
  oidc: Schema.NullOr(Schema.Struct({ name: Schema.String }))
})
export type SignInOptions = typeof SignInOptions.Type
