// Annotations (spec #22). Expand only: a new table, so the previous release keeps working.
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

export default Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  // `all_environments` is its own state, not a copy of today's Environments: it also covers
  // Environments added later. A narrowed Annotation (false) lists its Environments elsewhere.
  yield* sql`
    CREATE TABLE annotation (
      id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project (id) ON DELETE CASCADE,
      label text NOT NULL,
      description text,
      at timestamptz NOT NULL,
      all_environments boolean NOT NULL DEFAULT true,
      created_by text REFERENCES member (id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL
    )`
  yield* sql`CREATE INDEX annotation_project_at ON annotation (project_id, at)`
})
