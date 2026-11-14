// Identified Visitors, kept for good (ADR 0005, #38). Expand only: a new table, which the
// previous release never reads or writes; an Identify it handles while both run is recorded
// by the next Identify of that ID.
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

export default Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  // The Visitor IDs of a Project that an Identify named. Unlike `visitor_alias`, whose rows
  // follow a device to the account it switches to, a row here is never removed.
  yield* sql`
    CREATE TABLE identified_visitor (
      project_id text NOT NULL REFERENCES project (id) ON DELETE CASCADE,
      visitor_id text NOT NULL,
      PRIMARY KEY (project_id, visitor_id)
    )`
  // Backfill from the devices linked today. An ID whose only device already switched to
  // another account left no trace and stays anonymous.
  yield* sql`
    INSERT INTO identified_visitor (project_id, visitor_id)
    SELECT DISTINCT project_id, visitor_id FROM visitor_alias`
})
