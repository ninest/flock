// The Member's Projects: the Project list, creating a Project, and one Project's
// page with its Environment switcher, settings and sharing. Viewers see only the
// reports and who the Project is shared with; the controls they can't use are hidden.
import {
  type Environment,
  type EnvironmentId,
  type MemberId,
  PRODUCTION,
  type Project,
  type ProjectId,
  type ProjectRole,
  type PropertyFilter,
  type ReportRangeQuery,
  type TrackingMode
} from "@flock/shared"
import { Link, useNavigate } from "@tanstack/react-router"
import { type CSSProperties, type FormEvent, type ReactNode, useState } from "react"
import { request } from "./api.ts"
import { OverviewReport } from "./overview.tsx"
import { AudienceReports } from "./audience.tsx"
import { LiveVisitors, PagesAndSources } from "./pages-sources.tsx"
import { CustomEventsReport } from "./custom-events.tsx"
import { currentMember } from "./auth.ts"
import { FilterBar, type ProjectSearch, reportQuery, searchFor, withFilter } from "./filters.tsx"
import { usePoll } from "./use-poll.ts"

const muted: CSSProperties = { fontSize: 14, color: "#666" }
const card: CSSProperties = { border: "1px solid #ccc", borderRadius: 8, padding: 12 }
const danger: CSSProperties = { color: "#b00020" }

/** The browser's time zone, the default for a new Project. */
const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone

/** Runs an action, showing its error to the Member. Returns whether it succeeded. */
const useAction = () => {
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError(undefined)
    try {
      await action()
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }
  const alert = error ? <p role="alert" style={{ ...danger, margin: 0 }}>{error}</p> : null
  return { run, busy, alert }
}

export const ProjectsPage = () => {
  const { data, error } = usePoll(() => request((api) => api.projects.list()), [])
  return (
    <>
      <h2>Projects</h2>
      {error && !data ? <p role="alert">Could not load Projects.</p> : null}
      {!data && !error ? <p>Loading…</p> : null}
      {data?.length === 0 ? <p>No Projects yet. Create one to get a key for the browser script.</p> : null}
      <ul style={{ paddingLeft: 20 }}>
        {data?.map((project) => (
          <li key={project.id}>
            <Link to="/projects/$projectId" params={{ projectId: project.id }}>{project.name}</Link>{" "}
            <span style={muted}>
              · {project.environments.length} Environment{project.environments.length === 1 ? "" : "s"}
              {project.role === "viewer" ? " · viewer" : ""}
            </span>
          </li>
        ))}
      </ul>
      <CreateProject />
    </>
  )
}

const CreateProject = () => {
  const navigate = useNavigate()
  const action = useAction()
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const payload = { name: String(form.get("name")).trim(), timeZone: String(form.get("timeZone")).trim() }
    void action.run(async () => {
      const project = await request((api) => api.projects.create({ payload }))
      await navigate({ to: "/projects/$projectId", params: { projectId: project.id } })
    })
  }
  return (
    <form onSubmit={submit} style={{ ...card, display: "grid", gap: 8, maxWidth: 360 }}>
      <strong>New Project</strong>
      <label style={{ display: "grid", gap: 4 }}>Name<input name="name" required maxLength={100} /></label>
      <label style={{ display: "grid", gap: 4 }}>
        Time zone<input name="timeZone" required defaultValue={browserTimeZone()} />
      </label>
      {action.alert}
      <button type="submit" disabled={action.busy}>Create Project</button>
    </form>
  )
}

export const ProjectPage = ({ projectId, search }: { projectId: ProjectId; search: ProjectSearch }) => {
  const navigate = useNavigate()
  const { data: project, error, reload } = usePoll(() => request((api) => api.projects.get({ params: { projectId } })), [projectId])
  const env = search.env
  // The date range and filters every report follows, kept in the URL. The overview's picker
  // sets the range; the filter bar and clicks on report rows set the filters.
  const range = reportQuery(search)
  const setRange = (query: ReportRangeQuery) =>
    void navigate({ to: "/projects/$projectId", params: { projectId }, search: { ...(env ? { env } : {}), ...searchFor(query) } })
  const addFilter = (filter: PropertyFilter) => setRange(withFilter(range, filter))
  if (error && !project) return <p role="alert">{(error as Error).message}</p>
  if (!project) return <p>Loading…</p>

  const environment = project.environments.find((e) => e.name === (env ?? PRODUCTION)) ?? project.environments[0]!
  const select = (name: string) =>
    navigate({
      to: "/projects/$projectId",
      params: { projectId },
      search: { ...(name === PRODUCTION ? {} : { env: name }), ...searchFor(range) }
    })

  return (
    <>
      <h2 style={{ marginBottom: 4 }}>{project.name}</h2>
      <p style={{ ...muted, marginTop: 0 }}>
        Time zone {project.timeZone} · Tracking mode {project.trackingMode}
        {project.role === "viewer" ? " · You're a viewer of this Project" : ""}
      </p>
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
        Environment
        <select value={environment.name} onChange={(e) => void select(e.target.value)} data-testid="environment-switcher">
          {project.environments.map((e) => <option key={e.id} value={e.name}>{e.name}</option>)}
        </select>
      </label>
      <LiveVisitors key={`live-${environment.id}`} environment={environment} filters={range.filters} />
      </div>
      <FilterBar environment={environment} query={range} onChange={setRange} />
      <OverviewReport key={environment.id} environment={environment} timeZone={project.timeZone} query={range} onQueryChange={setRange} />
      <PagesAndSources key={`pages-${environment.id}`} environment={environment} range={range} onAddFilter={addFilter} />
      <AudienceReports key={`audience-${environment.id}`} environment={environment} range={range} onAddFilter={addFilter} />
      <CustomEventsReport key={`custom-events-${environment.id}`} environment={environment} range={range} onAddFilter={addFilter} />
      {project.role === "owner"
        ? (
          <>
            <EnvironmentSettings
              key={`settings-${environment.id}`}
              environment={environment}
              trackingMode={project.trackingMode}
              onChange={reload}
              onDeleted={async () => {
                await select(PRODUCTION)
                await reload()
              }}
            />
            <AddEnvironment project={project} onAdded={async (name) => {
              await reload()
              await select(name)
            }} />
            <ProjectSettings project={project} onChange={reload} />
          </>
        )
        : null}
      <Sharing project={project} onChange={reload} />
    </>
  )
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section style={{ ...card, display: "grid", gap: 8, margin: "12px 0" }}>
    <strong>{title}</strong>
    {children}
  </section>
)

const EnvironmentSettings = (props: {
  environment: Environment
  trackingMode: TrackingMode
  onChange: () => Promise<void>
  onDeleted: () => Promise<void>
}) => {
  const { environment } = props
  const action = useAction()
  const environmentId: EnvironmentId = environment.id
  const isProduction = environment.name === PRODUCTION
  const confirmThen = (message: string, f: () => Promise<unknown>) => {
    if (window.confirm(message)) void action.run(f)
  }
  return (
    <Section title={`Environment: ${environment.name}`}>
      <div>
        <div style={muted}>Public key (for the browser script and the ingest API)</div>
        <code style={{ wordBreak: "break-all" }}>{environment.key}</code>
      </div>
      <pre style={{ fontSize: 12, background: "#f5f5f5", padding: 8, overflowX: "auto", margin: 0 }}>
        {`<script defer src="${window.location.origin}/flock.js" data-key="${environment.key}" data-mode="${props.trackingMode}"></script>`}
      </pre>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          disabled={action.busy}
          onClick={() =>
            confirmThen(`Rotate the ${environment.name} key? The current key stops working immediately.`, async () => {
              await request((api) => api.environments.rotateKey({ params: { environmentId } }))
              await props.onChange()
            })}
        >
          Rotate key
        </button>
        {isProduction ? null : (
          <>
            <button
              type="button"
              disabled={action.busy}
              style={danger}
              onClick={() =>
                confirmThen(`Delete all Events in ${environment.name}? This can't be undone.`, () =>
                  request((api) => api.environments.deleteEvents({ params: { environmentId } })))}
            >
              Delete all Events
            </button>
            <button
              type="button"
              disabled={action.busy}
              style={danger}
              onClick={() =>
                confirmThen(`Delete the ${environment.name} Environment, its key and its Events?`, async () => {
                  await request((api) => api.environments.delete({ params: { environmentId } }))
                  await props.onDeleted()
                })}
            >
              Delete Environment
            </button>
          </>
        )}
      </div>
      {action.alert}
      <AllowedOrigins environment={environment} onChange={props.onChange} />
    </Section>
  )
}

/** Edits the browser origins an Environment accepts Events from, one host per line. */
const AllowedOrigins = ({ environment, onChange }: { environment: Environment; onChange: () => Promise<void> }) => {
  const action = useAction()
  const [saved, setSaved] = useState(false)
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const allowedOrigins = String(new FormData(event.currentTarget).get("allowedOrigins"))
      .split(/[\s,]+/)
      .map((line) => line.trim())
      .filter((line) => line !== "")
    setSaved(false)
    void action.run(async () => {
      await request((api) => api.environments.update({ params: { environmentId: environment.id }, payload: { allowedOrigins } }))
      await onChange()
      setSaved(true)
    })
  }
  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 4, maxWidth: 480 }}>
      {environment.allowedOrigins.length === 0
        ? (
          <p role="status" style={{ margin: 0, padding: "8px 12px", border: "1px solid #e0b400", background: "#fff8db", borderRadius: 4 }}>
            ⚠ Any public website can send Events with this key. Add your site's origin.
          </p>
        )
        : null}
      <label style={{ display: "grid", gap: 4 }}>
        Allowed origins
        <textarea
          key={`${environment.id}:${environment.allowedOrigins.join(",")}`}
          name="allowedOrigins"
          rows={4}
          spellCheck={false}
          defaultValue={environment.allowedOrigins.join("\n")}
          placeholder={"blog.example.com\n*.example.com"}
        />
      </label>
      <span style={muted}>
        One host per line: <code>blog.example.com</code>, <code>*.example.com</code> (subdomains), <code>localhost</code>, or{" "}
        <code>*</code> for any origin. Leave empty to accept any public website and reject localhost and private networks.
        Requests from servers and apps (no <code>Origin</code> header) are always accepted.
      </span>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button type="submit" disabled={action.busy}>Save origins</button>
        {saved ? <span style={muted}>Saved.</span> : null}
      </div>
      {action.alert}
    </form>
  )
}

const AddEnvironment = ({ project, onAdded }: { project: Project; onAdded: (name: string) => Promise<void> }) => {
  const action = useAction()
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const name = String(new FormData(form).get("name")).trim()
    void action.run(async () => {
      await request((api) => api.projects.addEnvironment({ params: { projectId: project.id }, payload: { name } }))
      form.reset()
      await onAdded(name)
    })
  }
  return (
    <Section title="Add an Environment">
      <form onSubmit={submit} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input name="name" required placeholder="dev" pattern="[a-z][a-z0-9\-]{0,31}" title="Lowercase letters, digits and dashes" />
        <button type="submit" disabled={action.busy}>Add</button>
      </form>
      {action.alert}
    </Section>
  )
}

const ProjectSettings = ({ project, onChange }: { project: Project; onChange: () => Promise<void> }) => {
  const navigate = useNavigate()
  const action = useAction()
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const trackingMode = form.get("trackingMode") as TrackingMode
    const payload = { name: String(form.get("name")).trim(), timeZone: String(form.get("timeZone")).trim(), trackingMode }
    if (
      trackingMode !== project.trackingMode &&
      !window.confirm(`Switch to ${trackingMode} Tracking mode? Visitor counts start afresh, and the script snippet must be updated on your sites.`)
    ) return
    void action.run(async () => {
      await request((api) => api.projects.update({ params: { projectId: project.id }, payload }))
      await onChange()
    })
  }
  const remove = () => {
    if (!window.confirm(`Delete ${project.name} with all its Environments and Events? This can't be undone.`)) return
    void action.run(async () => {
      await request((api) => api.projects.delete({ params: { projectId: project.id } }))
      await navigate({ to: "/" })
    })
  }
  return (
    <Section title="Project settings">
      <form onSubmit={submit} style={{ display: "grid", gap: 8, maxWidth: 360 }}>
        <label style={{ display: "grid", gap: 4 }}>Name<input name="name" required maxLength={100} defaultValue={project.name} /></label>
        <label style={{ display: "grid", gap: 4 }}>
          Time zone<input name="timeZone" required defaultValue={project.timeZone} />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          Tracking mode
          <select name="trackingMode" defaultValue={project.trackingMode}>
            <option value="cookieless">Cookieless: anonymous Visitors that reset daily, nothing stored on the device</option>
            <option value="persistent">Persistent: a Visitor ID stored on the device, with identify()</option>
          </select>
        </label>
        <button type="submit" disabled={action.busy}>Save</button>
      </form>
      <div>
        <button type="button" disabled={action.busy} style={danger} onClick={remove}>Delete Project</button>
      </div>
      {action.alert}
    </Section>
  )
}

/** Who the Project is shared with. Owners add Members, change roles and remove people. */
const Sharing = ({ project, onChange }: { project: Project; onChange: () => Promise<void> }) => {
  const navigate = useNavigate()
  const projectId = project.id
  const isOwner = project.role === "owner"
  const { data: members, reload } = usePoll(() => request((api) => api.projects.members({ params: { projectId } })), [projectId])
  const action = useAction()
  const afterChange = async () => {
    await reload()
    // Changing your own role or leaving changes what you may see.
    await onChange()
  }
  const setRole = (memberId: MemberId, role: ProjectRole) =>
    void action.run(async () => {
      await request((api) => api.projects.changeMemberRole({ params: { projectId, memberId }, payload: { role } }))
      await afterChange()
    })
  const remove = (memberId: MemberId, email: string) => {
    if (!window.confirm(`Remove ${email} from ${project.name}?`)) return
    void action.run(async () => {
      await request((api) => api.projects.removeMember({ params: { projectId, memberId } }))
      // Leaving the Project: it's gone from your list.
      if ((await currentMember())?.id === memberId) return navigate({ to: "/" })
      await afterChange()
    })
  }
  const add = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const payload = { email: String(data.get("email")).trim(), role: String(data.get("role")) as ProjectRole }
    void action.run(async () => {
      await request((api) => api.projects.addMember({ params: { projectId }, payload }))
      form.reset()
      await reload()
    })
  }
  return (
    <Section title="Sharing">
      <p style={{ ...muted, margin: 0 }}>Owners manage the Project; viewers see its reports for every Environment.</p>
      <ul style={{ paddingLeft: 20, margin: 0 }} data-testid="project-members">
        {members?.map((m) => (
          <li key={m.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "2px 0" }}>
            <span>{m.name} <span style={muted}>{m.email}</span></span>
            {isOwner
              ? (
                <>
                  <select
                    aria-label={`Role of ${m.email}`}
                    value={m.role}
                    disabled={action.busy}
                    onChange={(e) => setRole(m.id, e.target.value as ProjectRole)}
                  >
                    <option value="owner">owner</option>
                    <option value="viewer">viewer</option>
                  </select>
                  <button type="button" disabled={action.busy} style={danger} onClick={() => remove(m.id, m.email)}>Remove</button>
                </>
              )
              : <span style={muted}>· {m.role}</span>}
          </li>
        ))}
      </ul>
      {isOwner
        ? (
          <form onSubmit={add} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input name="email" type="email" required placeholder="Member's email" aria-label="Member's email" />
            <select name="role" defaultValue="viewer" aria-label="Role">
              <option value="viewer">viewer</option>
              <option value="owner">owner</option>
            </select>
            <button type="submit" disabled={action.busy}>Share</button>
          </form>
        )
        : null}
      {action.alert}
    </Section>
  )
}
