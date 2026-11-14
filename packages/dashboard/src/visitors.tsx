// Visitors (persistent Tracking mode): the Visitors tab, listing the Visitors active in the range,
// and the Visitor profile, one Visitor over all time in one Environment, whatever the date range.
// The profile opens from a Visitors list row or from the Session page.
import {
  type Environment,
  type ProjectId,
  type SessionSummary,
  type VisitorListRow,
  visitorLabel,
  type VisitorProfile
} from "@flock/shared"
import { Link } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { request } from "./api.ts"
import { barWidth, capitalize, countryName, formatCount, formatDuration } from "./format.ts"
import { isComplete, type ProjectSearch, reportQuery, sharedSearch } from "./project-search.ts"
import { formatStart, fromOf, SESSION_COLUMNS } from "./sessions.tsx"
import { barStyle, Notice, pending, Rows, StatusDot, useNow, wide } from "./ui.tsx"
import { usePoll } from "./use-poll.ts"
import { activityWeeks } from "./visitor-activity.ts"

/** The message of a failed request; undefined while there is no error yet. */
const errorMessage = (error: unknown) => error instanceof Error ? error.message : undefined

const NO_VISITORS = "This Project uses cookieless Tracking mode, where a Visitor starts afresh every day. Persistent mode (in Project settings) keeps Visitors across days."

// The Visitors tab.

/** The Visitors tab: a search on the start of an identified Visitor ID over the list of Visitors. */
export const VisitorsList = (props: {
  projectId: ProjectId
  environment: Environment
  search: ProjectSearch
  timeZone: string
  onSearch: (q: string | undefined) => void
}) => (
  <div className="page">
    <div className="section-head visitors-head">
      <h1>Visitors</h1>
      <SearchBox value={props.search.q ?? ""} onChange={props.onSearch} />
    </div>
    <VisitorRows key={`${props.environment.id}-${JSON.stringify(reportQuery(props.search))}-${props.search.q ?? ""}`} {...props} />
  </div>
)

/**
 * The Visitors with an Event in the range that matches every Filter, last seen first. The first page
 * refreshes every 30 seconds until "Show more" loads an older page; from then on the list is a
 * snapshot, so the pages line up. Remounted (by its `key`) when the Environment, range, Filters or
 * search change.
 */
const VisitorRows = ({ projectId, environment, search, timeZone }: {
  projectId: ProjectId
  environment: Environment
  search: ProjectSearch
  timeZone: string
}) => {
  const query = { ...reportQuery(search), ...(search.q ? { search: search.q } : {}) }
  const complete = isComplete(query)
  const load = (cursor?: string) => request((api) => api.visitors.list({ params: { environmentId: environment.id }, query: { ...query, cursor } }))
  const [older, setOlder] = useState<{ visitors: ReadonlyArray<VisitorListRow>; cursor: string | null | undefined }>({ visitors: [], cursor: undefined })
  const { data, error } = usePoll(() => complete ? load() : Promise.resolve(undefined), [environment.id], 30_000, () => older.cursor === undefined)
  const [loading, setLoading] = useState(false)
  const now = useNow()
  const cursor = older.cursor === undefined ? data?.nextCursor ?? null : older.cursor
  const visitors = [...(data?.visitors ?? []), ...older.visitors]
  const showMore = async () => {
    if (cursor === null) return
    setLoading(true)
    try {
      const page = await load(cursor)
      setOlder((o) => ({ visitors: [...o.visitors, ...page.visitors], cursor: page.nextCursor }))
    } finally {
      setLoading(false)
    }
  }
  const back = sharedSearch(search)
  return (
    <>
      <Rows
        variant="end"
        testId="visitors"
        columns={[
          { label: "Visitor" },
          { label: "Last seen", width: 132 },
          { label: "First seen", width: 132, wide: true },
          { label: "Sessions", width: 72, wide: true },
          { label: "Events", width: 64 },
          { label: "Country", width: 132, wide: true },
          { label: "Device", width: 140, wide: true },
          { label: "From", width: 260, wide: true }
        ]}
      >
        {!complete ? <Notice>Pick both dates.</Notice> : !data ? (
          !error
            ? <Notice>Loading…</Notice>
            : errorMessage(error) === "VisitorsNeedPersistentMode"
            ? <Notice>{NO_VISITORS}</Notice>
            : <Notice alert>{errorMessage(error)}</Notice>
        ) : visitors.length === 0 ? (
          <Notice>{search.q ? <>No identified Visitor ID starting with <code>{search.q}</code> in this range.</> : "No Visitors in this range."}</Notice>
        ) : visitors.map((v) => (
          <Link key={v.visitorId} role="row" className="row" to="/projects/$projectId/visitors/$visitorId" params={{ projectId, visitorId: v.visitorId }} search={back}>
            <span title={v.visitorId} style={v.identified ? { fontFamily: "var(--mono)" } : undefined}>{visitorLabel(v)}</span>
            <span>{formatStart(v.lastSeenAt, timeZone, now)}</span>
            <span {...wide}>{formatStart(v.firstSeenAt, timeZone, now)}</span>
            <span {...wide}>{formatCount(v.sessions)}</span>
            <span>{formatCount(v.events)}</span>
            <span {...wide}>{v.country === null ? "Unknown" : countryName(v.country)}</span>
            <span {...wide}>{deviceOf(v)}</span>
            <span {...wide}>{fromOf(v)}</span>
          </Link>
        ))}
      </Rows>
      {data && cursor !== null && (
        <div className="more">
          <button type="button" className="link" disabled={loading} onClick={() => void showMore()}>{loading ? "Loading…" : "Show more"}</button>
        </div>
      )}
    </>
  )
}

const deviceOf = (v: VisitorListRow) => [v.device && capitalize(v.device), v.browser].filter((x) => x !== null).join(", ") || "Unknown"

/** Searches identified Visitor IDs by their start; applies after a pause in typing. */
const SearchBox = ({ value, onChange }: { value: string; onChange: (q: string | undefined) => void }) => {
  const [text, setText] = useState(value)
  useEffect(() => {
    const q = text.trim()
    if (q === value) return
    const timer = setTimeout(() => onChange(q === "" ? undefined : q), 300)
    return () => clearTimeout(timer)
  }, [text])
  return (
    <input
      type="search"
      className="visitors-search"
      value={text}
      onChange={(e) => setText(e.target.value)}
      placeholder="Search identified IDs"
      aria-label="Search identified Visitor IDs by their start"
      maxLength={200}
    />
  )
}

// The Visitor profile.

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
          ? <><h1>No Visitor profiles</h1><p className="dim">{NO_VISITORS}</p></>
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
        columns={SESSION_COLUMNS}
      >
        {!data ? pending(error, "Sessions") : sessions.map((s) => (
          <Link key={s.id} role="row" className="row" to="/projects/$projectId/sessions/$sessionId" params={{ projectId, sessionId: s.id }} search={sharedSearch(search)}>
            <span><StatusDot status={s.status} />{s.entryPage ?? "No Pageview"}</span>
            <span>{formatStart(s.startedAt, timeZone, now)}</span>
            <span>{fromOf(s)}</span>
            <span {...wide}>{formatCount(s.events)}</span>
            <span {...wide}>{formatDuration(s.duration)}</span>
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
