// A Project's settings page: the current Environment's key, snippet and allowed origins, adding an
// Environment, the Project's name, time zone and Tracking mode, deletion, its Annotations, and
// sharing. Viewers see only the Annotations and who the Project is shared with; the controls they
// can't use are hidden.
import {
  type Environment,
  type MemberId,
  PRODUCTION,
  type Project,
  type ProjectId,
  type ProjectRole,
  type TrackingMode
} from "@flock/shared"
import { useNavigate } from "@tanstack/react-router"
import { type FormEvent, type ReactNode, useState } from "react"
import { request } from "./api.ts"
import { currentMember } from "./auth.ts"
import { AnnotationList } from "./chart-annotations.tsx"
import { useProject } from "./projects.tsx"
import { type ProjectSearch, sharedSearch } from "./project-search.ts"
import { environmentOf, Shell } from "./shell.tsx"
import { Notice, useAction } from "./ui.tsx"
import { usePoll } from "./use-poll.ts"

const Section = ({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) => (
  <section className="settings-section" data-testid={testId}>
    <h2>{title}</h2>
    {children}
  </section>
)

export const SettingsPage = ({ projectId, search }: { projectId: ProjectId; search: ProjectSearch }) => {
  const navigate = useNavigate()
  const { data: project, error, reload } = useProject(projectId)
  if (!project) {
    return (
      <Shell section="settings">
        <div className="page">{error ? <Notice alert>{(error as Error).message}</Notice> : <Notice>Loading…</Notice>}</div>
      </Shell>
    )
  }
  const environment = environmentOf(project, search.env)
  const selectEnvironment = (name: string) =>
    navigate({ to: "/projects/$projectId/settings", params: { projectId }, search: { ...sharedSearch(search), env: name === PRODUCTION ? undefined : name } })
  const onSearch = (next: ProjectSearch) => void navigate({ to: "/projects/$projectId/settings", params: { projectId }, search: next })
  return (
    <Shell section="settings" chrome={{ project, search, onSearch }}>
      <div className="page narrow">
        <h1>{project.role === "owner" ? "Project settings" : "Sharing"}</h1>
        {project.role === "owner"
          ? (
            <>
              <EnvironmentSettings
                key={`settings-${environment.id}`}
                environment={environment}
                trackingMode={project.trackingMode}
                onChange={reload}
                onDeleted={async () => {
                  await selectEnvironment(PRODUCTION)
                  await reload()
                }}
              />
              <AddEnvironment project={project} onAdded={async (name) => {
                await reload()
                await selectEnvironment(name)
              }} />
              <ProjectSettings project={project} onChange={reload} />
            </>
          )
          : <p className="dim">You're a viewer of {project.name}: you see its reports for every Environment but can't change it.</p>}
        <Annotations project={project} />
        <Sharing project={project} onChange={reload} />
      </div>
    </Shell>
  )
}

const EnvironmentSettings = (props: {
  environment: Environment
  trackingMode: TrackingMode
  onChange: () => Promise<void>
  onDeleted: () => Promise<void>
}) => {
  const { environment } = props
  const action = useAction()
  const environmentId = environment.id
  const isProduction = environment.name === PRODUCTION
  const confirmThen = (message: string, f: () => Promise<unknown>) => {
    if (window.confirm(message)) void action.run(f)
  }
  return (
    <Section title={`Environment: ${environment.name}`}>
      <div>
        <div className="dim">Public key, for the browser script and the ingest API</div>
        <div className="key">{environment.key}</div>
      </div>
      <pre className="snippet">
        {`<script defer src="${window.location.origin}/flock.js" data-key="${environment.key}" data-mode="${props.trackingMode}"></script>`}
      </pre>
      <div className="actions">
        <button
          type="button"
          className="btn"
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
              className="btn btn-danger"
              disabled={action.busy}
              onClick={() =>
                confirmThen(`Delete all Events in ${environment.name}? This can't be undone.`, () =>
                  request((api) => api.environments.deleteEvents({ params: { environmentId } })))}
            >
              Delete all Events
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={action.busy}
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
    <form onSubmit={submit} className="form" style={{ maxWidth: "none" }}>
      {environment.allowedOrigins.length === 0
        ? <p role="status" className="warning">Any public website can send Events with this key. Add your website's origin.</p>
        : null}
      <label className="field">
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
      <p className="dim">
        One host per line: <code>blog.example.com</code>, <code>*.example.com</code> for subdomains, <code>localhost</code>, or{" "}
        <code>*</code> for any origin. Leave it empty to accept any public website and reject localhost and private networks.
        Requests from servers and apps (no <code>Origin</code> header) are always accepted.
      </p>
      <div className="actions" style={{ alignItems: "center" }}>
        <button type="submit" className="btn" disabled={action.busy}>Save origins</button>
        {saved ? <span className="dim">Saved.</span> : null}
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
      <p className="dim">A separate data stream with its own key, such as <code>dev</code> for testing.</p>
      <form onSubmit={submit} className="inline-form">
        <input name="name" required placeholder="dev" pattern="[a-z][a-z0-9\-]{0,31}" title="Lowercase letters, digits and dashes" aria-label="Environment name" />
        <button type="submit" className="btn" disabled={action.busy}>Add</button>
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
      !window.confirm(`Switch to ${trackingMode} Tracking mode? Visitor counts start afresh, and the script snippet must be updated on your websites.`)
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
    <Section title="Project">
      <form onSubmit={submit} className="form">
        <label className="field">Name<input name="name" required maxLength={100} defaultValue={project.name} /></label>
        <label className="field">Time zone<input name="timeZone" required defaultValue={project.timeZone} /></label>
        <label className="field">
          Tracking mode
          <select name="trackingMode" defaultValue={project.trackingMode}>
            <option value="cookieless">Cookieless: anonymous Visitors that reset daily, nothing stored on the device</option>
            <option value="persistent">Persistent: a Visitor ID stored on the device, with identify()</option>
          </select>
        </label>
        <div><button type="submit" className="btn" disabled={action.busy}>Save</button></div>
      </form>
      <div><button type="button" className="btn btn-danger" disabled={action.busy} onClick={remove}>Delete Project</button></div>
      {action.alert}
    </Section>
  )
}

/** Every Annotation of the Project, newest first, whatever its Environments. Owners edit and delete them. */
const Annotations = ({ project }: { project: Project }) => {
  const projectId = project.id
  const { data, error, reload } = usePoll(() => request((api) => api.annotations.list({ params: { projectId } })), [projectId])
  return (
    <Section title="Annotations" testId="annotations">
      <p className="dim">
        Dated notes drawn on the overview and Custom event charts.{project.role === "owner" ? " Add one from the overview chart." : ""}
      </p>
      {!data
        ? error ? <Notice alert>Could not load the Annotations.</Notice> : <Notice>Loading…</Notice>
        : data.length === 0
        ? <Notice>No Annotations yet.</Notice>
        : (
          <AnnotationList
            projectId={projectId}
            annotations={data}
            environments={project.environments}
            timeZone={project.timeZone}
            isOwner={project.role === "owner"}
            onChange={reload}
          />
        )}
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
      <p className="dim">Owners manage the Project. Viewers see its reports for every Environment.</p>
      <ul className="people" data-testid="project-members">
        {members?.map((m) => (
          <li key={m.id}>
            <span>{m.name}<br /><span className="dim">{m.email}</span></span>
            {isOwner
              ? (
                <>
                  <select aria-label={`Role of ${m.email}`} value={m.role} disabled={action.busy} onChange={(e) => setRole(m.id, e.target.value as ProjectRole)}>
                    <option value="owner">Owner</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <button type="button" className="btn btn-danger" disabled={action.busy} onClick={() => remove(m.id, m.email)}>Remove</button>
                </>
              )
              : <span className="dim">{m.role === "owner" ? "Owner" : "Viewer"}</span>}
          </li>
        ))}
      </ul>
      {isOwner
        ? (
          <form onSubmit={add} className="inline-form">
            <input name="email" type="email" required placeholder="Member's email" aria-label="Member's email" />
            <select name="role" defaultValue="viewer" aria-label="Role">
              <option value="viewer">Viewer</option>
              <option value="owner">Owner</option>
            </select>
            <button type="submit" className="btn" disabled={action.busy}>Share</button>
          </form>
        )
        : null}
      {action.alert}
    </Section>
  )
}
