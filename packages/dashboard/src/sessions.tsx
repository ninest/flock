// Sessions: Recent Sessions on the Dashboard, the Session timeline (shared with the Live tab), and
// the Session page. A live Session (active or idle) refreshes itself; on its page the timeline
// follows new Events at the bottom while you stay there, like a chat.
import type { Environment, EventPropertyFilters, ProjectId, ReportRangeQuery, SessionDetail, SessionEvent, SessionSummary } from "@flock/shared"
import { Link } from "@tanstack/react-router"
import { DateTime } from "effect"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { request } from "./api.ts"
import { capitalize, countryName, formatClock, formatCount, formatDuration } from "./format.ts"
import { isComplete, type ProjectSearch, sharedSearch } from "./project-search.ts"
import { Notice, pending, Rows, StatusDot, useNow, wide } from "./ui.tsx"
import { usePoll } from "./use-poll.ts"

const millis = (t: DateTime.Utc) => DateTime.toEpochMillis(t)

const dayOf = (ms: number, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(ms)

/** `2:04 PM` today, `Mar 3, 2:04 PM` on another day, in the Project's time zone. */
export const formatStart = (t: DateTime.Utc, timeZone: string, now = Date.now()) => {
  const ms = millis(t)
  const today = dayOf(ms, timeZone) === dayOf(now, timeZone)
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    ...(today ? {} : { month: "short", day: "numeric" }),
    hour: "numeric",
    minute: "2-digit"
  }).format(ms)
}

const minutesAgo = (t: DateTime.Utc, now: number) => Math.max(0, Math.floor((now - millis(t)) / 60_000))

/** Where a Session came from: its referring domain, or Direct. */
export const sourceOf = (session: SessionSummary) => session.referringDomain ?? "Direct"

// Recent Sessions.

const SHOWN = 10

/**
 * Sessions with an Event in the range that match every Filter, most recent activity first. The
 * first page refreshes every 10 seconds until "Show more" fetches an older page; from then on the
 * list is a snapshot, so the pages line up. Remount it (with a `key`) when the Environment, range
 * or Filters change.
 */
export const RecentSessions = ({ projectId, environment, query, search, timeZone }: {
  projectId: ProjectId
  environment: Environment
  query: ReportRangeQuery
  search: ProjectSearch
  timeZone: string
}) => {
  const complete = isComplete(query)
  const [shown, setShown] = useState(SHOWN)
  // Older pages, loaded on demand; `cursor` is where the next one starts (undefined: none loaded yet).
  const [older, setOlder] = useState<{ sessions: ReadonlyArray<SessionSummary>; cursor: string | null | undefined }>({ sessions: [], cursor: undefined })
  const { data, error } = usePoll(
    () => complete ? request((api) => api.reports.sessions({ params: { environmentId: environment.id }, query })) : Promise.resolve(undefined),
    [environment.id],
    10_000,
    () => older.cursor === undefined
  )
  const [loading, setLoading] = useState(false)
  const now = useNow()
  const cursor = older.cursor === undefined ? data?.nextCursor ?? null : older.cursor
  const sessions = [...(data?.sessions ?? []), ...older.sessions]

  const showMore = async () => {
    const want = shown + 20
    if (want > sessions.length && cursor !== null) {
      setLoading(true)
      try {
        const page = await request((api) => api.reports.sessions({ params: { environmentId: environment.id }, query: { ...query, cursor } }))
        setOlder((o) => ({ sessions: [...o.sessions, ...page.sessions], cursor: page.nextCursor }))
      } finally {
        setLoading(false)
      }
    }
    setShown(want)
  }

  const back = sharedSearch(search)
  return (
    <section className="recent">
      <div className="section-head"><h2>Recent Sessions</h2></div>
      <Rows
        variant="end"
        testId="recent-sessions"
        columns={[{ label: "Entered on" }, { label: "Started", width: 132 }, { label: "From", width: 180, wide: true }, { label: "Events", width: 64, wide: true }, { label: "Duration", width: 84 }]}
      >
        {!complete ? null : !data ? pending(error, "Sessions") : sessions.length === 0 ? <Notice>No Sessions in this range.</Notice> : (
          sessions.slice(0, shown).map((s) => (
            <Link key={s.id} role="row" className="row" to="/projects/$projectId/sessions/$sessionId" params={{ projectId, sessionId: s.id }} search={back}>
              <span><StatusDot status={s.status} />{s.entryPage ?? "No Pageview"}</span>
              <span>{formatStart(s.startedAt, timeZone, now)}</span>
              <span {...wide}>{sourceOf(s)}</span>
              <span {...wide}>{formatCount(s.events)}</span>
              <span>{formatDuration(s.duration)}</span>
            </Link>
          ))
        )}
      </Rows>
      {data && (shown < sessions.length || cursor !== null) && (
        <div className="more">
          <button type="button" className="link" disabled={loading} onClick={() => void showMore()}>{loading ? "Loading…" : "Show more"}</button>
        </div>
      )}
    </section>
  )
}

// The Session timeline.

/** Loads a Session, and again every 5 seconds while it is active or idle. */
export const useSession = (environmentId: Environment["id"] | undefined, sessionId: string | undefined, filters: EventPropertyFilters | undefined) =>
  usePoll(
    () =>
      environmentId === undefined || sessionId === undefined
        ? Promise.resolve(undefined)
        : request((api) => api.reports.session({ params: { environmentId, sessionId }, query: { filters } })),
    [environmentId, sessionId, JSON.stringify(filters ?? [])],
    5000,
    (session) => session !== undefined && session.status !== "ended"
  )

const isPageview = (event: SessionEvent) => event.name === "$pageview"

/** The path of a Pageview's URL, or the URL as sent when it doesn't parse. */
const pathOf = (url: unknown) => {
  if (typeof url !== "string") return "(no URL)"
  try {
    return new URL(url).pathname || "/"
  } catch {
    return url
  }
}

const valueText = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value))

/** The last Pageview's path, where the Visitor left from. */
export const exitPage = (session: SessionDetail) => {
  const last = [...session.timeline].reverse().find(isPageview)
  return last ? pathOf(last.properties.$url) : null
}

/** What follows an Event's name: how long a Pageview lasted until the next one, or a Custom event's values. */
const afterText = (timeline: ReadonlyArray<SessionEvent>, i: number) => {
  const event = timeline[i]!
  if (!isPageview(event)) {
    const values = Object.entries(event.properties).filter(([key]) => !key.startsWith("$")).map(([, v]) => valueText(v))
    return values.slice(0, 3).join(", ")
  }
  const next = timeline.slice(i + 1).find(isPageview) ?? timeline.at(-1)!
  const seconds = (millis(next.timestamp) - millis(event.timestamp)) / 1000
  return seconds >= 1 ? `stayed ${formatDuration(seconds)}` : ""
}

/** A Session's Events, oldest first. Each row opens to show its Event properties. */
export const Timeline = ({ session, timeZone, highlight, heading }: {
  session: SessionDetail
  timeZone: string
  /** Mark the Events that match the Filters. */
  highlight: boolean
  heading?: React.ReactNode
}) => {
  const start = millis(session.startedAt)
  return (
    <div className="timeline">
      {heading}
      <ol data-testid="session-timeline">
        {session.timeline.map((event, i) => (
          <li key={event.id} data-match={highlight && event.matchesFilters}>
            <details>
              <summary>
                <time title={formatStart(event.timestamp, timeZone)}>{formatClock((millis(event.timestamp) - start) / 1000)}</time>
                <span className="name" data-custom={!isPageview(event)}>{isPageview(event) ? pathOf(event.properties.$url) : event.name}</span>
                <span className="after">{afterText(session.timeline, i)}</span>
              </summary>
              <dl className="properties">
                {Object.entries(event.properties).map(([key, value]) => (
                  <div key={key} style={{ display: "contents" }}>
                    <dt>{key}</dt>
                    <dd>{valueText(value)}</dd>
                  </div>
                ))}
              </dl>
            </details>
          </li>
        ))}
      </ol>
      {session.truncated && <p className="notice">Showing the first {formatCount(session.timeline.length)} of {formatCount(session.events)} Events.</p>}
    </div>
  )
}

// The Session page.

const atBottom = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 48
const scrollToBottom = () => window.scrollTo({ top: document.documentElement.scrollHeight })

/** Under the newest Event: whether more may still come. */
const timelineEnd = (session: SessionDetail, now: number) =>
  session.status === "active"
    ? "Live: new Events appear here."
    : session.status === "idle"
    ? `Nothing for ${minutesAgo(session.lastSeenAt, now)} min, so they've probably left. Still watching until the Session closes after 30 minutes.`
    : "This Session has ended."

/** `DE` as `Germany`. */
const country = (code: string | null) => (code === null ? "Unknown" : countryName(code))

export const SessionPage = ({ projectId, environment, sessionId, search, timeZone }: {
  projectId: ProjectId
  environment: Environment
  sessionId: string
  search: ProjectSearch
  timeZone: string
}) => {
  const { data: session, error } = useSession(environment.id, sessionId, search.filters)
  const now = useNow()

  // Scrolling: an ended Session opens at the top; a live one opens at the bottom and follows new
  // Events while you stay at the bottom. Scrolled up, new Events wait behind a button.
  const seen = useRef<number | undefined>(undefined)
  const [unseen, setUnseen] = useState(0)
  const count = session?.timeline.length
  const wasAtBottom = useRef(true)
  useLayoutEffect(() => {
    if (!session || count === undefined) return
    if (seen.current === undefined) {
      if (session.status === "ended") window.scrollTo({ top: 0 })
      else scrollToBottom()
    } else if (count > seen.current) {
      if (wasAtBottom.current) scrollToBottom()
      else setUnseen((n) => n + count - seen.current!)
    }
    seen.current = count
  }, [count])
  useEffect(() => {
    const onScroll = () => {
      wasAtBottom.current = atBottom()
      if (wasAtBottom.current) setUnseen(0)
    }
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  const crumb = <Link className="crumb" to="/projects/$projectId" params={{ projectId }} search={sharedSearch(search)}>← Dashboard</Link>
  if (!session) {
    return (
      <div className="page session">
        {crumb}
        {error
          ? (error as Error).message === "SessionNotFound"
            ? <><h1>Session not found</h1><p className="dim">It may have been deleted, or the link is wrong.</p></>
            : <Notice alert>{(error as Error).message}</Notice>
          : <Notice>Loading…</Notice>}
      </div>
    )
  }
  const live = session.status !== "ended"
  const utm = [session.utmSource, session.utmMedium, session.utmCampaign].filter((v) => v !== null)
  const device = [session.device && capitalize(session.device), session.browser].filter((v) => v !== null)
  const facts: Array<[string, React.ReactNode]> = [
    ["Duration", formatDuration(session.duration)],
    ["Events", formatCount(session.events)],
    ["From", session.referrer === null ? "Direct" : <a href={session.referrer} target="_blank" rel="noreferrer noopener" title={session.referrer}>{sourceOf(session)}</a>],
    ["Entered on", session.entryPage ?? "No Pageview"],
    ["Left from", live ? "Still here" : exitPage(session) ?? "No Pageview"],
    ["Device", device.length > 0 ? device.join(", ") : "Unknown"],
    ["Operating system", session.os ?? "Unknown"],
    ["Country", country(session.country)],
    ...(utm.length > 0 ? [["UTM", utm.join(", ")] as [string, string]] : []),
    ...(session.visitorId !== null ? [["Identified as", <code key="id">{session.visitorId}</code>] as [string, React.ReactNode]] : [])
  ]
  return (
    <div className="page session">
      {crumb}
      <h1 data-testid="session-status">
        {formatStart(session.startedAt, timeZone, now)}
        {live && <em><StatusDot status={session.status} />{session.status === "active" ? "Live" : "Idle"}</em>}
      </h1>
      <dl className="facts">
        {facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
      <Timeline session={session} timeZone={timeZone} highlight={(search.filters?.length ?? 0) > 0} />
      <p className="timeline-end"><StatusDot status={session.status} />{timelineEnd(session, now)}</p>
      {unseen > 0 && (
        <button type="button" className="btn new-events" onClick={() => { scrollToBottom(); setUnseen(0) }}>
          ↓ {unseen} new {unseen === 1 ? "Event" : "Events"}
        </button>
      )}
    </div>
  )
}
