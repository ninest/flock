import type { Environment, Project } from "@flock/shared"
import { createRootRoute, createRoute, createRouter, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router"
import { DateTime } from "effect"
import { type FormEvent, useState } from "react"
import { request } from "./api.ts"
import { currentMember, signIn, signOut, signUp } from "./auth.ts"
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

const SignInPage = () => {
  const navigate = useNavigate()
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in")
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const email = String(form.get("email"))
    const password = String(form.get("password"))
    setBusy(true)
    setError(undefined)
    try {
      if (mode === "sign-in") await signIn({ email, password })
      else await signUp({ email, password, name: String(form.get("name")) })
      await navigate({ to: "/" })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const field = { display: "grid", gap: 4 } as const
  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 12, maxWidth: 320 }}>
      <h2>{mode === "sign-in" ? "Sign in" : "Create the admin account"}</h2>
      {mode === "sign-up" && (
        <label style={field}>Name<input name="name" required autoComplete="name" /></label>
      )}
      <label style={field}>Email<input name="email" type="email" required autoComplete="email" /></label>
      <label style={field}>
        Password
        <input
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
        />
      </label>
      {error && <p role="alert" style={{ color: "#b00020", margin: 0 }}>{error}</p>}
      <button type="submit" disabled={busy}>{mode === "sign-in" ? "Sign in" : "Sign up"}</button>
      <button type="button" onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")} style={{ all: "unset", color: "#06c", cursor: "pointer" }}>
        {mode === "sign-in" ? "First time? Sign up with the Instance admin email" : "Have an account? Sign in"}
      </button>
    </form>
  )
}

const signInRoute = createRoute({ getParentRoute: () => rootRoute, path: "/sign-in", component: SignInPage })

/** Every dashboard page below needs a signed-in Member. */
const memberRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "member",
  beforeLoad: async () => {
    const member = await currentMember()
    if (!member) throw redirect({ to: "/sign-in" })
    return { member }
  },
  component: () => {
    const { member } = memberRoute.useRouteContext()
    const navigate = useNavigate()
    return (
      <>
        <p style={{ fontSize: 14, color: "#666" }}>
          Signed in as {member.email}{member.isAdmin ? " (Instance admin)" : ""} ·{" "}
          <button type="button" onClick={() => signOut().then(() => navigate({ to: "/sign-in" }))}>Sign out</button>
        </p>
        <Outlet />
      </>
    )
  }
})

const indexRoute = createRoute({ getParentRoute: () => memberRoute, path: "/", component: ProjectsPage })

export const router = createRouter({ routeTree: rootRoute.addChildren([signInRoute, memberRoute.addChildren([indexRoute])]) })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
