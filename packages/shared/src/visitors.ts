// Visitors (persistent Tracking mode only, ADR 0002): the Visitors list, the Visitor profile and a
// Visitor's Sessions.
// A Visitor is shown by their ID when identified, else by their Visitor name (see visitor-name.ts),
// which the server never sends.
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { EnvironmentId, EnvironmentNotFound } from "./domain.ts"
import { MemberAuth } from "./members.ts"
import { rangeFields, validRange } from "./reports.ts"
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

/** A Visitors list row: the Visitor over all time, with the audience of their latest Session. */
export const VisitorListRow = Schema.Struct({
  ...VisitorSummary.fields,
  /** `$country`, `$device` and `$browser` of the latest Session's first Event; null when unknown. */
  country: Schema.NullOr(Schema.String),
  device: Schema.NullOr(Schema.String),
  browser: Schema.NullOr(Schema.String),
  /** The referring domain of the latest Session's first Pageview, as in Recent sessions; null for direct traffic. */
  referringDomain: Schema.NullOr(Schema.String),
  /** The `utm_source` UTM tag of the latest Session's first Pageview; null without one. */
  utmSource: Schema.NullOr(Schema.String)
})
export type VisitorListRow = typeof VisitorListRow.Type

/** A Visitors list cursor: the last row's ISO last-seen time and Visitor ID, joined by `_`. */
export const VISITORS_CURSOR = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z_.+$/

/** The Visitors list: Visitors with an Event in the range that matches every Filter. */
export const VisitorsQuery = Schema.Struct({
  ...rangeFields,
  /** `nextCursor` of the previous page. */
  cursor: Schema.optional(Schema.String.check(Schema.isPattern(VISITORS_CURSOR))),
  /** Only identified Visitors whose ID starts with this text. */
  search: Schema.optional(Schema.String.check(Schema.isMaxLength(200)))
}).check(validRange)
export type VisitorsQuery = typeof VisitorsQuery.Type

/** At most this many Visitors per page. */
export const VISITORS_PAGE_SIZE = 50

export const VisitorList = Schema.Struct({
  /** Last seen first, Visitor ID as tiebreak. */
  visitors: Schema.Array(VisitorListRow),
  /** Pass as `cursor` for the next page; null on the last page. */
  nextCursor: Schema.NullOr(Schema.String)
})
export type VisitorList = typeof VisitorList.Type

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
    /**
     * The Visitors with an Event in the range that matches every Filter, last seen first, 50 per page.
     * Membership follows the range; each row's numbers are over all time.
     */
    HttpApiEndpoint.get("list", "/:environmentId/visitors", {
      params: { environmentId: EnvironmentId },
      query: VisitorsQuery,
      success: VisitorList,
      error: [EnvironmentNotFound, VisitorsNeedPersistentMode]
    })
  )
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
