// Migration 0011 on a database that already holds device links (#38): the schema as of 0010,
// some Identify links in it, then 0011.
import { PgClient } from "@effect/sql-pg"
import { assert, layer } from "@effect/vitest"
import { Effect, Redacted } from "effect"
import { Reactivity } from "effect/reactivity"
import { SqlClient } from "effect/sql"
import { TestDatabase } from "./test-database.ts"

const before = [
  "0001_init",
  "0002_members",
  "0003_invites",
  "0004_project_members",
  "0005_visitors_sessions",
  "0006_ingest_rules",
  "0007_tracking_mode",
  "0008_event_session_index",
  "0009_annotations",
  "0010_annotation_environments"
]

layer(TestDatabase.layer)("Identified Visitors migration", (it) => {
  it.effect("Visitors identified before the migration are still identified after it, per Project", () =>
    Effect.gen(function*() {
      const sql = yield* PgClient.makeClient({ url: Redacted.make(yield* TestDatabase) })
      const migrate = (name: string) =>
        Effect.promise(() => import(`../src/migrations/${name}.ts`)).pipe(
          Effect.flatMap((module) => module.default as Effect.Effect<void, unknown, SqlClient.SqlClient>),
          Effect.provideService(SqlClient.SqlClient, sql)
        )
      for (const name of before) yield* migrate(name)
      yield* sql.unsafe(`INSERT INTO project (id, name, time_zone) VALUES ('p1', 'One', 'UTC'), ('p2', 'Two', 'UTC')`)
      // Anna on two devices, Ben on one, and another Project's Visitor with Anna's ID.
      yield* sql.unsafe(`INSERT INTO visitor_alias (project_id, device_id, visitor_id) VALUES
        ('p1', 'laptop', 'anna'), ('p1', 'phone', 'anna'), ('p1', 'tablet', 'ben'), ('p2', 'laptop', 'anna')`)

      yield* migrate("0011_identified_visitors")

      const rows = yield* sql<{ project_id: string; visitor_id: string }>`
        SELECT project_id, visitor_id FROM identified_visitor ORDER BY project_id, visitor_id`
      assert.deepStrictEqual(rows.map((row) => `${row.project_id}/${row.visitor_id}`), ["p1/anna", "p1/ben", "p2/anna"])
    }).pipe(Effect.scoped, Effect.provide(Reactivity.layer)))
})
