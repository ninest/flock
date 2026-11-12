// HTTP: the FlockApi handlers, the dashboard and the script as static files.
import { PgClient } from "@effect/sql-pg"
import { CurrentMember, FlockApi, Forbidden, InviteNotFound, MemberNotFound } from "@flock/shared"
import { Effect, Layer, Option } from "effect"
import { HttpRouter, HttpServerResponse, HttpStaticServer } from "effect/http"
import { HttpApiBuilder, HttpApiMiddleware, HttpApiScalar } from "effect/http-api"
import { Access, AuthConfig } from "./access.ts"
import { AuthRoutes, currentMember, MemberAuthLive } from "./auth.ts"
import { Ingest } from "./ingest.ts"
import { Projects } from "./projects.ts"
import { Reports } from "./reports.ts"

const HealthHandlers = HttpApiBuilder.group(FlockApi, "health", Effect.fn(function*(handlers) {
  const sql = yield* PgClient.PgClient
  return handlers.handle("check", () => sql`SELECT 1`.pipe(Effect.as({ status: "ok" as const }), Effect.orDie))
}))

const IngestHandlers = HttpApiBuilder.group(FlockApi, "ingest", Effect.fn(function*(handlers) {
  const ingest = yield* Ingest
  return handlers.handle("send", ({ payload }) => ingest.send(payload))
}))

const ProjectsHandlers = HttpApiBuilder.group(FlockApi, "projects", Effect.fn(function*(handlers) {
  const projects = yield* Projects
  return handlers.handle("list", () => projects.list.pipe(Effect.orDie))
}))

const ReportsHandlers = HttpApiBuilder.group(FlockApi, "reports", Effect.fn(function*(handlers) {
  const reports = yield* Reports
  return handlers.handle("pageviewCount", ({ params, query }) => reports.pageviewCount(params.environmentId, query).pipe(Effect.map((pageviews) => ({ pageviews }))))
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

const ApiRoutes = HttpApiBuilder.layer(FlockApi, { openapiPath: "/api/openapi.json" }).pipe(
  Layer.provide([HealthHandlers, IngestHandlers, ProjectsHandlers, ReportsHandlers, SignInHandlers, MembersHandlers, InstanceHandlers]),
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
}

export const AppRoutes = (options: AppRoutesOptions) =>
  Layer.mergeAll(ApiRoutes, AuthRoutes, DocsRoute, ScriptRoute(options.scriptFile), StaticRoutes(options.publicDir), Cors)
