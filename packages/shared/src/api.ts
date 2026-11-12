import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSchema, OpenApi } from "effect/http-api"
import { EnvironmentId, EnvironmentNotFound, Project } from "./domain.ts"
import { IngestBatch, IngestResult, UnknownKey } from "./ingest.ts"
import { Member, MemberAuth } from "./members.ts"

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

/** Liveness for container healthchecks: 200 once the server is up and Postgres answers. */
export class HealthGroup extends HttpApiGroup.make("health")
  .add(HttpApiEndpoint.get("check", "/api/health", { success: Schema.Struct({ status: Schema.Literal("ok") }) }))
  .annotateMerge(OpenApi.annotations({ title: "Health" })) {}

export class ProjectsGroup extends HttpApiGroup.make("projects")
  .add(HttpApiEndpoint.get("list", "/", { success: Schema.Array(Project) }))
  .middleware(MemberAuth)
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
  .middleware(MemberAuth)
  .prefix("/api/environments")
  .annotateMerge(OpenApi.annotations({ title: "Reports" })) {}

export class MembersGroup extends HttpApiGroup.make("members")
  .add(HttpApiEndpoint.get("me", "/api/me", { success: Member }))
  .middleware(MemberAuth)
  .annotateMerge(OpenApi.annotations({ title: "Members" })) {}

export class FlockApi extends HttpApi.make("flock")
  .add(HealthGroup)
  .add(IngestGroup)
  .add(ProjectsGroup)
  .add(ReportsGroup)
  .add(MembersGroup)
  .middleware(HttpApiMiddleware.ProblemDetails) // malformed requests get an RFC 9457 400 explaining why
  .annotateMerge(OpenApi.annotations({ title: "Flock API" })) {}
