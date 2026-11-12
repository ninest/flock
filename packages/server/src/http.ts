// HTTP: the FlockApi handlers, the dashboard and the script as static files.
import { FlockApi } from "@flock/shared"
import { Effect, Layer } from "effect"
import { HttpRouter, HttpStaticServer } from "effect/http"
import { HttpApiBuilder, HttpApiMiddleware, HttpApiScalar } from "effect/http-api"
import { Ingest } from "./ingest.ts"
import { Projects } from "./projects.ts"
import { Reports } from "./reports.ts"

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
  Layer.provide([IngestHandlers, ProjectsHandlers, ReportsHandlers]),
  Layer.provide(HttpApiMiddleware.layerProblemDetails({ includeDetails: true }))
)

const DocsRoute = HttpApiScalar.layer(FlockApi, { path: "/api/docs" })

/** Serves the built dashboard; extension-less HTML requests fall back to index.html. */
const StaticRoutes = (publicDir: string) => HttpStaticServer.layer({ root: publicDir, spa: true })

/**
 * Responses carry `Access-Control-Allow-Origin: *` without credentials, so any site
 * can send Events, while cookie-authenticated responses stay unreadable cross-origin.
 */
const Cors = HttpRouter.cors({ allowedHeaders: ["content-type"] })

export const AppRoutes = (publicDir: string) => Layer.mergeAll(ApiRoutes, DocsRoute, StaticRoutes(publicDir), Cors)
