// The Live tab: Sessions whose Visitor may still be here (an Event in the last 30 minutes) on the
// left, and the selected one's Session timeline on the right. On a phone the timeline opens as a
// full-screen sheet. Refreshes every 10 seconds.
import type { Environment, EventPropertyFilters, ProjectId, SessionSummary } from "@flock/shared"
import { Link, useNavigate } from "@tanstack/react-router"
import { DateTime } from "effect"
import { request } from "./api.ts"
import { capitalize, countryName, formatCount, formatDuration } from "./format.ts"
import { isLive, needsNextPage } from "./live-sessions.ts"
import { type ProjectSearch, sharedSearch } from "./project-search.ts"
import { formatStart, sourceOf, Timeline, useSession } from "./sessions.tsx"
import { Detail, Notice, pending, Rows, StatusDot, useNow, wide } from "./ui.tsx"
import { usePoll } from "./use-poll.ts"

/** At most this many pages of today's Sessions are read looking for live ones. */
const MAX_PAGES = 4

/** Today's Sessions that are still live, most recent activity first. */
const loadLive = async (environmentId: Environment["id"], filters: EventPropertyFilters | undefined) => {
  const live: Array<SessionSummary> = []
  let cursor: string | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await request((api) =>
      api.reports.sessions({ params: { environmentId }, query: { period: "today", filters, ...(cursor ? { cursor } : {}) } })
    )
    live.push(...result.sessions.filter(isLive))
    if (!needsNextPage(result) || result.nextCursor === null) break
    cursor = result.nextCursor
  }
  return live
}

export const Live = ({ projectId, environment, search, timeZone }: {
  projectId: ProjectId
  environment: Environment
  search: ProjectSearch
  timeZone: string
}) => {
  const navigate = useNavigate()
  const now = useNow(5000)
  const { data: sessions, error } = usePoll(
    () => loadLive(environment.id, search.filters),
    [environment.id, JSON.stringify(search.filters ?? [])],
    10_000
  )
  const selectedId = search.live ?? sessions?.[0]?.id
  const select = (live: string | undefined) =>
    void navigate({ to: "/projects/$projectId", params: { projectId }, search: { ...search, live }, replace: live === undefined })
  return (
    <div className="page split">
      <section className="split-list">
        <Rows
          variant="select"
          columns={[{ label: "Entered on" }, { label: "From", width: 150 }, { label: "Events", width: 64, wide: true }, { label: "On site", width: 84 }]}
        >
          {!sessions ? pending(error, "live Sessions") : sessions.length === 0 ? <Notice>Nobody is here right now.</Notice> : sessions.map((s) => (
            <button key={s.id} type="button" role="row" className="row" aria-current={s.id === selectedId} onClick={() => select(s.id)}>
              <span><StatusDot status={s.status} />{s.entryPage ?? "No Pageview"}</span>
              <span>{sourceOf(s)}</span>
              <span {...wide}>{formatCount(s.events)}</span>
              <span>{formatDuration((now - DateTime.toEpochMillis(s.startedAt)) / 1000)}</span>
            </button>
          ))}
        </Rows>
      </section>
      <Detail open={search.live !== undefined} onClose={() => select(undefined)}>
        {selectedId !== undefined && (
          <LiveSession key={selectedId} projectId={projectId} environment={environment} sessionId={selectedId} search={search} timeZone={timeZone} />
        )}
      </Detail>
    </div>
  )
}

const LiveSession = ({ projectId, environment, sessionId, search, timeZone }: {
  projectId: ProjectId
  environment: Environment
  sessionId: string
  search: ProjectSearch
  timeZone: string
}) => {
  const { data: session, error } = useSession(environment.id, sessionId, search.filters)
  if (!session) return pending(error, "this Session")
  const where = [session.country && countryName(session.country), session.device && capitalize(session.device)].filter((v) => v !== null)
  return (
    <>
      <h2>{session.entryPage ?? "No Pageview"}</h2>
      <p className="dim">From {sourceOf(session)}{where.length > 0 ? `, ${where.join(", ")}` : ""}</p>
      {session.visitorId !== null && <p className="dim">Identified as <code>{session.visitorId}</code></p>}
      <Timeline
        session={session}
        timeZone={timeZone}
        highlight={(search.filters?.length ?? 0) > 0}
        heading={
          <div className="timeline-head">
            <Link to="/projects/$projectId/sessions/$sessionId" params={{ projectId, sessionId }} search={sharedSearch(search)}>
              Started {formatStart(session.startedAt, timeZone)}
            </Link>
            <span className="dim">{formatDuration(session.duration)}, {formatCount(session.events)} {session.events === 1 ? "Event" : "Events"}</span>
          </div>
        }
      />
      <Link className="btn" style={{ marginTop: 24 }} to="/projects/$projectId/sessions/$sessionId" params={{ projectId, sessionId }} search={sharedSearch(search)}>
        Open Session
      </Link>
    </>
  )
}
