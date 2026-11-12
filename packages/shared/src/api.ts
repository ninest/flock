import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSchema, OpenApi } from "effect/http-api"
import {
  Environment,
  EnvironmentId,
  EnvironmentName,
  EnvironmentNameTaken,
  EnvironmentNotFound,
  ProductionProtected,
  Project,
  ProjectId,
  ProjectName,
  ProjectNotFound,
  ProjectOwnerRequired,
  TimeZone
} from "./domain.ts"
import { IngestBatch, IngestResult, UnknownKey } from "./ingest.ts"
import { LiveVisitors, Overview, OverviewQuery, Top, TopQuery } from "./reports.ts"
import { CreatedInvite, Forbidden, Invite, InviteId, InviteNotFound, InstanceSettings, Member, MemberAuth, MemberId, MemberNotFound, SignInOptions } from "./members.ts"

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

const projectParams = { projectId: ProjectId }
const environmentParams = { environmentId: EnvironmentId }

/** The signed-in Member's Projects. Other Members' Projects answer 404, as if they didn't exist. */
export class ProjectsGroup extends HttpApiGroup.make("projects")
  .add(
    HttpApiEndpoint.get("list", "/", { success: Schema.Array(Project) }),
    /** Creates a Project with its `production` Environment; the creator becomes its owner. */
    HttpApiEndpoint.post("create", "/", {
      payload: Schema.Struct({ name: ProjectName, timeZone: TimeZone }),
      success: Project
    }),
    HttpApiEndpoint.get("get", "/:projectId", { params: projectParams, success: Project, error: ProjectNotFound }),
    HttpApiEndpoint.patch("update", "/:projectId", {
      params: projectParams,
      payload: Schema.Struct({ name: Schema.optional(ProjectName), timeZone: Schema.optional(TimeZone) }),
      success: Project,
      error: [ProjectNotFound, ProjectOwnerRequired]
    }),
    /** Deletes the Project with all its Environments and Events. */
    HttpApiEndpoint.delete("delete", "/:projectId", {
      params: projectParams,
      error: [ProjectNotFound, ProjectOwnerRequired]
    }),
    /** Adds a named Environment (such as `dev`) with its own key. */
    HttpApiEndpoint.post("addEnvironment", "/:projectId/environments", {
      params: projectParams,
      payload: Schema.Struct({ name: EnvironmentName }),
      success: Environment,
      error: [ProjectNotFound, ProjectOwnerRequired, EnvironmentNameTaken]
    })
  )
  .middleware(MemberAuth)
  .prefix("/api/projects")
  .annotateMerge(OpenApi.annotations({ title: "Projects" })) {}

export class EnvironmentsGroup extends HttpApiGroup.make("environments")
  .add(
    /** Deletes an Environment and its Events. `production` can't be deleted. */
    HttpApiEndpoint.delete("delete", "/:environmentId", {
      params: environmentParams,
      error: [EnvironmentNotFound, ProjectOwnerRequired, ProductionProtected]
    }),
    /** Replaces the Environment's key; the old key stops being accepted at ingest. */
    HttpApiEndpoint.post("rotateKey", "/:environmentId/rotate-key", {
      params: environmentParams,
      success: Environment,
      error: [EnvironmentNotFound, ProjectOwnerRequired]
    }),
    /** Deletes all Events in a non-production Environment. */
    HttpApiEndpoint.delete("deleteEvents", "/:environmentId/events", {
      params: environmentParams,
      error: [EnvironmentNotFound, ProjectOwnerRequired, ProductionProtected]
    })
  )
  .middleware(MemberAuth)
  .prefix("/api/environments")
  .annotateMerge(OpenApi.annotations({ title: "Environments" })) {}

/** A half-open time range `[from, to)` for a report. */
export const DateRange = { from: Schema.DateTimeUtcFromString, to: Schema.DateTimeUtcFromString }

/** One value of an Event property and how many Events had it (`null`: Events without it). */
export const BreakdownRow = Schema.Struct({ value: Schema.NullOr(Schema.String), count: Schema.Number })
export type BreakdownRow = typeof BreakdownRow.Type

export class ReportsGroup extends HttpApiGroup.make("reports")
  .add(
    HttpApiEndpoint.get("pageviewCount", "/:environmentId/pageviews", {
      params: { environmentId: EnvironmentId },
      query: DateRange,
      success: Schema.Struct({ pageviews: Schema.Number }),
      error: EnvironmentNotFound
    }),
    /** Visitors, Pageviews, Sessions, bounce rate and visit duration: totals and a time series. */
    HttpApiEndpoint.get("overview", "/:environmentId/overview", {
      params: { environmentId: EnvironmentId },
      query: OverviewQuery,
      success: Overview,
      error: EnvironmentNotFound
    }),
    /**
     * Counts Events (Pageviews unless `event` is given) by the value of one Event property,
     * most frequent first, in an exact `[from, to)` time range. Events without the property
     * count under `null`. The dashboard's reports use `top` and `overview`, on local days.
     */
    HttpApiEndpoint.get("breakdown", "/:environmentId/breakdown", {
      params: { environmentId: EnvironmentId },
      query: { ...DateRange, property: Schema.String, event: Schema.optional(Schema.String) },
      success: Schema.Array(BreakdownRow),
      error: EnvironmentNotFound
    }),
    /** A ranked-list report (top pages, entry and exit pages, referrers, UTM, audience) for a date range. */
    HttpApiEndpoint.get("top", "/:environmentId/top", {
      params: { environmentId: EnvironmentId },
      query: TopQuery,
      success: Top,
      error: EnvironmentNotFound
    }),
    /** The live counter: unique Visitors with an Event in the last 30 minutes. */
    HttpApiEndpoint.get("live", "/:environmentId/live", {
      params: { environmentId: EnvironmentId },
      success: LiveVisitors,
      error: EnvironmentNotFound
    }),
    /** Every Event property key seen on the Environment's Events in the range, sorted. */
    HttpApiEndpoint.get("propertyKeys", "/:environmentId/property-keys", {
      params: { environmentId: EnvironmentId },
      query: DateRange,
      success: Schema.Struct({ keys: Schema.Array(Schema.String) }),
      error: EnvironmentNotFound
    })
  )
  .middleware(MemberAuth)
  .prefix("/api/environments")
  .annotateMerge(OpenApi.annotations({ title: "Reports" })) {}

/** Public: what the sign-in page offers. */
export class SignInGroup extends HttpApiGroup.make("signIn")
  .add(HttpApiEndpoint.get("options", "/api/sign-in-options", { success: SignInOptions }))
  .annotateMerge(OpenApi.annotations({ title: "Sign-in" })) {}

export class MembersGroup extends HttpApiGroup.make("members")
  .add(HttpApiEndpoint.get("me", "/api/me", { success: Member }))
  .middleware(MemberAuth)
  .annotateMerge(OpenApi.annotations({ title: "Members" })) {}

/** Instance membership: settings, Invites and Members. Instance admin only. */
export class InstanceGroup extends HttpApiGroup.make("instance")
  .add(HttpApiEndpoint.get("settings", "/settings", { success: InstanceSettings, error: Forbidden }))
  .add(HttpApiEndpoint.patch("updateSettings", "/settings", { payload: InstanceSettings, success: InstanceSettings, error: Forbidden }))
  .add(HttpApiEndpoint.get("members", "/members", { success: Schema.Array(Member), error: Forbidden }))
  .add(
    HttpApiEndpoint.delete("removeMember", "/members/:memberId", {
      params: { memberId: MemberId },
      error: [Forbidden, MemberNotFound]
    })
  )
  .add(HttpApiEndpoint.get("invites", "/invites", { success: Schema.Array(Invite), error: Forbidden }))
  .add(
    HttpApiEndpoint.post("createInvite", "/invites", {
      payload: Schema.Struct({ note: Schema.String }),
      success: CreatedInvite,
      error: Forbidden
    })
  )
  .add(
    HttpApiEndpoint.delete("revokeInvite", "/invites/:inviteId", {
      params: { inviteId: InviteId },
      error: [Forbidden, InviteNotFound]
    })
  )
  .middleware(MemberAuth)
  .prefix("/api/instance")
  .annotateMerge(OpenApi.annotations({ title: "Instance" })) {}

export class FlockApi extends HttpApi.make("flock")
  .add(HealthGroup)
  .add(IngestGroup)
  .add(ProjectsGroup)
  .add(EnvironmentsGroup)
  .add(ReportsGroup)
  .add(SignInGroup)
  .add(MembersGroup)
  .add(InstanceGroup)
  .middleware(HttpApiMiddleware.ProblemDetails) // malformed requests get an RFC 9457 400 explaining why
  .annotateMerge(OpenApi.annotations({ title: "Flock API" })) {}
