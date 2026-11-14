// Annotations narrowed to some Environments (spec #22). Expand only: a new table, so the
// previous release keeps working (it reads only `annotation.all_environments`).
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

export default Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  // The Environments of a narrowed Annotation (`all_environments` false). Deleting an
  // Environment drops its rows; the Annotations left with none are deleted alongside.
  yield* sql`
    CREATE TABLE annotation_environment (
      annotation_id text NOT NULL REFERENCES annotation (id) ON DELETE CASCADE,
      environment_id text NOT NULL REFERENCES environment (id) ON DELETE CASCADE,
      PRIMARY KEY (annotation_id, environment_id)
    )`
  yield* sql`CREATE INDEX annotation_environment_environment ON annotation_environment (environment_id)`
})
