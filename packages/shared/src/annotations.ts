// Annotations: short dated notes on a Project ("Launched on Hacker News"), drawn on the time charts.
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { ProjectId, ProjectNotFound, ProjectOwnerRequired } from "./domain.ts"
import { MemberAuth, MemberId } from "./members.ts"

export const AnnotationId = Schema.String.pipe(Schema.brand("AnnotationId"))
export type AnnotationId = typeof AnnotationId.Type

/** Required: up to 100 characters, no leading or trailing spaces. */
export const AnnotationLabel = Schema.String.check(Schema.isTrimmed(), Schema.isNonEmpty(), Schema.isMaxLength(100))

/** Plain text, up to 1,000 characters. No formatting; the dashboard makes URLs clickable. */
export const AnnotationDescription = Schema.String.check(Schema.isMaxLength(1000))

/**
 * Which of the Project's Environments an Annotation applies to. `all` is its own state: it
 * includes Environments added later.
 */
export const AnnotationEnvironments = Schema.Literal("all")
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
  at: Schema.optional(Schema.DateTimeUtcFromString)
})
export type NewAnnotation = typeof NewAnnotation.Type

const annotationParams = { projectId: ProjectId, annotationId: AnnotationId }

/** A Project's Annotations. Anyone the Project is shared with sees them; only owners add or delete them. */
export class AnnotationsGroup extends HttpApiGroup.make("annotations")
  .add(
    /** Adds an Annotation that applies to all of the Project's Environments. */
    HttpApiEndpoint.post("create", "/:projectId/annotations", {
      params: { projectId: ProjectId },
      payload: NewAnnotation,
      success: Annotation,
      error: [ProjectNotFound, ProjectOwnerRequired]
    }),
    HttpApiEndpoint.delete("delete", "/:projectId/annotations/:annotationId", {
      params: annotationParams,
      error: [ProjectNotFound, ProjectOwnerRequired, AnnotationNotFound]
    })
  )
  .middleware(MemberAuth)
  .prefix("/api/projects")
  .annotateMerge(OpenApi.annotations({ title: "Annotations" })) {}
