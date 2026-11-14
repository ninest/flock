// Annotations: short dated notes on a Project, drawn on the time charts. Every Member of the
// Project sees them; only owners add, edit or delete them. One applies to all of the Project's
// Environments (`all_environments`, including later ones) or to the set in `annotation_environment`.
import { PgClient } from "@effect/sql-pg"
import {
  type Annotation,
  type AnnotationChanges,
  type AnnotationEnvironments,
  AnnotationId,
  AnnotationNotFound,
  EnvironmentId,
  EnvironmentNotFound,
  MemberId,
  type NewAnnotation,
  type ProjectId,
  type ProjectNotFound,
  ProjectOwnerRequired
} from "@flock/shared"
import { Context, DateTime, Effect, Layer } from "effect"
import type { Fragment } from "effect/sql/Statement"
import { makeId } from "./keys.ts"
import { Projects } from "./projects.ts"
import type { ReportRange } from "./report-range.ts"

interface Row {
  readonly id: string
  readonly label: string
  readonly description: string | null
  readonly at: Date
  readonly allEnvironments: boolean
  readonly environmentIds: Array<string>
  readonly createdById: string | null
  readonly createdByName: string | null
  readonly createdByEmail: string | null
  readonly createdAt: Date
}

const toAnnotation = (row: Row): Annotation => ({
  id: AnnotationId.make(row.id),
  label: row.label,
  description: row.description,
  at: DateTime.makeUnsafe(row.at),
  environments: row.allEnvironments || row.environmentIds.length === 0
    ? "all"
    : [EnvironmentId.make(row.environmentIds[0]!), ...row.environmentIds.slice(1).map((id) => EnvironmentId.make(id))],
  createdBy: row.createdById === null
    ? null
    : { id: MemberId.make(row.createdById), name: row.createdByName!, email: row.createdByEmail! },
  createdAt: DateTime.makeUnsafe(row.createdAt)
})

/** Drops seconds: an Annotation marks a minute. */
const toMinute = (at: DateTime.Utc) => DateTime.makeUnsafe(Math.floor(DateTime.toEpochMillis(at) / 60_000) * 60_000)

export class Annotations extends Context.Service<Annotations, {
  readonly create: (
    member: MemberId,
    project: ProjectId,
    annotation: NewAnnotation
  ) => Effect.Effect<Annotation, ProjectNotFound | ProjectOwnerRequired | EnvironmentNotFound>
  readonly update: (
    member: MemberId,
    project: ProjectId,
    id: AnnotationId,
    changes: AnnotationChanges
  ) => Effect.Effect<Annotation, ProjectNotFound | ProjectOwnerRequired | AnnotationNotFound | EnvironmentNotFound>
  readonly delete: (
    member: MemberId,
    project: ProjectId,
    id: AnnotationId
  ) => Effect.Effect<void, ProjectNotFound | ProjectOwnerRequired | AnnotationNotFound>
  /** All of a Project's Annotations, newest first. Any Member of the Project may look. */
  readonly list: (member: MemberId, project: ProjectId) => Effect.Effect<Array<Annotation>, ProjectNotFound>
  /**
   * The Annotations that apply to an Environment and fall in a report's local range, oldest
   * first. The caller has checked access.
   */
  readonly inRange: (project: ProjectId, environment: EnvironmentId, range: ReportRange) => Effect.Effect<Array<Annotation>>
}>()("flock/Annotations") {
  static readonly layer = Layer.effect(
    Annotations,
    Effect.gen(function*() {
      const sql = yield* PgClient.PgClient
      const projects = yield* Projects

      const ownProject = (member: MemberId, id: ProjectId) =>
        projects.get(member, id).pipe(
          Effect.flatMap((project) =>
            project.role === "owner" ? Effect.void : Effect.fail(new ProjectOwnerRequired({ message: "Only a Project owner can do this" }))
          )
        )

      const select = (where: Fragment, order: "oldest" | "newest" = "oldest") =>
        sql<Row>`
          SELECT a.id, a.label, a.description, a.at, a.all_environments, a.created_at,
                 m.id AS created_by_id, m.name AS created_by_name, m.email AS created_by_email,
                 ARRAY(
                   SELECT ae.environment_id FROM annotation_environment ae JOIN environment e ON e.id = ae.environment_id
                   WHERE ae.annotation_id = a.id ORDER BY e.name
                 ) AS environment_ids
          FROM annotation a LEFT JOIN member m ON m.id = a.created_by
          WHERE ${where}
          ORDER BY ${
          order === "oldest" ? sql`a.at, a.created_at, a.id` : sql`a.at DESC, a.created_at DESC, a.id DESC`
        }`.pipe(Effect.map((rows) => rows.map(toAnnotation)), Effect.orDie)

      /** The narrowed set, deduplicated, after checking every id is one of the Project's Environments. */
      const checkEnvironments = (project: ProjectId, environments: AnnotationEnvironments) =>
        Effect.gen(function*() {
          if (environments === "all") return "all" as const
          const ids = [...new Set(environments)]
          const found = yield* sql<{ id: string }>`
            SELECT id FROM environment WHERE project_id = ${project} AND id IN ${sql.in(ids)}`.pipe(Effect.orDie)
          const known = new Set(found.map((row) => row.id))
          const missing = ids.find((id) => !known.has(id))
          if (missing !== undefined) return yield* new EnvironmentNotFound({ id: missing })
          return ids
        })

      /** Writes an Annotation's Environments: `all`, or replaces its set. */
      const setEnvironments = (id: AnnotationId, environments: "all" | Array<EnvironmentId>) =>
        Effect.gen(function*() {
          yield* sql`UPDATE annotation SET all_environments = ${environments === "all"} WHERE id = ${id}`
          yield* sql`DELETE FROM annotation_environment WHERE annotation_id = ${id}`
          if (environments === "all") return
          const [first, ...rest] = environments.map((environmentId) => ({ annotationId: id, environmentId }))
          if (first !== undefined) yield* sql`INSERT INTO annotation_environment ${sql.insert([first, ...rest])}`
        })

      return Annotations.of({
        create: (member, project, input) =>
          Effect.gen(function*() {
            yield* ownProject(member, project)
            const environments = yield* checkEnvironments(project, input.environments ?? "all")
            const now = yield* DateTime.now
            const id = AnnotationId.make(makeId("ann"))
            const description = input.description?.trim() ? input.description : null
            const insert = sql`INSERT INTO annotation ${
              sql.insert({
                id,
                projectId: project,
                label: input.label,
                description,
                at: DateTime.toDateUtc(toMinute(input.at ?? now)),
                createdBy: member,
                createdAt: DateTime.toDateUtc(now)
              })
            }`
            yield* sql.withTransaction(Effect.andThen(insert, setEnvironments(id, environments))).pipe(Effect.orDie)
            const [created] = yield* select(sql`a.id = ${id}`)
            return created!
          }),

        update: (member, project, id, changes) =>
          Effect.gen(function*() {
            yield* ownProject(member, project)
            const environments = changes.environments === undefined
              ? undefined
              : yield* checkEnvironments(project, changes.environments)
            const fields: Record<string, unknown> = {}
            if (changes.label !== undefined) fields.label = changes.label
            if (changes.description !== undefined) fields.description = changes.description?.trim() ? changes.description : null
            if (changes.at !== undefined) fields.at = DateTime.toDateUtc(toMinute(changes.at))
            const found = yield* sql.withTransaction(Effect.gen(function*() {
              const rows = yield* sql`SELECT id FROM annotation WHERE id = ${id} AND project_id = ${project} FOR UPDATE`
              if (rows.length === 0) return false
              if (Object.keys(fields).length > 0) yield* sql`UPDATE annotation SET ${sql.update(fields)} WHERE id = ${id}`
              if (environments !== undefined) yield* setEnvironments(id, environments)
              return true
            })).pipe(Effect.orDie)
            if (!found) return yield* new AnnotationNotFound({ id })
            const [updated] = yield* select(sql`a.id = ${id}`)
            return updated!
          }),

        delete: (member, project, id) =>
          Effect.gen(function*() {
            yield* ownProject(member, project)
            const deleted = yield* sql`DELETE FROM annotation WHERE id = ${id} AND project_id = ${project} RETURNING id`.pipe(Effect.orDie)
            if (deleted.length === 0) return yield* new AnnotationNotFound({ id })
          }),

        list: (member, project) =>
          projects.get(member, project).pipe(Effect.andThen(select(sql`a.project_id = ${project}`, "newest"))),

        inRange: (project, environment, range) =>
          select(sql`
            a.project_id = ${project}
            AND (a.all_environments OR EXISTS (
              SELECT 1 FROM annotation_environment ae WHERE ae.annotation_id = a.id AND ae.environment_id = ${environment}
            ))
            AND a.at >= (${range.from}::date::timestamp AT TIME ZONE ${range.timeZone})
            AND a.at < ((${range.to}::date + 1)::timestamp AT TIME ZONE ${range.timeZone})`)
      })
    })
  )
}
