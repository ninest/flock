// Visitors (persistent Tracking mode only, ADR 0002): the Visitor profile and a Visitor's Sessions.
// A Visitor is shown by their ID when identified, else by their Visitor name (see visitor-name.ts),
// which the server never sends.
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { EnvironmentId, EnvironmentNotFound } from "./domain.ts"
import { MemberAuth } from "./members.ts"
import { SESSIONS_CURSOR, SessionList } from "./sessions.ts"

/** One Visitor over all time in one Environment. */
export const VisitorSummary = Schema.Struct({
  visitorId: Schema.String,
  /** The Visitor ID is one Identify linked a device to (ADR 0005). */
  identified: Schema.Boolean,
  /** The Visitor's first and last Event in the Environment. */
  firstSeenAt: Schema.DateTimeUtcFromString,
  lastSeenAt: Schema.DateTimeUtcFromString,
  sessions: Schema.Number,
  events: Schema.Number
})
export type VisitorSummary = typeof VisitorSummary.Type

/** Days in the Visitor profile's activity: 26 weeks. */
export const VISITOR_ACTIVITY_DAYS = 182

export const VisitorProfile = Schema.Struct({
  ...VisitorSummary.fields,
  /** Events per local day in the Project's time zone, oldest first: the last 26 weeks, ending today, empty days included. */
  activity: Schema.Array(Schema.Struct({ date: Schema.String, events: Schema.Number })),
  /** Every Event name the Visitor sent (Pageviews as `$pageview`), most frequent first. */
  eventNames: Schema.Array(Schema.Struct({ name: Schema.String, count: Schema.Number }))
})
export type VisitorProfile = typeof VisitorProfile.Type

export const VisitorSessionsQuery = Schema.Struct({
  /** `nextCursor` of the previous page. */
  cursor: Schema.optional(Schema.String.check(Schema.isPattern(SESSIONS_CURSOR)))
})
export type VisitorSessionsQuery = typeof VisitorSessionsQuery.Type

/** Visitors exist only in persistent Tracking mode: in cookieless mode a Visitor resets every day. */
export class VisitorsNeedPersistentMode extends Schema.TaggedError<VisitorsNeedPersistentMode>()(
  "VisitorsNeedPersistentMode",
  { message: Schema.String },
  { httpApiStatus: 409 }
) {}

export class VisitorNotFound extends Schema.TaggedError<VisitorNotFound>()(
  "VisitorNotFound",
  { visitorId: Schema.String },
  { httpApiStatus: 404 }
) {}

const visitorParams = { environmentId: EnvironmentId, visitorId: Schema.String }
const errors = [EnvironmentNotFound, VisitorsNeedPersistentMode, VisitorNotFound]

export class VisitorsGroup extends HttpApiGroup.make("visitors")
  .add(
    /** One Visitor's profile over all time in the Environment; ignores the date range. */
    HttpApiEndpoint.get("profile", "/:environmentId/visitors/:visitorId", {
      params: visitorParams,
      success: VisitorProfile,
      error: errors
    }),
    /** The Visitor's Sessions in the Environment, most recent activity first, paged like Recent sessions. */
    HttpApiEndpoint.get("sessions", "/:environmentId/visitors/:visitorId/sessions", {
      params: visitorParams,
      query: VisitorSessionsQuery,
      success: SessionList,
      error: errors
    })
  )
  .middleware(MemberAuth)
  .prefix("/api/environments")
  .annotateMerge(OpenApi.annotations({ title: "Visitors" })) {}
