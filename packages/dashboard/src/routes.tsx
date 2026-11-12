import { ProjectId } from "@flock/shared"
import { createRootRoute, createRoute, createRouter, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router"
import { type FormEvent, useState } from "react"
import { currentMember, signIn, signOut, signUp } from "./auth.ts"
import { ProjectPage, ProjectsPage } from "./projects.tsx"

const rootRoute = createRootRoute({
  component: () => (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 720, margin: "0 auto", padding: 16 }}>
      <h1><Link to="/" style={{ color: "inherit", textDecoration: "none" }}>Flock</Link></h1>
      <Outlet />
    </main>
  )
})

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

/** One Project; `?env=dev` picks the Environment (default `production`). */
const projectRoute = createRoute({
  getParentRoute: () => memberRoute,
  path: "/projects/$projectId",
  validateSearch: (search: Record<string, unknown>): { env?: string } =>
    typeof search.env === "string" && search.env !== "" ? { env: search.env } : {},
  component: () => {
    const { projectId } = projectRoute.useParams()
    const { env } = projectRoute.useSearch()
    return <ProjectPage key={projectId} projectId={ProjectId.make(projectId)} env={env} />
  }
})

export const router = createRouter({ routeTree: rootRoute.addChildren([signInRoute, memberRoute.addChildren([indexRoute, projectRoute])]) })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
