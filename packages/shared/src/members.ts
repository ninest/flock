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
