import type { Environment, Project } from "@flock/shared"
import { createRootRoute, createRoute, createRouter, Link, Outlet } from "@tanstack/react-router"
import { DateTime } from "effect"
import { request } from "./api.ts"
import { usePoll } from "./use-poll.ts"

const rootRoute = createRootRoute({
  component: () => (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 720, margin: "0 auto", padding: 16 }}>
      <h1><Link to="/" style={{ color: "inherit", textDecoration: "none" }}>Flock</Link></h1>
      <Outlet />
    </main>
  )
})

const ProjectsPage = () => {
  const { data, error } = usePoll(() => request((api) => api.projects.list()), [])
  if (error && !data) return <p role="alert">Could not load Projects.</p>
  if (!data) return <p>Loading…</p>
  if (data.length === 0) return <p>No Projects yet.</p>
  return data.map((project) => <ProjectCard key={project.id} project={project} />)
}

const ProjectCard = ({ project }: { project: Project }) => (
  <section>
    <h2>{project.name}</h2>
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      {project.environments.map((environment) => (
        <EnvironmentPageviews key={environment.id} environment={environment} />
      ))}
    </div>
  </section>
)

const last30Days = () => {
  const to = DateTime.nowUnsafe()
  return { from: DateTime.subtract(to, { days: 30 }), to: DateTime.add(to, { minutes: 1 }) }
}

const EnvironmentPageviews = ({ environment }: { environment: Environment }) => {
  const { data } = usePoll(
    () => request((api) => api.reports.pageviewCount({ params: { environmentId: environment.id }, query: last30Days() })),
    [environment.id]
  )
  return (
    <article style={{ border: "1px solid #ccc", borderRadius: 8, padding: 12, minWidth: 160 }}>
      <div style={{ fontSize: 14, color: "#666" }}>{environment.name}</div>
      <div style={{ fontSize: 32, fontWeight: 600 }} data-testid={`pageviews-${environment.name}`}>
        {data?.pageviews ?? "–"}
      </div>
      <div style={{ fontSize: 12, color: "#666" }}>Pageviews, last 30 days</div>
      <code style={{ fontSize: 11, wordBreak: "break-all" }}>{environment.key}</code>
    </article>
  )
}

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: ProjectsPage })

export const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute]) })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
