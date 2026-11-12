// Projects and their Environments.
import { PgClient } from "@effect/sql-pg"
import { Environment, EnvironmentId, Project, ProjectId } from "@flock/shared"
import { Context, Effect, Layer } from "effect"
import type { SqlError } from "effect/sql/SqlError"

interface Row {
  readonly projectId: string
  readonly projectName: string
  readonly timeZone: string
  readonly environmentId: string | null
  readonly environmentName: string | null
  readonly key: string | null
}

/** Groups joined project/environment rows into Projects, keeping row order. */
const toProjects = (rows: ReadonlyArray<Row>): Array<Project> => {
  const byId = new Map<string, { project: Omit<Project, "environments">; environments: Array<Environment> }>()
  for (const row of rows) {
    let entry = byId.get(row.projectId)
    if (!entry) {
      entry = {
        project: { id: ProjectId.make(row.projectId), name: row.projectName, timeZone: row.timeZone },
        environments: []
      }
      byId.set(row.projectId, entry)
    }
    if (row.environmentId !== null) {
      entry.environments.push(
        new Environment({ id: EnvironmentId.make(row.environmentId), name: row.environmentName!, key: row.key! })
      )
    }
  }
  return [...byId.values()].map(({ project, environments }) => new Project({ ...project, environments }))
}

export class Projects extends Context.Service<Projects, {
  readonly list: Effect.Effect<Array<Project>, SqlError>
  readonly get: (id: ProjectId) => Effect.Effect<Project | undefined, SqlError>
}>()("flock/Projects") {
  static readonly layer = Layer.effect(
    Projects,
    Effect.gen(function*() {
      const sql = yield* PgClient.PgClient
      const select = (where: ReturnType<typeof sql.and> | undefined) =>
        sql<Row>`
          SELECT p.id AS project_id, p.name AS project_name, p.time_zone,
                 e.id AS environment_id, e.name AS environment_name, e.key
          FROM project p LEFT JOIN environment e ON e.project_id = p.id
          ${where ? sql`WHERE ${where}` : sql``}
          -- production first, then other Environments by name
          ORDER BY p.created_at, p.id, e.name <> 'production', e.name`.pipe(Effect.map(toProjects))
      return Projects.of({
        list: select(undefined),
        get: (id) => select(sql.and([sql`p.id = ${id}`])).pipe(Effect.map((ps) => ps[0]))
      })
    })
  )
}
