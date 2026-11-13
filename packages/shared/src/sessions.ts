// Sessions and the Session timeline: the Recent sessions list and one Session's Events, oldest first.
import { Schema } from "effect"
import { filtersField, rangeFields, validRange } from "./reports.ts"

/**
 * Whether the Visitor still seems to be there, from the time since the Session's last Event:
 * `active` under 5 minutes, `idle` from 5 to 30 minutes (probably left, but the Session is still
 * open), `ended` over 30 minutes (the Session is closed).
 */
export const SessionStatus = Schema.Literals(["active", "idle", "ended"])
export type SessionStatus = typeof SessionStatus.Type

/** A Session as the Recent sessions list shows it. Computed from all of the Session's Events. */
export const SessionSummary = Schema.Struct({
  id: Schema.String,
  /** The first and last Event's timestamps. */
  startedAt: Schema.DateTimeUtcFromString,
  lastSeenAt: Schema.DateTimeUtcFromString,
  /** Seconds from the first Event to the last. */
  duration: Schema.Number,
  /** How many Events the Session has. */
  events: Schema.Number,
  /** A Session with a single Event. */
  bounce: Schema.Boolean,
  /** The cleaned path of the first Pageview; null without Pageviews. */
  entryPage: Schema.NullOr(Schema.String),
  /** The referring domain of the first Pageview, as in the Referrers report; null for direct traffic. */
  referringDomain: Schema.NullOr(Schema.String),
  /** `$country` and `$device` of the first Event; null when unknown. */
  country: Schema.NullOr(Schema.String),
  device: Schema.NullOr(Schema.String),
  status: SessionStatus
})
export type SessionSummary = typeof SessionSummary.Type

/** A Recent sessions cursor: the last Session's ISO activity time and ID, joined by `_`. */
export const SESSIONS_CURSOR = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z_.+$/

/** Recent sessions: Sessions with an Event in the range that matches every Filter. */
export const SessionsQuery = Schema.Struct({
  ...rangeFields,
  /** `nextCursor` of the previous page. */
  cursor: Schema.optional(Schema.String.check(Schema.isPattern(SESSIONS_CURSOR)))
}).check(validRange)
export type SessionsQuery = typeof SessionsQuery.Type

/** At most this many Sessions per page. */
export const SESSIONS_PAGE_SIZE = 50

export const SessionList = Schema.Struct({
  /** Most recent activity first. */
  sessions: Schema.Array(SessionSummary),
  /** Pass as `cursor` for the next page; null on the last page. */
  nextCursor: Schema.NullOr(Schema.String)
})
export type SessionList = typeof SessionList.Type

/** One Event in a Session timeline. */
export const SessionEvent = Schema.Struct({
  /** The Event's UUID. */
  id: Schema.String,
  name: Schema.String,
  timestamp: Schema.DateTimeUtcFromString,
  properties: Schema.Record(Schema.String, Schema.Unknown),
  /** The Event matches every Filter given (always true without Filters). */
  matchesFilters: Schema.Boolean
})
export type SessionEvent = typeof SessionEvent.Type

/** At most this many Events of one Session come back. */
export const SESSION_EVENT_LIMIT = 1000

export const SessionDetail = Schema.Struct({
  ...SessionSummary.fields,
  /** The first Pageview's referrer URL (as stored, cleaned); null for direct traffic. */
  referrer: Schema.NullOr(Schema.String),
  /** UTM tags of the first Pageview. */
  utmSource: Schema.NullOr(Schema.String),
  utmMedium: Schema.NullOr(Schema.String),
  utmCampaign: Schema.NullOr(Schema.String),
  /** `$browser` and `$os` of the first Event. */
  browser: Schema.NullOr(Schema.String),
  os: Schema.NullOr(Schema.String),
  /**
   * The Session's Visitor ID in persistent Tracking mode, anonymous or identified (it opens the Visitor
   * profile); null in cookieless mode.
   */
  visitorId: Schema.NullOr(Schema.String),
  /** Whether that Visitor is identified (their ID is one Identify linked a device to); null in cookieless mode. */
  visitorIdentified: Schema.NullOr(Schema.Boolean),
  /** The Session timeline: the first `SESSION_EVENT_LIMIT` Events, oldest first. */
  timeline: Schema.Array(SessionEvent),
  /** More Events exist than the timeline holds. */
  truncated: Schema.Boolean
})
export type SessionDetail = typeof SessionDetail.Type

export const SessionQuery = Schema.Struct(filtersField)
export type SessionQuery = typeof SessionQuery.Type

export class SessionNotFound extends Schema.TaggedError<SessionNotFound>()(
  "SessionNotFound",
  { id: Schema.String },
  { httpApiStatus: 404 }
) {}
