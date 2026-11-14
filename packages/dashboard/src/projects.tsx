// The Member's Projects: the Projects page (one table, with each Project's `production` numbers),
// New Project, and one Project's page, which shows the Dashboard, Live or Events tab.
import type { EventPropertyFilter, ProductionNumbers, ProjectId } from "@flock/shared"
import { Link, useNavigate } from "@tanstack/react-router"
import type { FormEvent } from "react"
import { request } from "./api.ts"
import { formatChange } from "./change.ts"
import { CustomEvents } from "./custom-events.tsx"
import { Dashboard } from "./dashboard.tsx"
import { formatCount } from "./format.ts"
import { Live } from "./live.tsx"
import { type ProjectSearch, reportQuery, withFilter, withQuery } from "./project-search.ts"
import { SessionPage } from "./sessions.tsx"
import { environmentOf, type ProjectChrome, Shell } from "./shell.tsx"
import { SPARK_WIDTH, Sparkline } from "./sparkline-chart.tsx"
import { Notice, Rows, useAction, wide } from "./ui.tsx"
import { VisitorPage, VisitorsList } from "./visitors.tsx"
import { usePoll } from "./use-poll.ts"

/** The browser's time zone, the default for a new Project. */
const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone

/**
 * A Project row's four number cells, for its `production` Environment: live Visitors, Visitors over
 * the last 7 days, the change against the 7 before, and the sparkline. Empty without `production`
 * (or before the numbers load).
 */
const NumberCells = ({ numbers }: { numbers: ProductionNumbers | null | undefined }) => {
  if (!numbers) {
    return (
      <>
        <span className="muted" {...wide}>–</span>
        <span className="muted">–</span>
        <span className="muted" {...wide}>–</span>
        <span />
      </>
    )
  }
  const change = formatChange(numbers.visitors, numbers.previousVisitors, "percent")
  return (
    <>
      <span className={numbers.live > 0 ? "live-count" : "muted"} {...wide}>{formatCount(numbers.live)}</span>
      <span>{formatCount(numbers.visitors)}</span>
      <span className="kpi-change" data-tone={change.tone} title="Against the 7 days before" {...wide}>{change.label}</span>
      <span className="spark-cell"><Sparkline values={numbers.series.map((d) => d.visitors)} label="Visitors per day" /></span>
    </>
  )
}

export const ProjectsPage = () => {
  const { data, error } = usePoll(() => request((api) => api.projects.list()), [])
  const { data: numbers } = usePoll(() => request((api) => api.projects.numbers()), [], 30_000)
  const numbersOf = new Map(numbers?.map((row) => [row.projectId, row.production]))
  return (
    <Shell section="projects">
      <div className="page">
        <div className="section-head">
          <h1>Projects</h1>
          <Link className="btn" to="/projects/new">New Project</Link>
        </div>
        {error && !data ? <Notice alert>Could not load Projects.</Notice> : null}
        {!data && !error ? <Notice>Loading…</Notice> : null}
        {data?.length === 0 ? <Notice>No Projects yet. Create one to get a key for the browser script.</Notice> : null}
        {data && data.length > 0 && (
          <Rows
            variant="end"
            columns={[
              { label: "Project" },
              { label: "Live", width: 56, wide: true },
              { label: "Visitors, 7 days", width: 120 },
              { label: "Change", width: 72, wide: true },
              { label: "Last 7 days", width: SPARK_WIDTH },
              { label: "Your role", width: 80, wide: true }
            ]}
          >
            {data.map((project) => (
              <Link key={project.id} role="row" className="row" to="/projects/$projectId" params={{ projectId: project.id }}>
                <span style={{ fontWeight: 500 }}>{project.name}</span>
                <NumberCells numbers={numbersOf.get(project.id)} />
                <span className="muted" style={{ fontFamily: "var(--sans)" }} {...wide}>{project.role === "owner" ? "Owner" : "Viewer"}</span>
              </Link>
            ))}
          </Rows>
        )}
      </div>
    </Shell>
  )
}

export const NewProjectPage = () => {
  const navigate = useNavigate()
  const action = useAction()
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const payload = { name: String(form.get("name")).trim(), timeZone: String(form.get("timeZone")).trim() }
    void action.run(async () => {
      const project = await request((api) => api.projects.create({ payload }))
      await navigate({ to: "/projects/$projectId/settings", params: { projectId: project.id } })
    })
  }
  return (
    <Shell section="new-project">
      <div className="page narrow">
        <h1>New Project</h1>
        <form onSubmit={submit} className="form">
          <label className="field">Name<input name="name" required maxLength={100} autoFocus /></label>
          <label className="field">
            Time zone (reports count days in this zone)
            <input name="timeZone" required defaultValue={browserTimeZone()} />
          </label>
          {action.alert}
          <div><button type="submit" className="btn" disabled={action.busy}>Create Project</button></div>
        </form>
      </div>
    </Shell>
  )
}

/** Loads a Project for a page under `/projects/$projectId`, and gives its chrome. */
export const useProject = (projectId: ProjectId) => usePoll(() => request((api) => api.projects.get({ params: { projectId } })), [projectId], 60_000)

/** Shown while a Project page has no Project yet: loading, or why it failed. */
const ProjectPending = ({ error }: { error: unknown }) => (
  <Shell section="projects">
    <div className="page">{error ? <Notice alert>{(error as Error).message}</Notice> : <Notice>Loading…</Notice>}</div>
  </Shell>
)

export const ProjectPage = ({ projectId, search }: { projectId: ProjectId; search: ProjectSearch }) => {
  const navigate = useNavigate()
  const { data: project, error } = useProject(projectId)
  if (!project) return <ProjectPending error={error} />
  const environment = environmentOf(project, search.env)
  const onSearch = (next: ProjectSearch) => void navigate({ to: "/projects/$projectId", params: { projectId }, search: next })
  const addFilter = (filter: EventPropertyFilter) => onSearch(withQuery(search, withFilter(reportQuery(search), filter)))
  const chrome: ProjectChrome = { project, search, onSearch, reports: true }
  // The Visitors tab exists only in persistent Tracking mode; a stale link falls back to the Dashboard.
  const persistent = project.trackingMode === "persistent"
  const section = search.tab === "visitors" && !persistent ? "dashboard" : search.tab ?? "dashboard"
  return (
    <Shell section={section} chrome={chrome}>
      {section === "dashboard" && (
        <Dashboard key={environment.id} projectId={projectId} environment={environment} search={search} timeZone={project.timeZone} isOwner={project.role === "owner"} onAddFilter={addFilter} />
      )}
      {section === "live" && <Live key={environment.id} projectId={projectId} environment={environment} search={search} timeZone={project.timeZone} />}
      {section === "visitors" && persistent && (
        <VisitorsList
          key={environment.id}
          projectId={projectId}
          environment={environment}
          search={search}
          timeZone={project.timeZone}
          onSearch={(q) => void navigate({ to: "/projects/$projectId", params: { projectId }, search: { ...search, q }, replace: true })}
        />
      )}
      {section === "events" && <CustomEvents key={environment.id} projectId={projectId} environment={environment} search={search} onAddFilter={addFilter} />}
    </Shell>
  )
}

export const ProjectSessionPage = ({ projectId, sessionId, search }: { projectId: ProjectId; sessionId: string; search: ProjectSearch }) => {
  const navigate = useNavigate()
  const { data: project, error } = useProject(projectId)
  if (!project) return <ProjectPending error={error} />
  const onSearch = (next: ProjectSearch) =>
    void navigate({ to: "/projects/$projectId/sessions/$sessionId", params: { projectId, sessionId }, search: next })
  return (
    <Shell section="session" chrome={{ project, search, onSearch }}>
      <SessionPage
        key={sessionId}
        projectId={projectId}
        environment={environmentOf(project, search.env)}
        sessionId={sessionId}
        search={search}
        timeZone={project.timeZone}
      />
    </Shell>
  )
}

export const ProjectVisitorPage = ({ projectId, visitorId, search }: { projectId: ProjectId; visitorId: string; search: ProjectSearch }) => {
  const navigate = useNavigate()
  const { data: project, error } = useProject(projectId)
  if (!project) return <ProjectPending error={error} />
  const onSearch = (next: ProjectSearch) =>
    void navigate({ to: "/projects/$projectId/visitors/$visitorId", params: { projectId, visitorId }, search: next })
  const environment = environmentOf(project, search.env)
  return (
    <Shell section="visitor" chrome={{ project, search, onSearch }}>
      <VisitorPage key={`${environment.id}-${visitorId}`} projectId={projectId} environment={environment} visitorId={visitorId} search={search} timeZone={project.timeZone} />
    </Shell>
  )
}
