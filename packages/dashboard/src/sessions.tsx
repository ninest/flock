// Recent sessions (on the Project page) and the Session page with its Session timeline: the
// Session's Events oldest first, newest at the bottom. A live Session (active or idle) refreshes
// itself and follows new Events at the bottom while you stay there, like a chat.
import type {
  Environment,
  EventPropertyFilters,
  ProjectId,
  ReportRangeQuery,
  SessionDetail,
  SessionEvent,
  SessionStatus,
  SessionSummary
} from "@flock/shared"
import { Link } from "@tanstack/react-router"
import { DateTime } from "effect"
import { type CSSProperties, Fragment, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react"
import { request } from "./api.ts"
import { type ProjectSearch, queryDeps } from "./filters.tsx"
import { isComplete, muted } from "./top-list.tsx"
import { usePoll } from "./use-poll.ts"

const card: CSSProperties = { border: "1px solid #ccc", borderRadius: 8, padding: 12 }

const millis = (t: DateTime.Utc) => DateTime.toEpochMillis(t)

/** `1:05:09`, `4:02` or `0:42`. */
const clock = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, "0")
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`
}

/** `42s`, `3m 05s` or `1h 02m`. */
const gap = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`
}

const formatTime = (t: DateTime.Utc, timeZone: string, withDate = true) =>
  new Intl.DateTimeFormat(undefined, {
    timeZone,
    ...(withDate ? { month: "short", day: "numeric" } : {}),
    hour: "numeric",
    minute: "2-digit",
    second: withDate ? undefined : "2-digit"
  }).format(millis(t))

const STATUS: Record<SessionStatus, { readonly color: string; readonly label: string }> = {
  active: { color: "#1a9e55", label: "Active" },
  idle: { color: "#d99a00", label: "Idle" },
  ended: { color: "#bbb", label: "Ended" }
}

const StatusDot = ({ status }: { status: SessionStatus }) => (
  <span aria-hidden style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: STATUS[status].color, flex: "none" }} />
)

/** Re-renders every `ms`, for "last seen N min ago". */
const useNow = (ms = 15_000) => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(timer)
  }, [ms])
  return now
}

const minutesAgo = (t: DateTime.Utc, now: number) => Math.max(0, Math.floor((now - millis(t)) / 60_000))

// Recent sessions.

/**
 * The Recent sessions card: Sessions with an Event in the range that matches every filter, most
 * recent activity first. The first page refreshes every 10 seconds until "Load more" is used; from
 * then on the list is a snapshot, so the older pages line up with it. Remount it (with a `key`)
 * when the Environment, range or filters change.
 */
export const RecentSessions = ({ projectId, environment, range, search, timeZone }: {
  projectId: ProjectId
  environment: Environment
  range: ReportRangeQuery
  search: ProjectSearch
  timeZone: string
}) => {
  const complete = isComplete(range)
  // Older pages, loaded on demand; `cursor` is where the next one starts (undefined: none loaded yet).
  const [older, setOlder] = useState<{ sessions: ReadonlyArray<SessionSummary>; cursor: string | null | undefined }>({
    sessions: [],
    cursor: undefined
  })
  const { data, error } = usePoll(
    () =>
      complete
        ? request((api) => api.reports.sessions({ params: { environmentId: environment.id }, query: range }))
        : Promise.resolve(undefined),
    [environment.id, ...queryDeps(range)],
    10_000,
    () => older.cursor === undefined
  )
  const [loading, setLoading] = useState(false)
  const now = useNow()
  const cursor = older.cursor === undefined ? data?.nextCursor ?? null : older.cursor
  const sessions = [...(data?.sessions ?? []), ...older.sessions]

  const loadMore = async () => {
    if (cursor === null) return
    setLoading(true)
    try {
      const page = await request((api) => api.reports.sessions({ params: { environmentId: environment.id }, query: { ...range, cursor } }))
      setOlder((o) => ({ sessions: [...o.sessions, ...page.sessions], cursor: page.nextCursor }))
    } finally {
      setLoading(false)
    }
  }

  return (
    <section style={{ margin: "12px 0" }}>
      <h3 style={{ marginBottom: 8 }}>Recent sessions</h3>
      <div style={{ ...card, display: "grid", gap: 0, padding: 0 }} data-testid="recent-sessions">
        {!complete
          ? <p style={{ ...muted, padding: 12, margin: 0 }}>Pick both dates.</p>
          : error && !data
          ? <p role="alert" style={{ padding: 12, margin: 0 }}>{(error as Error).message}</p>
          : !data
          ? <p style={{ ...muted, padding: 12, margin: 0 }}>Loading…</p>
          : sessions.length === 0
          ? <p style={{ ...muted, padding: 12, margin: 0 }}>No Sessions in this range.</p>
          : sessions.map((session) => (
            <SessionListItem key={session.id} projectId={projectId} session={session} search={search} timeZone={timeZone} now={now} />
          ))}
        {data && cursor !== null && (
          <button type="button" disabled={loading} onClick={() => void loadMore()} style={{ margin: 12, justifySelf: "start" }}>
            {loading ? "Loading…" : "Load more"}
          </button>
        )}
      </div>
    </section>
  )
}

const SessionListItem = ({ projectId, session, search, timeZone, now }: {
  projectId: ProjectId
  session: SessionSummary
  search: ProjectSearch
  timeZone: string
  now: number
}) => (
  <Link
    to="/projects/$projectId/sessions/$sessionId"
    params={{ projectId, sessionId: session.id }}
    search={search}
    style={{
      display: "grid",
      gridTemplateColumns: "auto 1fr auto",
      gap: "2px 10px",
      alignItems: "center",
      padding: "8px 12px",
      borderBottom: "1px solid #eee",
      color: "inherit",
      textDecoration: "none"
    }}
  >
    <StatusDot status={session.status} />
    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
      <strong>{session.entryPage ?? "(no Pageview)"}</strong>
      <span style={muted}> · {session.referringDomain ?? "Direct"}</span>
    </span>
    <span style={{ ...muted, textAlign: "right" }}>
      {formatTime(session.startedAt, timeZone)}
      {session.status !== "ended" && ` · ${STATUS[session.status].label}, last seen ${minutesAgo(session.lastSeenAt, now)}m ago`}
    </span>
    <span />
    <span style={muted}>
      {[session.country, session.device].filter((v) => v !== null).join(" · ") || "Unknown device"}
    </span>
    <span style={{ ...muted, textAlign: "right" }}>
      {session.events} {session.events === 1 ? "Event" : "Events"} · {clock(session.duration)}
    </span>
  </Link>
)

// The Session page.

/** Loads a Session, and again every 5 seconds while it is active or idle. */
const useSession = (environmentId: Environment["id"] | undefined, sessionId: string, filters: EventPropertyFilters | undefined) =>
  usePoll(
    () =>
      environmentId === undefined
        ? Promise.resolve(undefined)
        : request((api) => api.reports.session({ params: { environmentId, sessionId }, query: { filters } })),
    [environmentId, sessionId, JSON.stringify(filters ?? [])],
    5000,
    (session) => session !== undefined && session.status !== "ended"
  )

const atBottom = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 48
const scrollToBottom = () => window.scrollTo({ top: document.documentElement.scrollHeight })

export const SessionPage = ({ projectId, sessionId, search }: { projectId: ProjectId; sessionId: string; search: ProjectSearch }) => {
  const project = usePoll(() => request((api) => api.projects.get({ params: { projectId } })), [projectId], 60_000)
  const environment = project.data?.environments.find((e) => e.name === (search.env ?? "production")) ?? project.data?.environments[0]
  const { data: session, error } = useSession(environment?.id, sessionId, search.filters)
  const now = useNow()

  // Scrolling: an ended Session opens at the top; a live one opens at the bottom and follows new
  // Events while you stay at the bottom. Scrolled up, new Events wait behind a button.
  const seen = useRef<number | undefined>(undefined)
  const [unseen, setUnseen] = useState(0)
  const count = session?.timeline.length
  // Kept up to date by scrolling, so it says where you were before new Events arrived.
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

  const back = (
    <Link to="/projects/$projectId" params={{ projectId }} search={search}>← {project.data?.name ?? "Project"}</Link>
  )
  if (project.error && !project.data) return <>{back}<p role="alert">{(project.error as Error).message}</p></>
  if (error && !session) return <>{back}<p role="alert">{(error as Error).message}</p></>
  if (!session || !project.data) return <>{back}<p>Loading…</p></>
  const timeZone = project.data.timeZone
  const filtered = (search.filters?.length ?? 0) > 0

  return (
    <>
      {back}
      <h2 style={{ marginBottom: 4 }}>Session</h2>
      <SessionHeader session={session} timeZone={timeZone} now={now} />
      <h3 style={{ marginBottom: 4 }}>Session timeline</h3>
      <p style={{ ...muted, marginTop: 0 }}>
        Oldest first. {filtered ? "Events matching the current Filters are highlighted." : ""}
      </p>
      <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 0 }} data-testid="session-timeline">
        {session.timeline.map((event, i) => (
          <TimelineRow
            key={event.id}
            event={event}
            start={session.startedAt}
            previous={session.timeline[i - 1]}
            timeZone={timeZone}
            highlight={filtered && event.matchesFilters}
          />
        ))}
      </ol>
      {session.truncated && (
        <p style={muted}>Showing the first {session.timeline.length.toLocaleString()} of {session.events.toLocaleString()} Events.</p>
      )}
      <LiveFooter session={session} now={now} />
      {unseen > 0 && (
        <button
          type="button"
          onClick={() => {
            scrollToBottom()
            setUnseen(0)
          }}
          style={{
            position: "fixed",
            bottom: 16,
            left: "50%",
            transform: "translateX(-50%)",
            padding: "6px 14px",
            borderRadius: 16,
            border: "1px solid #ccc",
            background: "#fff",
            boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
            cursor: "pointer"
          }}
        >
          ↓ {unseen} new {unseen === 1 ? "Event" : "Events"}
        </button>
      )}
    </>
  )
}

/** What the status means, in words: the Session stays open 30 minutes, but quiet usually means gone. */
const statusText = (session: SessionDetail, now: number) => {
  const ago = minutesAgo(session.lastSeenAt, now)
  switch (session.status) {
    case "active":
      return ago === 0 ? "Active now" : `Active, last Event ${ago} min ago`
    case "idle":
      return `Idle, last seen ${ago} min ago. They've probably left; the Session closes after 30 minutes without activity.`
    case "ended":
      return "Ended"
  }
}

const SessionHeader = ({ session, timeZone, now }: { session: SessionDetail; timeZone: string; now: number }) => {
  const utm = [
    session.utmSource && `source ${session.utmSource}`,
    session.utmMedium && `medium ${session.utmMedium}`,
    session.utmCampaign && `campaign ${session.utmCampaign}`
  ].filter(Boolean)
  const audience = [session.country, session.browser, session.os, session.device].filter((v) => v !== null)
  const fact = (label: string, value: ReactNode) => (
    <Fragment key={label}>
      <dt style={muted}>{label}</dt>
      <dd style={{ margin: 0, overflowWrap: "anywhere" }}>{value}</dd>
    </Fragment>
  )
  return (
    <div style={{ ...card, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }} data-testid="session-status">
        <StatusDot status={session.status} />
        <strong>{statusText(session, now)}</strong>
      </div>
      <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "4px 12px", margin: 0 }}>
        {fact(
          "Referrer",
          session.referrer === null ? "Direct" : <a href={session.referrer} target="_blank" rel="noreferrer noopener">{session.referrer}</a>
        )}
        {utm.length > 0 && fact("UTM", utm.join(" · "))}
        {fact("Entry page", session.entryPage ?? "(no Pageview)")}
        {fact("Started", `${formatTime(session.startedAt, timeZone)} (${timeZone})`)}
        {fact(
          "Duration",
          `${clock(session.duration)} · ${session.events.toLocaleString()} ${session.events === 1 ? "Event" : "Events"}${session.bounce ? " · Bounce" : ""}`
        )}
        {fact("Visitor", audience.length > 0 ? audience.join(" · ") : "Unknown device")}
        {session.visitorId !== null && fact("Identified as", <code>{session.visitorId}</code>)}
      </dl>
    </div>
  )
}

/** The path of a Pageview's URL, or the URL as sent when it doesn't parse. */
const pathOf = (url: unknown) => {
  if (typeof url !== "string") return "(no URL)"
  try {
    return new URL(url).pathname || "/"
  } catch {
    return url
  }
}

const TimelineRow = ({ event, start, previous, timeZone, highlight }: {
  event: SessionEvent
  start: DateTime.Utc
  previous: SessionEvent | undefined
  timeZone: string
  highlight: boolean
}) => {
  const offset = (millis(event.timestamp) - millis(start)) / 1000
  const isPageview = event.name === "$pageview"
  const properties = Object.entries(event.properties)
  return (
    <li
      style={{
        display: "grid",
        gridTemplateColumns: "4.5em 1fr",
        gap: 8,
        padding: "6px 8px",
        borderLeft: `3px solid ${highlight ? "#d99a00" : "transparent"}`,
        background: highlight ? "#fff8e1" : undefined
      }}
    >
      <span style={{ ...muted, fontVariantNumeric: "tabular-nums" }} title={formatTime(event.timestamp, timeZone, false)}>
        +{clock(offset)}
      </span>
      <div style={{ minWidth: 0 }}>
        {previous && (
          <div style={{ ...muted, fontSize: 12 }}>{gap((millis(event.timestamp) - millis(previous.timestamp)) / 1000)} later</div>
        )}
        <details>
          <summary style={{ cursor: "pointer", overflowWrap: "anywhere" }}>
            {isPageview
              ? <>Viewed <strong>{pathOf(event.properties.$url)}</strong></>
              : <><code>{event.name}</code>{properties.length > 0 && <span style={muted}> · {properties.length} Event properties</span>}</>}
          </summary>
          <table style={{ fontSize: 13, borderCollapse: "collapse", marginTop: 4 }}>
            <tbody>
              {properties.map(([key, value]) => (
                <tr key={key}>
                  <td style={{ ...muted, paddingRight: 12, verticalAlign: "top" }}><code>{key}</code></td>
                  <td style={{ overflowWrap: "anywhere" }}>{typeof value === "string" ? value : JSON.stringify(value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>
    </li>
  )
}

/** Under the newest Event: whether more may still come. */
const LiveFooter = ({ session, now }: { session: SessionDetail; now: number }) => (
  <p style={{ ...muted, display: "flex", gap: 8, alignItems: "center", borderTop: "1px dashed #ccc", paddingTop: 8 }}>
    <StatusDot status={session.status} />
    {session.status === "active"
      ? "Live: new Events appear here."
      : session.status === "idle"
      ? `Nothing for ${minutesAgo(session.lastSeenAt, now)} min, so they've probably left. Still watching until the Session closes.`
      : "This Session has ended."}
  </p>
)
