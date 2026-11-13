import { ProjectId, type SignInOptions } from "@flock/shared"
import { createRootRoute, createRoute, createRouter, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router"
import { type FormEvent, useEffect, useState } from "react"
import { currentMember, oidcSignIn, signIn, signInOptions, signOut, signUp } from "./auth.ts"
import { ProjectPage, ProjectsPage } from "./projects.tsx"
import { InstancePage } from "./instance.tsx"
import { validateProjectSearch } from "./filters.tsx"

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
  // An Invite link opens /sign-in?invite=<token>. A refused OIDC sign-in comes back
  // with ?error=<code>&error_description=<message>.
  const [query] = useState(() => new URLSearchParams(window.location.search))
  const invite = query.get("invite") ?? undefined
  const [mode, setMode] = useState<"sign-in" | "sign-up">(invite ? "sign-up" : "sign-in")
  const [error, setError] = useState<string | undefined>(
    () => query.get("error_description") ?? (query.get("error") ? `Sign-in failed (${query.get("error")})` : undefined)
  )
  const [busy, setBusy] = useState(false)
  const [options, setOptions] = useState<SignInOptions>()
  useEffect(() => {
    // If the options can't be loaded, fall back to the password form.
    signInOptions().then(setOptions, () => setOptions({ password: true, oidc: null }))
  }, [])

  const startOidc = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await oidcSignIn(invite)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const email = String(form.get("email"))
    const password = String(form.get("password"))
    setBusy(true)
    setError(undefined)
    try {
      if (mode === "sign-in") await signIn({ email, password })
      else await signUp({ email, password, name: String(form.get("name")), invite })
      await navigate({ to: "/" })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const field = { display: "grid", gap: 4 } as const
  const heading = mode === "sign-in" ? "Sign in" : invite ? "Accept your Invite" : "Sign up"
  if (!options) return <h2>{heading}</h2>
  const oidcButton = options.oidc && (
    <button type="button" onClick={startOidc} disabled={busy}>Sign in with {options.oidc.name}</button>
  )
  const errorMessage = error && <p role="alert" style={{ color: "#b00020", margin: 0 }}>{error}</p>
  if (!options.password) {
    return (
      <div style={{ display: "grid", gap: 12, maxWidth: 320 }}>
        <h2>{invite ? "Accept your Invite" : "Sign in"}</h2>
        {errorMessage}
        {oidcButton}
      </div>
    )
  }
  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 12, maxWidth: 320 }}>
      <h2>{heading}</h2>
      {oidcButton}
      {oidcButton && <p style={{ margin: 0, color: "#666" }}>or with email and password:</p>}
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
      {errorMessage}
      <button type="submit" disabled={busy}>{mode === "sign-in" ? "Sign in" : "Sign up"}</button>
      <button type="button" onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")} style={{ all: "unset", color: "#06c", cursor: "pointer" }}>
        {mode === "sign-in" ? "First time? Sign up" : "Have an account? Sign in"}
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
          {member.isAdmin && <><Link to="/instance">Instance</Link> ·{" "}</>}
          <button type="button" onClick={() => signOut().then(() => navigate({ to: "/sign-in" }))}>Sign out</button>
        </p>
        <Outlet />
      </>
    )
  }
})

const indexRoute = createRoute({ getParentRoute: () => memberRoute, path: "/", component: ProjectsPage })

/**
 * One Project; `?env=dev` picks the Environment (default `production`). The shared date range
 * (`period`, `from`, `to`) and Event property `filters` live in the URL too, so views can be shared.
 */
const projectRoute = createRoute({
  getParentRoute: () => memberRoute,
  path: "/projects/$projectId",
  validateSearch: validateProjectSearch,
  component: () => {
    const { projectId } = projectRoute.useParams()
    const search = projectRoute.useSearch()
    return <ProjectPage key={projectId} projectId={ProjectId.make(projectId)} search={search} />
  }
})

const instanceRoute = createRoute({
  getParentRoute: () => memberRoute,
  path: "/instance",
  beforeLoad: ({ context }) => {
    if (!context.member.isAdmin) throw redirect({ to: "/" })
  },
  component: () => <InstancePage me={instanceRoute.useRouteContext().member} />
})

export const router = createRouter({ routeTree: rootRoute.addChildren([signInRoute, memberRoute.addChildren([indexRoute, projectRoute, instanceRoute])]) })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
