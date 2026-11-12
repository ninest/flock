// Projects, their Environments, and Project membership. Every call takes the
// acting Member: a Project they don't belong to answers "not found", as if it
// didn't exist. Changes need the owner role.
import { PgClient } from "@effect/sql-pg"
import {
  Environment,
  EnvironmentId,
  EnvironmentNameTaken,
  EnvironmentNotFound,
  type MemberId,
  PRODUCTION,
  ProductionProtected,
  Project,
  ProjectId,
  ProjectNotFound,
  ProjectOwnerRequired,
  type ProjectRole,
  type TrackingMode
} from "@flock/shared"
import { Context, Effect, Layer, Option } from "effect"
import { isSqlError, type SqlError } from "effect/sql/SqlError"
import { makeEnvironmentKey, makeId } from "./keys.ts"

interface Row {
  readonly projectId: string
  readonly projectName: string
  readonly timeZone: string
  readonly trackingMode: TrackingMode
  readonly role: ProjectRole
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
        project: { id: ProjectId.make(row.projectId), name: row.projectName, timeZone: row.timeZone, trackingMode: row.trackingMode, role: row.role },
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

/** An Environment as the Member may use it, with its Project's time zone for reports. */
export interface EnvironmentAccess {
  readonly id: EnvironmentId
  readonly name: string
  readonly projectId: ProjectId
  readonly timeZone: string
  readonly role: ProjectRole
}

export interface NewProject {
  readonly name: string
  readonly timeZone: string
  /** Becomes the Project's owner. None only for the development playground. */
  readonly owner: Option.Option<MemberId>
  /** Environments with fixed keys (the playground's). Default: `production` with a fresh key. */
  readonly environments?: ReadonlyArray<{ readonly name: string; readonly key: string }>
}

export class Projects extends Context.Service<Projects, {
  readonly list: (member: MemberId) => Effect.Effect<Array<Project>>
  readonly get: (member: MemberId, id: ProjectId) => Effect.Effect<Project, ProjectNotFound>
  readonly create: (project: NewProject) => Effect.Effect<ProjectId>
  readonly update: (
    member: MemberId,
    id: ProjectId,
    changes: {
      readonly name?: string | undefined
      readonly timeZone?: string | undefined
      readonly trackingMode?: TrackingMode | undefined
    }
  ) => Effect.Effect<Project, ProjectNotFound | ProjectOwnerRequired>
  readonly delete: (member: MemberId, id: ProjectId) => Effect.Effect<void, ProjectNotFound | ProjectOwnerRequired>
  readonly addEnvironment: (
    member: MemberId,
    id: ProjectId,
    name: string
  ) => Effect.Effect<Environment, ProjectNotFound | ProjectOwnerRequired | EnvironmentNameTaken>
  readonly deleteEnvironment: (
    member: MemberId,
    id: EnvironmentId
  ) => Effect.Effect<void, EnvironmentNotFound | ProjectOwnerRequired | ProductionProtected>
  readonly rotateKey: (member: MemberId, id: EnvironmentId) => Effect.Effect<Environment, EnvironmentNotFound | ProjectOwnerRequired>
  readonly deleteEvents: (
    member: MemberId,
    id: EnvironmentId
  ) => Effect.Effect<void, EnvironmentNotFound | ProjectOwnerRequired | ProductionProtected>
  /** An Environment the Member may read (any role). */
  readonly environment: (member: MemberId, id: EnvironmentId) => Effect.Effect<EnvironmentAccess, EnvironmentNotFound>
  /** The Project with an Environment that has this key, if any (for idempotent seeding). */
  readonly projectWithKey: (key: string) => Effect.Effect<Option.Option<ProjectId>>
  /** Adds the Member as owner unless they already belong to the Project. */
  readonly ensureOwner: (id: ProjectId, member: MemberId) => Effect.Effect<void>
}>()("flock/Projects") {
  static readonly layer = Layer.effect(
    Projects,
    Effect.gen(function*() {
      const sql = yield* PgClient.PgClient
      /** Database failures are defects (500), not errors callers handle. */
      const orDie = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        Effect.catchIf(effect, isSqlError, Effect.die) as Effect.Effect<A, Exclude<E, SqlError>, R>

      const select = (member: MemberId, project: ProjectId | undefined) =>
        sql<Row>`
          SELECT p.id AS project_id, p.name AS project_name, p.time_zone, p.tracking_mode, pm.role,
                 e.id AS environment_id, e.name AS environment_name, e.key
          FROM project p
          JOIN project_member pm ON pm.project_id = p.id AND pm.member_id = ${member}
          LEFT JOIN environment e ON e.project_id = p.id
          ${project ? sql`WHERE p.id = ${project}` : sql``}
          -- production first, then other Environments by name
          ORDER BY p.created_at, p.id, e.name <> ${PRODUCTION}, e.name`.pipe(Effect.map(toProjects))

      const get = (member: MemberId, id: ProjectId) =>
        select(member, id).pipe(
          orDie,
          Effect.flatMap((projects) => projects[0] ? Effect.succeed(projects[0]) : Effect.fail(new ProjectNotFound({ id })))
        )

      const requireOwner = (role: ProjectRole) =>
        role === "owner" ? Effect.void : Effect.fail(new ProjectOwnerRequired({ message: "Only a Project owner can do this" }))

      const ownProject = (member: MemberId, id: ProjectId) =>
        get(member, id).pipe(Effect.tap((project) => requireOwner(project.role)))

      const environment = (member: MemberId, id: EnvironmentId) =>
        sql<{ name: string; projectId: string; timeZone: string; role: ProjectRole }>`
          SELECT e.name, e.project_id, p.time_zone, pm.role
          FROM environment e
          JOIN project p ON p.id = e.project_id
          JOIN project_member pm ON pm.project_id = p.id AND pm.member_id = ${member}
          WHERE e.id = ${id}`.pipe(
          orDie,
          Effect.flatMap(([row]) =>
            row
              ? Effect.succeed({ id, name: row.name, projectId: ProjectId.make(row.projectId), timeZone: row.timeZone, role: row.role })
              : Effect.fail(new EnvironmentNotFound({ id }))
          )
        )

      const ownEnvironment = (member: MemberId, id: EnvironmentId) =>
        environment(member, id).pipe(Effect.tap((env) => requireOwner(env.role)))

      const notProduction = (env: EnvironmentAccess, message: string) =>
        env.name === PRODUCTION ? Effect.fail(new ProductionProtected({ message })) : Effect.void

      const insertEnvironment = (projectId: ProjectId, name: string, key: string) => {
        const row = { id: EnvironmentId.make(makeId("env")), projectId, name, key }
        return sql`INSERT INTO environment ${sql.insert(row)}`.pipe(
          Effect.as(new Environment({ id: row.id, name, key }))
        )
      }

      const deleteEventsOf = (environmentIds: ReadonlyArray<string>) =>
        environmentIds.length === 0 ? Effect.void : Effect.all([
          sql`DELETE FROM event WHERE environment_id IN ${sql.in(environmentIds)}`,
          sql`DELETE FROM session WHERE environment_id IN ${sql.in(environmentIds)}`
        ], { discard: true })

      const ensureOwner = (id: ProjectId, member: MemberId) =>
        sql`INSERT INTO project_member ${sql.insert({ projectId: id, memberId: member, role: "owner" })} ON CONFLICT DO NOTHING`.pipe(
          Effect.asVoid,
          orDie
        )

      return Projects.of({
        list: (member) => select(member, undefined).pipe(orDie),
        get,

        create: ({ environments, name, owner, timeZone }) =>
          sql.withTransaction(Effect.gen(function*() {
            const id = ProjectId.make(makeId("prj"))
            yield* sql`INSERT INTO project ${sql.insert({ id, name, timeZone })}`
            for (const env of environments ?? [{ name: PRODUCTION, key: makeEnvironmentKey(PRODUCTION) }]) {
              yield* insertEnvironment(id, env.name, env.key)
            }
            if (Option.isSome(owner)) yield* ensureOwner(id, owner.value)
            return id
          })).pipe(orDie),

        update: (member, id, changes) =>
          Effect.gen(function*() {
            yield* ownProject(member, id)
            const set = {
              ...(changes.name === undefined ? {} : { name: changes.name }),
              ...(changes.timeZone === undefined ? {} : { timeZone: changes.timeZone }),
              ...(changes.trackingMode === undefined ? {} : { trackingMode: changes.trackingMode })
            }
            if (Object.keys(set).length > 0) yield* sql`UPDATE project SET ${sql.update(set)} WHERE id = ${id}`.pipe(orDie)
            return yield* get(member, id)
          }),

        delete: (member, id) =>
          Effect.gen(function*() {
            const project = yield* ownProject(member, id)
            // Events have no foreign key (the table is partitioned), so delete them first.
            yield* sql.withTransaction(Effect.gen(function*() {
              yield* deleteEventsOf(project.environments.map((e) => e.id))
              yield* sql`DELETE FROM project WHERE id = ${id}`
            })).pipe(orDie)
          }),

        addEnvironment: (member, id, name) =>
          Effect.gen(function*() {
            const project = yield* ownProject(member, id)
            if (project.environments.some((e) => e.name === name)) return yield* new EnvironmentNameTaken({ name })
            return yield* insertEnvironment(id, name, makeEnvironmentKey(name)).pipe(orDie)
          }),

        deleteEnvironment: (member, id) =>
          Effect.gen(function*() {
            const env = yield* ownEnvironment(member, id)
            yield* notProduction(env, "The production Environment can't be deleted")
            yield* sql.withTransaction(Effect.gen(function*() {
              yield* deleteEventsOf([id])
              yield* sql`DELETE FROM environment WHERE id = ${id}`
            })).pipe(orDie)
          }),

        rotateKey: (member, id) =>
          Effect.gen(function*() {
            const env = yield* ownEnvironment(member, id)
            const key = makeEnvironmentKey(env.name)
            yield* sql`UPDATE environment SET key = ${key} WHERE id = ${id}`.pipe(orDie)
            return new Environment({ id, name: env.name, key })
          }),

        deleteEvents: (member, id) =>
          Effect.gen(function*() {
            const env = yield* ownEnvironment(member, id)
            yield* notProduction(env, "Events in the production Environment can't be deleted")
            yield* deleteEventsOf([id]).pipe(orDie)
          }),

        environment,

        projectWithKey: (key) =>
          sql<{ projectId: string }>`SELECT project_id FROM environment WHERE key = ${key}`.pipe(
            orDie,
            Effect.map(([row]) => Option.map(Option.fromNullishOr(row), (r) => ProjectId.make(r.projectId)))
          ),

        ensureOwner
      })
    })
  )
}
