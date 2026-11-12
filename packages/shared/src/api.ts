import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSchema, OpenApi } from "effect/http-api"
import { EnvironmentId, EnvironmentNotFound, Project } from "./domain.ts"
import { IngestBatch, IngestResult, UnknownKey } from "./ingest.ts"

export class IngestGroup extends HttpApiGroup.make("ingest")
  .add(
    HttpApiEndpoint.post("send", "/api/ingest", {
      // JSON either way. The browser script sends text/plain, which sendBeacon and
      // cross-origin fetch can send without a CORS preflight.
      payload: [IngestBatch, IngestBatch.pipe(HttpApiSchema.asJson({ contentType: "text/plain" }))],
      success: IngestResult,
      error: UnknownKey
    })
  )
  .annotateMerge(OpenApi.annotations({ title: "Ingest" })) {}

export class ProjectsGroup extends HttpApiGroup.make("projects")
  .add(HttpApiEndpoint.get("list", "/", { success: Schema.Array(Project) }))
  .prefix("/api/projects")
  .annotateMerge(OpenApi.annotations({ title: "Projects" })) {}

/** A half-open time range `[from, to)` for a report. */
export const DateRange = { from: Schema.DateTimeUtcFromString, to: Schema.DateTimeUtcFromString }

export class ReportsGroup extends HttpApiGroup.make("reports")
  .add(
    HttpApiEndpoint.get("pageviewCount", "/:environmentId/pageviews", {
      params: { environmentId: EnvironmentId },
      query: DateRange,
      success: Schema.Struct({ pageviews: Schema.Number }),
      error: EnvironmentNotFound
    })
  )
  .prefix("/api/environments")
  .annotateMerge(OpenApi.annotations({ title: "Reports" })) {}

export class FlockApi extends HttpApi.make("flock")
  .add(IngestGroup)
  .add(ProjectsGroup)
  .add(ReportsGroup)
  .middleware(HttpApiMiddleware.ProblemDetails) // malformed requests get an RFC 9457 400 explaining why
  .annotateMerge(OpenApi.annotations({ title: "Flock API" })) {}
