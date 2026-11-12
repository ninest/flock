// Project membership: which Members may see a Project, and with which role.
// A new table only, so the previous release keeps working against this schema.
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

export default Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  yield* sql`
    CREATE TABLE project_member (
      project_id text NOT NULL REFERENCES project (id) ON DELETE CASCADE,
      member_id text NOT NULL REFERENCES member (id) ON DELETE CASCADE,
      role text NOT NULL CHECK (role IN ('owner', 'viewer')),
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (project_id, member_id)
    )`
  yield* sql`CREATE INDEX project_member_member ON project_member (member_id)`
})
