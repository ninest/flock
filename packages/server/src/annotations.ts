// Annotations: short dated notes on a Project, drawn on the time charts. Every Member of the
// Project sees them; only owners add or delete them.
import { PgClient } from "@effect/sql-pg"
import {
  type Annotation,
  AnnotationId,
  AnnotationNotFound,
  type EnvironmentId,
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
  environments: "all",
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
  ) => Effect.Effect<Annotation, ProjectNotFound | ProjectOwnerRequired>
  readonly delete: (
    member: MemberId,
    project: ProjectId,
    id: AnnotationId
  ) => Effect.Effect<void, ProjectNotFound | ProjectOwnerRequired | AnnotationNotFound>
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

      const select = (where: Fragment) =>
        sql<Row>`
          SELECT a.id, a.label, a.description, a.at, a.all_environments, a.created_at,
                 m.id AS created_by_id, m.name AS created_by_name, m.email AS created_by_email
          FROM annotation a LEFT JOIN member m ON m.id = a.created_by
          WHERE ${where}
          ORDER BY a.at, a.created_at, a.id`.pipe(Effect.map((rows) => rows.map(toAnnotation)), Effect.orDie)

      return Annotations.of({
        create: (member, project, input) =>
          Effect.gen(function*() {
            yield* ownProject(member, project)
            const now = yield* DateTime.now
            const id = AnnotationId.make(makeId("ann"))
            const description = input.description?.trim() ? input.description : null
            yield* sql`INSERT INTO annotation ${
              sql.insert({
                id,
                projectId: project,
                label: input.label,
                description,
                at: DateTime.toDateUtc(toMinute(input.at ?? now)),
                createdBy: member,
                createdAt: DateTime.toDateUtc(now)
              })
            }`.pipe(Effect.orDie)
            const [created] = yield* select(sql`a.id = ${id}`)
            return created!
          }),

        delete: (member, project, id) =>
          Effect.gen(function*() {
            yield* ownProject(member, project)
            const deleted = yield* sql`DELETE FROM annotation WHERE id = ${id} AND project_id = ${project} RETURNING id`.pipe(Effect.orDie)
            if (deleted.length === 0) return yield* new AnnotationNotFound({ id })
          }),

        inRange: (project, _environment, range) =>
          select(sql`
            a.project_id = ${project}
            AND a.all_environments
            AND a.at >= (${range.from}::date::timestamp AT TIME ZONE ${range.timeZone})
            AND a.at < ((${range.to}::date + 1)::timestamp AT TIME ZONE ${range.timeZone})`)
      })
    })
  )
}
