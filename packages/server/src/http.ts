// HTTP: the FlockApi handlers, the dashboard and the script as static files.
import { PgClient } from "@effect/sql-pg"
import { FlockApi } from "@flock/shared"
import { Effect, Layer } from "effect"
import { HttpRouter, HttpServerResponse, HttpStaticServer } from "effect/http"
import { HttpApiBuilder, HttpApiMiddleware, HttpApiScalar } from "effect/http-api"
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

const ApiRoutes = HttpApiBuilder.layer(FlockApi, { openapiPath: "/api/openapi.json" }).pipe(
  Layer.provide([HealthHandlers, IngestHandlers, ProjectsHandlers, ReportsHandlers]),
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
  Layer.mergeAll(ApiRoutes, DocsRoute, ScriptRoute(options.scriptFile), StaticRoutes(options.publicDir), Cors)
