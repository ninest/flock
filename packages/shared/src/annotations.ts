// Annotations: short dated notes on a Project ("Launched on Hacker News"), drawn on the time charts.
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { EnvironmentId, EnvironmentNotFound, ProjectId, ProjectNotFound, ProjectOwnerRequired } from "./domain.ts"
import { MemberAuth, MemberId } from "./members.ts"

export const AnnotationId = Schema.String.pipe(Schema.brand("AnnotationId"))
export type AnnotationId = typeof AnnotationId.Type

/** Required: up to 100 characters, no leading or trailing spaces. */
export const AnnotationLabel = Schema.String.check(Schema.isTrimmed(), Schema.isNonEmpty(), Schema.isMaxLength(100))

/** Plain text, up to 1,000 characters. No formatting; the dashboard makes URLs clickable. */
export const AnnotationDescription = Schema.String.check(Schema.isMaxLength(1000))

/**
 * Which of the Project's Environments an Annotation applies to: `all`, or a non-empty list of
 * Environment ids. `all` is its own state: it includes Environments added later, while a list
 * never grows. Deleting an Environment removes it from every list, and an Annotation left with
 * none is deleted.
 */
export const AnnotationEnvironments = Schema.Union([Schema.Literal("all"), Schema.NonEmptyArray(EnvironmentId)])
export type AnnotationEnvironments = typeof AnnotationEnvironments.Type

/** The Member who added an Annotation; null once they are no longer a Member of the Instance. */
export const AnnotationAuthor = Schema.Struct({ id: MemberId, name: Schema.String, email: Schema.String })
export type AnnotationAuthor = typeof AnnotationAuthor.Type

export const Annotation = Schema.Struct({
  id: AnnotationId,
  label: Schema.String,
  /** Null when there is none. */
  description: Schema.NullOr(Schema.String),
  /** The moment it marks, to the minute. Shown in the Project's time zone. */
  at: Schema.DateTimeUtcFromString,
  environments: AnnotationEnvironments,
  createdBy: Schema.NullOr(AnnotationAuthor),
  createdAt: Schema.DateTimeUtcFromString
})
export type Annotation = typeof Annotation.Type

export class AnnotationNotFound extends Schema.TaggedError<AnnotationNotFound>()(
  "AnnotationNotFound",
  { id: AnnotationId },
  { httpApiStatus: 404 }
) {}

export const NewAnnotation = Schema.Struct({
  label: AnnotationLabel,
  /** Empty or missing: no description. */
  description: Schema.optional(AnnotationDescription),
  /** Defaults to now. Seconds are dropped. */
  at: Schema.optional(Schema.DateTimeUtcFromString),
  /** Defaults to `all`. Each id must be one of the Project's Environments. */
  environments: Schema.optional(AnnotationEnvironments)
})
export type NewAnnotation = typeof NewAnnotation.Type

/** An edit: only the fields given change. */
export const AnnotationChanges = Schema.Struct({
  label: Schema.optional(AnnotationLabel),
  /** Empty or null: no description. */
  description: Schema.optional(Schema.NullOr(AnnotationDescription)),
  /** Seconds are dropped. */
  at: Schema.optional(Schema.DateTimeUtcFromString),
  /** Each id must be one of the Project's Environments. */
  environments: Schema.optional(AnnotationEnvironments)
})
export type AnnotationChanges = typeof AnnotationChanges.Type

const annotationParams = { projectId: ProjectId, annotationId: AnnotationId }

/** A Project's Annotations. Anyone the Project is shared with sees them; only owners add, edit or delete them. */
export class AnnotationsGroup extends HttpApiGroup.make("annotations")
  .add(
    /** All of the Project's Annotations, whatever their Environments, newest first. */
    HttpApiEndpoint.get("list", "/:projectId/annotations", {
      params: { projectId: ProjectId },
      success: Schema.Array(Annotation),
      error: ProjectNotFound
    }),
    /** Adds an Annotation, for all of the Project's Environments unless narrowed. */
    HttpApiEndpoint.post("create", "/:projectId/annotations", {
      params: { projectId: ProjectId },
      payload: NewAnnotation,
      success: Annotation,
      error: [ProjectNotFound, ProjectOwnerRequired, EnvironmentNotFound]
    }),
    HttpApiEndpoint.patch("update", "/:projectId/annotations/:annotationId", {
      params: annotationParams,
      payload: AnnotationChanges,
      success: Annotation,
      error: [ProjectNotFound, ProjectOwnerRequired, AnnotationNotFound, EnvironmentNotFound]
    }),
    HttpApiEndpoint.delete("delete", "/:projectId/annotations/:annotationId", {
      params: annotationParams,
      error: [ProjectNotFound, ProjectOwnerRequired, AnnotationNotFound]
    })
  )
  .middleware(MemberAuth)
  .prefix("/api/projects")
  .annotateMerge(OpenApi.annotations({ title: "Annotations" })) {}
