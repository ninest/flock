// The page chrome: the top bar (Project switcher, Environment switcher, tabs, Filter button,
// date range, account menu) and, under it, a bar for custom dates and Filters that shows only
// while there is something in it. On a phone the tabs move to a bottom bar.
import { type Environment, PRODUCTION, type Project, type ReportPeriod, type ReportRangeQuery } from "@flock/shared"
import { Link, useNavigate } from "@tanstack/react-router"
import { type ReactNode, useState } from "react"
import { request } from "./api.ts"
import { signOut } from "./auth.ts"
import { AddFilter, FilterChips } from "./filters.tsx"
import { formatCount } from "./format.ts"
import { type ProjectSearch, type ProjectTab, reportQuery, sharedSearch, withFilter, withQuery } from "./project-search.ts"
import { Dropdown, useIsPhone, useMember } from "./ui.tsx"
import { usePoll } from "./use-poll.ts"

/** Which page is showing, so the right tab and menu item are marked. */
export type Section = "dashboard" | ProjectTab | "session" | "visitor" | "settings" | "projects" | "new-project" | "instance"

/** The Environment the search params pick: `?env=dev`, or `production`. */
export const environmentOf = (project: Project, env: string | undefined): Environment =>
  project.environments.find((e) => e.name === (env ?? PRODUCTION)) ?? project.environments[0]!

export interface ProjectChrome {
  readonly project: Project
  readonly search: ProjectSearch
  /** Changes the search params of the current page. */
  readonly onSearch: (search: ProjectSearch) => void
  /** Shows the date range and the Filter button (the report tabs). */
  readonly reports?: boolean
}

export const Shell = ({ section, chrome, children }: { section: Section; chrome?: ProjectChrome; children: ReactNode }) => {
  const [adding, setAdding] = useState(false)
  const query = chrome ? reportQuery(chrome.search) : undefined
  const environment = chrome ? environmentOf(chrome.project, chrome.search.env) : undefined
  const setQuery = (next: ReportRangeQuery) => chrome?.onSearch(withQuery(chrome.search, next))
  const filters = query?.filters ?? []
  const showDates = chrome?.reports && query?.period === "custom"
  return (
    <>
      <header className="topbar">
        <div className="topbar-start">
          <ProjectSwitcher section={section} chrome={chrome} />
          {chrome && chrome.project.environments.length > 1 && <EnvironmentSwitcher section={section} chrome={chrome} />}
        </div>
        {chrome && environment && <Tabs section={section} chrome={chrome} environment={environment} />}
        <div className="topbar-end">
          {chrome?.reports && query && (
            <>
              <button type="button" className="top-button" aria-expanded={adding} onClick={() => setAdding(!adding)}>Filter</button>
              <RangePicker query={query} onChange={setQuery} />
            </>
          )}
          <AccountMenu />
        </div>
      </header>
      {chrome && query && environment && (showDates || filters.length > 0 || adding) && (
        <div className="subbar" data-testid="filters">
          {showDates && <CustomDates query={query} onChange={setQuery} />}
          <FilterChips filters={filters} onChange={(next) => setQuery({ ...query, filters: next })} />
          {adding && (
            <AddFilter
              environment={environment}
              onAdd={(filter) => {
                setQuery(withFilter(query, filter))
                setAdding(false)
              }}
              onCancel={() => setAdding(false)}
            />
          )}
        </div>
      )}
      <main>{children}</main>
    </>
  )
}

/** Top left: the current Project, and a menu to switch to another, see them all, or make one. */
const ProjectSwitcher = ({ section, chrome }: { section: Section; chrome: ProjectChrome | undefined }) => {
  const { data: projects } = usePoll(() => request((api) => api.projects.list()), [], 60_000)
  const current = chrome?.project
  const label = current?.name ?? (section === "instance" ? "Instance" : section === "new-project" ? "New Project" : "All Projects")
  // Switching Projects keeps the date range and Filters, not the Environment (it may not exist there).
  const carried = chrome ? withQuery({}, reportQuery(chrome.search)) : {}
  return (
    <Dropdown label={<span className="project-name">{label}</span>}>
      {projects?.map((p) => (
        <Link key={p.id} to="/projects/$projectId" params={{ projectId: p.id }} search={carried} role="menuitem" className="menu-item" data-current={p.id === current?.id}>
          {p.name}
        </Link>
      ))}
      {projects && projects.length > 0 && <hr />}
      <Link to="/" role="menuitem" className="menu-item" data-current={section === "projects"}>All Projects</Link>
      <Link to="/projects/new" role="menuitem" className="menu-item" data-current={section === "new-project"}>New Project</Link>
      {current && (
        <>
          <hr />
          <Link
            to="/projects/$projectId/settings"
            params={{ projectId: current.id }}
            search={sharedSearch(chrome.search)}
            role="menuitem"
            className="menu-item"
            data-current={section === "settings"}
          >
            {current.role === "owner" ? "Project settings" : "Sharing"}
          </Link>
        </>
      )}
    </Dropdown>
  )
}

/** Next to the Project switcher, when the Project has more than one Environment. */
const EnvironmentSwitcher = ({ section, chrome }: { section: Section; chrome: ProjectChrome }) => {
  const navigate = useNavigate()
  const projectId = chrome.project.id
  const current = environmentOf(chrome.project, chrome.search.env)
  const pick = (name: string) => {
    const search = withQuery(name === PRODUCTION ? {} : { env: name }, reportQuery(chrome.search))
    if (section === "settings") return navigate({ to: "/projects/$projectId/settings", params: { projectId }, search })
    // A Session belongs to one Environment, so switching leaves the Session page for the Dashboard.
    const tab = section === "live" || section === "events" || section === "visitors" ? { tab: section } : {}
    return navigate({ to: "/projects/$projectId", params: { projectId }, search: { ...search, ...tab } })
  }
  return (
    <Dropdown label={<span className="env-name">{current.name}</span>} testId="environment-switcher" ariaLabel={`Environment: ${current.name}`}>
      {chrome.project.environments.map((e) => (
        <button key={e.id} type="button" role="menuitem" className="menu-item" data-current={e.id === current.id} onClick={() => void pick(e.name)}>
          {e.name}
        </button>
      ))}
    </Dropdown>
  )
}

/** Dashboard, Live (with how many Visitors are here now), Events, and Visitors in persistent Tracking mode. */
const Tabs = ({ section, chrome, environment }: { section: Section; chrome: ProjectChrome; environment: Environment }) => {
  const filters = chrome.search.filters
  const { data: live } = usePoll(
    () => request((api) => api.reports.live({ params: { environmentId: environment.id }, query: { filters } })),
    [environment.id, JSON.stringify(filters ?? [])],
    10_000
  )
  const base = sharedSearch(chrome.search)
  // Only the tab itself is current, not a page under it such as a Session.
  const exact = { exact: true }
  const params = { projectId: chrome.project.id }
  return (
    <nav className="tabs" aria-label="Reports">
      <Link to="/projects/$projectId" params={params} activeOptions={exact} search={base} aria-current={section === "dashboard" ? "page" : undefined}>Dashboard</Link>
      <Link to="/projects/$projectId" params={params} activeOptions={exact} search={{ ...base, tab: "live" }} aria-current={section === "live" ? "page" : undefined}>
        Live
        {live !== undefined && live.visitors > 0 && (
          <em data-testid="live-visitors" title={`${formatCount(live.visitors)} ${live.visitors === 1 ? "Visitor" : "Visitors"} in the last 30 minutes`}>
            {formatCount(live.visitors)}
          </em>
        )}
      </Link>
      <Link to="/projects/$projectId" params={params} activeOptions={exact} search={{ ...base, tab: "events" }} aria-current={section === "events" ? "page" : undefined}>Events</Link>
      {chrome.project.trackingMode === "persistent" && (
        <Link to="/projects/$projectId" params={params} activeOptions={exact} search={{ ...base, tab: "visitors" }} aria-current={section === "visitors" ? "page" : undefined}>
          Visitors
        </Link>
      )}
    </nav>
  )
}

const shortDate = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })

/** A browser-local date `days` ago, as `2026-03-01`. */
const localDate = (days = 0) => {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

const PERIODS: ReadonlyArray<{ value: Exclude<ReportPeriod, "custom">; label: string }> = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" }
]

/** Today, 7 days, 30 days or Custom. Custom starts as the last 7 days; its dates are set under the top bar. */
const RangePicker = ({ query, onChange }: { query: ReportRangeQuery; onChange: (query: ReportRangeQuery) => void }) => {
  const phone = useIsPhone()
  const pick = (period: ReportPeriod) =>
    onChange(
      period === "custom"
        ? { period, from: query.from ?? localDate(6), to: query.to ?? localDate(), filters: query.filters }
        : { period, filters: query.filters }
    )
  const customLabel = query.period === "custom" && query.from && query.to
    ? query.from === query.to ? shortDate(query.from) : `${shortDate(query.from)} to ${shortDate(query.to)}`
    : "Custom"
  if (phone) {
    return (
      <select className="range-select" value={query.period} onChange={(e) => pick(e.target.value as ReportPeriod)} aria-label="Date range" data-testid="date-range">
        {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        <option value="custom">{customLabel}</option>
      </select>
    )
  }
  return (
    <div className="seg" role="group" aria-label="Date range" data-testid="date-range">
      {PERIODS.map((p) => (
        <button key={p.value} type="button" aria-pressed={query.period === p.value} onClick={() => pick(p.value)}>{p.label}</button>
      ))}
      <button type="button" aria-pressed={query.period === "custom"} onClick={() => pick("custom")}>{customLabel}</button>
    </div>
  )
}

/** The two dates of a custom range, in the Project's time zone. A range applies once both are set and in order. */
const CustomDates = ({ query, onChange }: { query: ReportRangeQuery; onChange: (query: ReportRangeQuery) => void }) => {
  const [from, setFrom] = useState(query.from ?? "")
  const [to, setTo] = useState(query.to ?? "")
  const apply = (f: string, t: string) => {
    setFrom(f)
    setTo(t)
    if (f && t && f <= t) onChange({ period: "custom", from: f, to: t, filters: query.filters })
  }
  return (
    <div className="subbar-dates">
      <input type="date" value={from} max={to || undefined} onChange={(e) => apply(e.target.value, to)} aria-label="From" />
      to
      <input type="date" value={to} min={from || undefined} onChange={(e) => apply(from, e.target.value)} aria-label="To" />
    </div>
  )
}

/** Top right: who is signed in, the Instance page for admins, and Sign out. */
const AccountMenu = () => {
  const member = useMember()
  const navigate = useNavigate()
  if (!member) return null
  return (
    <Dropdown label={member.name.trim().charAt(0).toUpperCase() || "?"} buttonClass="avatar" chevron={false} end ariaLabel="Account">
      <div className="menu-text">
        <div style={{ color: "var(--ink)", fontWeight: 500 }}>{member.name}</div>
        {member.email}
        {member.isAdmin ? <div>Instance admin</div> : null}
      </div>
      <hr />
      {member.isAdmin && <Link to="/instance" role="menuitem" className="menu-item">Instance</Link>}
      <button type="button" role="menuitem" className="menu-item" onClick={() => void signOut().then(() => navigate({ to: "/sign-in" }))}>
        Sign out
      </button>
    </Dropdown>
  )
}
