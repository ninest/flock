// HTTP: the FlockApi handlers, the dashboard and the script as static files.
import { PgClient } from "@effect/sql-pg"
import { CurrentMember, FlockApi, Forbidden, InviteNotFound, MemberNotFound } from "@flock/shared"
import { Effect, Layer, Option } from "effect"
import { HttpRouter, type HttpServerRequest, HttpServerResponse, HttpStaticServer } from "effect/http"
import { HttpApiBuilder, HttpApiMiddleware, HttpApiScalar } from "effect/http-api"
import { Access, AuthConfig } from "./access.ts"
import { Annotations } from "./annotations.ts"
import { clientIp, type TrustedProxies } from "./client-ip.ts"
import { AuthRoutes, currentMember, MemberAuthLive } from "./auth.ts"
import type { RequestContext } from "./enrichment.ts"
import { Ingest } from "./ingest.ts"
import { Projects } from "./projects.ts"
import { Queries } from "./queries.ts"

const HealthHandlers = HttpApiBuilder.group(FlockApi, "health", Effect.fn(function*(handlers) {
  const sql = yield* PgClient.PgClient
  return handlers.handle("check", () => sql`SELECT 1`.pipe(Effect.as({ status: "ok" as const }), Effect.orDie))
}))

const IngestHandlers = (trusted: TrustedProxies) =>
  HttpApiBuilder.group(FlockApi, "ingest", Effect.fn(function*(handlers) {
    const ingest = yield* Ingest
    return handlers
      .handle("send", ({ payload, request }) => ingest.send(payload, requestContext(request, trusted)))
      .handle("config", ({ query }) => ingest.config(query.key))
  }))

/**
 * The client IP, User-Agent and Origin of an ingest request. X-Forwarded-For counts only as far
 * as FLOCK_TRUSTED_PROXIES vouches for it; otherwise the socket address is the client.
 */
const requestContext = (request: HttpServerRequest.HttpServerRequest, trusted: TrustedProxies): RequestContext => ({
  ip: clientIp({ forwardedFor: request.headers["x-forwarded-for"], socket: Option.getOrNull(request.remoteAddress), trusted }),
  userAgent: request.headers["user-agent"] ?? null,
  origin: request.headers["origin"] ?? null
})

const ProjectsHandlers = HttpApiBuilder.group(FlockApi, "projects", Effect.fn(function*(handlers) {
  const projects = yield* Projects
  const queries = yield* Queries
  return handlers
    .handle("list", () => CurrentMember.use(({ id }) => projects.list(id)))
    .handle("numbers", () => CurrentMember.use(({ id }) => queries.projectNumbers(id)))
    .handle("create", ({ payload }) =>
      CurrentMember.use(({ id }) =>
        projects.create({ ...payload, owner: Option.some(id) }).pipe(
          Effect.flatMap((projectId) => projects.get(id, projectId)),
          Effect.orDie
        )
      ))
    .handle("get", ({ params }) => CurrentMember.use(({ id }) => projects.get(id, params.projectId)))
    .handle("update", ({ params, payload }) => CurrentMember.use(({ id }) => projects.update(id, params.projectId, payload)))
    .handle("delete", ({ params }) => CurrentMember.use(({ id }) => projects.delete(id, params.projectId)))
    .handle("addEnvironment", ({ params, payload }) =>
      CurrentMember.use(({ id }) => projects.addEnvironment(id, params.projectId, payload.name)))
    .handle("members", ({ params }) => CurrentMember.use(({ id }) => projects.members(id, params.projectId)))
    .handle("addMember", ({ params, payload }) => CurrentMember.use(({ id }) => projects.addMember(id, params.projectId, payload)))
    .handle("changeMemberRole", ({ params, payload }) =>
      CurrentMember.use(({ id }) => projects.changeMemberRole(id, params.projectId, params.memberId, payload.role)))
    .handle("removeMember", ({ params }) =>
      CurrentMember.use(({ id }) => projects.removeMember(id, params.projectId, params.memberId)))
}))

const EnvironmentsHandlers = HttpApiBuilder.group(FlockApi, "environments", Effect.fn(function*(handlers) {
  const projects = yield* Projects
  return handlers
    .handle("update", ({ params, payload }) => CurrentMember.use(({ id }) => projects.updateEnvironment(id, params.environmentId, payload)))
    .handle("delete", ({ params }) => CurrentMember.use(({ id }) => projects.deleteEnvironment(id, params.environmentId)))
    .handle("rotateKey", ({ params }) => CurrentMember.use(({ id }) => projects.rotateKey(id, params.environmentId)))
    .handle("deleteEvents", ({ params }) => CurrentMember.use(({ id }) => projects.deleteEvents(id, params.environmentId)))
}))

const ReportsHandlers = HttpApiBuilder.group(FlockApi, "reports", Effect.fn(function*(handlers) {
  const queries = yield* Queries
  return handlers
    .handle("pageviewCount", ({ params: { environmentId }, query }) =>
      CurrentMember.use(({ id: member }) => queries.pageviewCount({ member, environmentId, query })).pipe(
        Effect.map((pageviews) => ({ pageviews }))
      ))
    .handle("overview", ({ params: { environmentId }, query }) =>
      CurrentMember.use(({ id: member }) => queries.overview({ member, environmentId, query })))
    .handle("live", ({ params: { environmentId }, query }) =>
      CurrentMember.use(({ id: member }) => queries.liveVisitors({ member, environmentId, query })).pipe(
        Effect.map((visitors) => ({ visitors }))
      ))
    .handle("top", ({ params: { environmentId }, query }) => CurrentMember.use(({ id: member }) => queries.top({ member, environmentId, query })))
    .handle("breakdown", ({ params: { environmentId }, query }) =>
      CurrentMember.use(({ id: member }) =>
        queries.breakdown({ member, environmentId, query: { ...query, event: query.event ?? "$pageview" } })
      ))
    .handle("sessions", ({ params: { environmentId }, query }) =>
      CurrentMember.use(({ id: member }) => queries.sessions({ member, environmentId, query })))
    .handle("session", ({ params: { environmentId, sessionId }, query }) =>
      CurrentMember.use(({ id: member }) => queries.session({ member, environmentId, query: { ...query, sessionId } })))
    .handle("eventPropertyKeys", ({ params: { environmentId }, query }) =>
      CurrentMember.use(({ id: member }) => queries.eventPropertyKeys({ member, environmentId, query })).pipe(
        Effect.map((keys) => ({ keys }))
      ))
}))

const CustomEventsHandlers = HttpApiBuilder.group(FlockApi, "customEvents", Effect.fn(function*(handlers) {
  const queries = yield* Queries
  return handlers
    .handle("list", ({ params: { environmentId }, query }) =>
      CurrentMember.use(({ id: member }) => queries.customEvents({ member, environmentId, query })))
    .handle("detail", ({ params: { environmentId }, query }) =>
      CurrentMember.use(({ id: member }) => queries.customEvent({ member, environmentId, query })))
    .handle("breakdown", ({ params: { environmentId }, query }) =>
      CurrentMember.use(({ id: member }) => queries.customEventBreakdown({ member, environmentId, query })))
    .handle("stats", ({ params: { environmentId }, query }) =>
      CurrentMember.use(({ id: member }) => queries.customEventStats({ member, environmentId, query })))
}))

const VisitorsHandlers = HttpApiBuilder.group(FlockApi, "visitors", Effect.fn(function*(handlers) {
  const queries = yield* Queries
  return handlers
    .handle("profile", ({ params: { environmentId, visitorId } }) =>
      CurrentMember.use(({ id: member }) => queries.visitorProfile({ member, environmentId, query: { visitorId } })))
    .handle("sessions", ({ params: { environmentId, visitorId }, query }) =>
      CurrentMember.use(({ id: member }) => queries.visitorSessions({ member, environmentId, query: { ...query, visitorId } })))
}))

const AnnotationsHandlers = HttpApiBuilder.group(FlockApi, "annotations", Effect.fn(function*(handlers) {
  const annotations = yield* Annotations
  return handlers
    .handle("list", ({ params }) => CurrentMember.use(({ id }) => annotations.list(id, params.projectId)))
    .handle("create", ({ params, payload }) => CurrentMember.use(({ id }) => annotations.create(id, params.projectId, payload)))
    .handle("update", ({ params, payload }) =>
      CurrentMember.use(({ id }) => annotations.update(id, params.projectId, params.annotationId, payload)))
    .handle("delete", ({ params }) =>
      CurrentMember.use(({ id }) => annotations.delete(id, params.projectId, params.annotationId)))
}))

const SignInHandlers = HttpApiBuilder.group(FlockApi, "signIn", Effect.fn(function*(handlers) {
  const { oidc, passwordSignIn } = yield* AuthConfig
  const options = { password: passwordSignIn, oidc: Option.match(oidc, { onNone: () => null, onSome: ({ name }) => ({ name }) }) }
  return handlers.handle("options", () => Effect.succeed(options))
}))

const MembersHandlers = HttpApiBuilder.group(FlockApi, "members", (handlers) => handlers.handle("me", () => currentMember))

/** Runs `effect` only when the signed-in Member is an Instance admin. */
const asAdmin = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function*() {
    const member = yield* currentMember
    if (!member.isAdmin) return yield* new Forbidden({ message: "Only the Instance admin can do this" })
    return yield* effect
  })

const InstanceHandlers = HttpApiBuilder.group(FlockApi, "instance", Effect.fn(function*(handlers) {
  const access = yield* Access
  return handlers
    .handle("settings", () => asAdmin(access.settings.pipe(Effect.orDie)))
    .handle("updateSettings", ({ payload }) => asAdmin(access.updateSettings(payload).pipe(Effect.orDie)))
    .handle("members", () => asAdmin(access.members.pipe(Effect.orDie)))
    .handle("removeMember", ({ params: { memberId } }) =>
      asAdmin(Effect.gen(function*() {
        const { id } = yield* CurrentMember
        if (id === memberId) return yield* new Forbidden({ message: "You can't remove yourself" })
        if (!(yield* access.removeMember(memberId).pipe(Effect.orDie))) return yield* new MemberNotFound({ id: memberId })
      })))
    .handle("invites", () => asAdmin(access.invites.pipe(Effect.orDie)))
    .handle("createInvite", ({ payload }) =>
      asAdmin(Effect.gen(function*() {
        const { id } = yield* CurrentMember
        return yield* access.createInvite({ note: payload.note, createdBy: id }).pipe(Effect.orDie)
      })))
    .handle("revokeInvite", ({ params: { inviteId } }) =>
      asAdmin(Effect.gen(function*() {
        if (!(yield* access.revokeInvite(inviteId).pipe(Effect.orDie))) return yield* new InviteNotFound({ id: inviteId })
      })))
}))

const ApiRoutes = (trusted: TrustedProxies) => HttpApiBuilder.layer(FlockApi, { openapiPath: "/api/openapi.json" }).pipe(
  Layer.provide([HealthHandlers, IngestHandlers(trusted), ProjectsHandlers, EnvironmentsHandlers, ReportsHandlers, CustomEventsHandlers, VisitorsHandlers, AnnotationsHandlers, SignInHandlers, MembersHandlers, InstanceHandlers]),
  Layer.provide(MemberAuthLive),
  Layer.provide(HttpApiMiddleware.layerProblemDetails({ includeDetails: true }))
)

const DocsRoute = HttpApiScalar.layer(FlockApi, { path: "/api/docs" })

/** Serves the built dashboard; extension-less HTML requests fall back to index.html. */
const StaticRoutes = (publicDir: string) => HttpStaticServer.layer({ root: publicDir, spa: true })

/** Serves the built browser script; any site may load it. */
const ScriptRoute = (scriptFile: string) =>
  HttpRouter.add(
    "GET",
    "/flock.js",
    HttpServerResponse.file(scriptFile, {
      contentType: "text/javascript; charset=utf-8",
      headers: { "cache-control": "public, max-age=300" }
    }).pipe(Effect.orDie)
  )

/**
 * Responses carry `Access-Control-Allow-Origin: *` without credentials, so any site
 * can send Events, while cookie-authenticated responses stay unreadable cross-origin.
 */
const Cors = HttpRouter.cors({ allowedHeaders: ["content-type"] })

export interface AppRoutesOptions {
  /** Directory with the built dashboard. */
  readonly publicDir: string
  /** The built browser script, served at /flock.js. */
  readonly scriptFile: string
  /** Which proxies may set the client IP through X-Forwarded-For. */
  readonly trustedProxies: TrustedProxies
}

export const AppRoutes = (options: AppRoutesOptions) =>
  Layer.mergeAll(ApiRoutes(options.trustedProxies), AuthRoutes, DocsRoute, ScriptRoute(options.scriptFile), StaticRoutes(options.publicDir), Cors)
