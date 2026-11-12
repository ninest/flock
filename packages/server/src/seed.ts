// Seeding Projects and Members directly (their APIs arrive later). Used by `make dev`
// for the playground Project, and by the Seam 1 harness to set up fixtures.
import { PgClient } from "@effect/sql-pg"
import { type MemberId, type Project, ProjectId } from "@flock/shared"
import { Array as Arr, Context, Effect, Layer } from "effect"
import type { SqlError } from "effect/sql/SqlError"
import { makeEnvironmentKey, makeId } from "./keys.ts"
import { BetterAuth } from "./auth.ts"
import { Projects } from "./projects.ts"

export interface SeedProject {
  readonly name: string
  readonly timeZone: string
  /** A missing key is generated. With fixed keys, seeding is idempotent. */
  readonly environments: ReadonlyArray<{ readonly name: string; readonly key?: string }>
}

export class Seed extends Context.Service<Seed, {
  readonly project: (seed: SeedProject) => Effect.Effect<Project, SqlError>
  /** A Member who signs in with email + password (not an Instance admin). */
  readonly member: (seed: { readonly email: string; readonly password: string; readonly name?: string }) => Effect.Effect<MemberId>
}>()("flock/Seed") {
  static readonly layer = Layer.effect(
    Seed,
    Effect.gen(function*() {
      const sql = yield* PgClient.PgClient
      const projects = yield* Projects
      const auth = yield* BetterAuth

      const project = (seed: SeedProject) =>
        sql.withTransaction(Effect.gen(function*() {
          const keys = seed.environments.flatMap((e) => (e.key ? [e.key] : []))
          const [existing] = keys.length > 0
            ? yield* sql<{ projectId: string }>`SELECT project_id FROM environment WHERE key IN ${sql.in(keys)} LIMIT 1`
            : []
          const id = ProjectId.make(existing?.projectId ?? makeId("prj"))
          if (!existing) {
            yield* sql`INSERT INTO project ${sql.insert({ id, name: seed.name, timeZone: seed.timeZone })}`
            const environments = seed.environments.map((e) => ({
              id: makeId("env"),
              projectId: id,
              name: e.name,
              key: e.key ?? makeEnvironmentKey(e.name)
            }))
            if (Arr.isArrayNonEmpty(environments)) yield* sql`INSERT INTO environment ${sql.insert(environments)}`
          }
          return (yield* projects.get(id))!
        }))

      return Seed.of({
        project,
        member: ({ email, name, password }) => auth.createMember({ email, password, name: name ?? email.split("@")[0]! })
      })
    })
  )

  /** The playground's Project, with fixed keys so the playground can be configured statically. */
  static readonly playground = Layer.effectDiscard(
    Effect.gen(function*() {
      const seed = yield* Seed
      const project = yield* seed.project({
        name: "Playground",
        timeZone: "UTC",
        environments: [
          { name: "production", key: "pk_production_playground" },
          { name: "dev", key: "pk_dev_playground" }
        ]
      })
      yield* Effect.logInfo(`Seeded Project "${project.name}" (${project.environments.map((e) => e.key).join(", ")})`)
    })
  )
}
