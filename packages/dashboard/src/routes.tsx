import { ProjectId } from "@flock/shared"
import { createRootRoute, createRoute, createRouter, Outlet, redirect } from "@tanstack/react-router"
import { currentMember } from "./auth.ts"
import { InstancePage } from "./instance.tsx"
import { validateProjectSearch } from "./project-search.ts"
import { NewProjectPage, ProjectPage, ProjectSessionPage, ProjectsPage, ProjectVisitorPage } from "./projects.tsx"
import { SettingsPage } from "./settings.tsx"
import { SignInPage } from "./sign-in.tsx"
import { MemberContext } from "./ui.tsx"

// Each page brings its own chrome (see shell.tsx).
const rootRoute = createRootRoute({ component: Outlet })

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
  component: () => (
    <MemberContext.Provider value={memberRoute.useRouteContext().member}>
      <Outlet />
    </MemberContext.Provider>
  )
})

const indexRoute = createRoute({ getParentRoute: () => memberRoute, path: "/", component: ProjectsPage })

const newProjectRoute = createRoute({ getParentRoute: () => memberRoute, path: "/projects/new", component: NewProjectPage })

/**
 * One Project. The search params pick the tab and its selection (`?tab=events&event=signup`), the
 * Environment (`?env=dev`, default `production`), the date range (`period`, `from`, `to`) and
 * `filters`, so any view can be shared.
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

/** One Session and its Session timeline; keeps the Environment, range and Filters for the way back. */
const sessionRoute = createRoute({
  getParentRoute: () => memberRoute,
  path: "/projects/$projectId/sessions/$sessionId",
  validateSearch: validateProjectSearch,
  component: () => {
    const { projectId, sessionId } = sessionRoute.useParams()
    const search = sessionRoute.useSearch()
    return <ProjectSessionPage key={`${projectId}-${sessionId}`} projectId={ProjectId.make(projectId)} sessionId={sessionId} search={search} />
  }
})

/** One Visitor's profile in the picked Environment (persistent Tracking mode); keeps the search params for the way back. */
const visitorRoute = createRoute({
  getParentRoute: () => memberRoute,
  path: "/projects/$projectId/visitors/$visitorId",
  validateSearch: validateProjectSearch,
  component: () => {
    const { projectId, visitorId } = visitorRoute.useParams()
    const search = visitorRoute.useSearch()
    return <ProjectVisitorPage key={`${projectId}-${visitorId}`} projectId={ProjectId.make(projectId)} visitorId={visitorId} search={search} />
  }
})

/** A Project's settings (`?env=dev` picks the Environment whose key is shown). */
const settingsRoute = createRoute({
  getParentRoute: () => memberRoute,
  path: "/projects/$projectId/settings",
  validateSearch: validateProjectSearch,
  component: () => {
    const { projectId } = settingsRoute.useParams()
    const search = settingsRoute.useSearch()
    return <SettingsPage key={projectId} projectId={ProjectId.make(projectId)} search={search} />
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

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    signInRoute,
    memberRoute.addChildren([indexRoute, newProjectRoute, projectRoute, sessionRoute, visitorRoute, settingsRoute, instanceRoute])
  ])
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
