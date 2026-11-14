// The Visitor profile (persistent Tracking mode): one Visitor over all time in one Environment,
// whatever the date range. Reached from the Session page.
import { type Environment, type ProjectId, type SessionSummary, visitorLabel, type VisitorProfile } from "@flock/shared"
import { Link } from "@tanstack/react-router"
import { useState } from "react"
import { request } from "./api.ts"
import { barWidth, formatCount, formatDuration } from "./format.ts"
import { type ProjectSearch, sharedSearch } from "./project-search.ts"
import { formatStart, sourceOf } from "./sessions.tsx"
import { barStyle, Notice, pending, Rows, StatusDot, useNow, wide } from "./ui.tsx"
import { usePoll } from "./use-poll.ts"
import { activityWeeks } from "./visitor-activity.ts"

const errorMessage = (error: unknown) => (error as Error).message

export const VisitorPage = ({ projectId, environment, visitorId, search, timeZone }: {
  projectId: ProjectId
  environment: Environment
  visitorId: string
  search: ProjectSearch
  timeZone: string
}) => {
  const { data: visitor, error } = usePoll(
    () => request((api) => api.visitors.profile({ params: { environmentId: environment.id, visitorId } })),
    [environment.id, visitorId],
    60_000
  )
  const now = useNow()
  const crumb = <Link className="crumb" to="/projects/$projectId" params={{ projectId }} search={sharedSearch(search)}>← Dashboard</Link>
  if (!visitor) {
    return (
      <div className="page session">
        {crumb}
        {!error
          ? <Notice>Loading…</Notice>
          : errorMessage(error) === "VisitorNotFound"
          ? <><h1>Visitor not found</h1><p className="dim">They have no Events in the {environment.name} Environment.</p></>
          : errorMessage(error) === "VisitorsNeedPersistentMode"
          ? <><h1>No Visitor profiles</h1><p className="dim">This Project uses cookieless Tracking mode, where a Visitor starts afresh every day. Persistent mode (in Project settings) keeps Visitors across days.</p></>
          : <Notice alert>{errorMessage(error)}</Notice>}
      </div>
    )
  }
  const facts: Array<[string, React.ReactNode]> = [
    ["Visitor ID", <code key="id" title={visitor.visitorId}>{visitor.visitorId}</code>],
    ["Identified", visitor.identified ? "Yes" : "No, anonymous"],
    ["First seen", formatStart(visitor.firstSeenAt, timeZone, now)],
    ["Last seen", formatStart(visitor.lastSeenAt, timeZone, now)],
    ["Sessions", formatCount(visitor.sessions)],
    ["Events", formatCount(visitor.events)]
  ]
  return (
    <div className="page session visitor">
      {crumb}
      <h1 data-testid="visitor-name">{visitorLabel(visitor)}</h1>
      <dl className="facts">
        {facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
      <Activity visitor={visitor} />
      <EventNames visitor={visitor} />
      <VisitorSessions projectId={projectId} environment={environment} visitorId={visitorId} search={search} timeZone={timeZone} />
    </div>
  )
}

const dayTitle = (date: string, events: number) =>
  `${new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" })}: ${formatCount(events)} ${events === 1 ? "Event" : "Events"}`

/** Events per local day over the last 26 weeks, one column per week. */
const Activity = ({ visitor }: { visitor: VisitorProfile }) => (
  <section className="visitor-block">
    <div className="section-head"><h2>Activity</h2><span className="dim">Events per day, last 26 weeks</span></div>
    <div className="activity" role="img" aria-label="Events per day over the last 26 weeks" data-testid="visitor-activity">
      {activityWeeks(visitor.activity).map((week, i) => (
        <div key={i} className="activity-week">
          {week.map((day, j) =>
            day === null ? <i key={j} className="activity-day" data-empty /> : <i key={j} className="activity-day" data-level={day.level} title={dayTitle(day.date, day.events)} />
          )}
        </div>
      ))}
    </div>
  </section>
)

/** Every Event name the Visitor sent, Pageviews as `$pageview`, most frequent first. */
const EventNames = ({ visitor }: { visitor: VisitorProfile }) => {
  const max = visitor.eventNames[0]?.count ?? 0
  return (
    <section className="visitor-block">
      <Rows variant="bars" title={<h2>Events by name</h2>} columns={[{ label: "Event" }, { label: "Events", width: 96 }]} testId="visitor-event-names">
        {visitor.eventNames.map((e) => (
          <div key={e.name} className="row" role="row" style={barStyle(barWidth(e.count, max))}>
            <span className={e.name.startsWith("$") ? "muted" : undefined} style={{ fontFamily: "var(--mono)" }}>{e.name}</span>
            <span>{formatCount(e.count)}</span>
          </div>
        ))}
      </Rows>
    </section>
  )
}

/** The Visitor's Sessions, newest first, a page at a time. */
const VisitorSessions = ({ projectId, environment, visitorId, search, timeZone }: {
  projectId: ProjectId
  environment: Environment
  visitorId: string
  search: ProjectSearch
  timeZone: string
}) => {
  const load = (cursor?: string) => request((api) => api.visitors.sessions({ params: { environmentId: environment.id, visitorId }, query: { cursor } }))
  // The first page refreshes until an older page is loaded; then the list is a snapshot, so pages line up.
  const [older, setOlder] = useState<{ sessions: ReadonlyArray<SessionSummary>; cursor: string | null | undefined }>({ sessions: [], cursor: undefined })
  const { data, error } = usePoll(() => load(), [environment.id, visitorId], 30_000, () => older.cursor === undefined)
  const [loading, setLoading] = useState(false)
  const now = useNow()
  const cursor = older.cursor === undefined ? data?.nextCursor ?? null : older.cursor
  const sessions = [...(data?.sessions ?? []), ...older.sessions]
  const showMore = async () => {
    if (cursor === null) return
    setLoading(true)
    try {
      const page = await load(cursor)
      setOlder((o) => ({ sessions: [...o.sessions, ...page.sessions], cursor: page.nextCursor }))
    } finally {
      setLoading(false)
    }
  }
  return (
    <section className="recent">
      <div className="section-head"><h2>Sessions</h2></div>
      <Rows
        variant="end"
        testId="visitor-sessions"
        columns={[{ label: "Entered on" }, { label: "Started", width: 132 }, { label: "From", width: 180, wide: true }, { label: "Events", width: 64, wide: true }, { label: "Duration", width: 84 }]}
      >
        {!data ? pending(error, "Sessions") : sessions.map((s) => (
          <Link key={s.id} role="row" className="row" to="/projects/$projectId/sessions/$sessionId" params={{ projectId, sessionId: s.id }} search={sharedSearch(search)}>
            <span><StatusDot status={s.status} />{s.entryPage ?? "No Pageview"}</span>
            <span>{formatStart(s.startedAt, timeZone, now)}</span>
            <span {...wide}>{sourceOf(s)}</span>
            <span {...wide}>{formatCount(s.events)}</span>
            <span>{formatDuration(s.duration)}</span>
          </Link>
        ))}
      </Rows>
      {data && cursor !== null && (
        <div className="more">
          <button type="button" className="link" disabled={loading} onClick={() => void showMore()}>{loading ? "Loading…" : "Show more"}</button>
        </div>
      )}
    </section>
  )
}
