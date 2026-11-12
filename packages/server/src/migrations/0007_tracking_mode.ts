// Tracking mode and Identify (ADR 0002). Expand only: a defaulted column (the previous
// release keeps inserting Projects without it), a new table and an index.
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

export default Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  yield* sql`
    ALTER TABLE project ADD COLUMN tracking_mode text NOT NULL DEFAULT 'cookieless'
      CHECK (tracking_mode IN ('cookieless', 'persistent'))`
  // Identify: a persistent device Visitor ID linked to the tracked app's own ID, which
  // becomes the Visitor ID of that device's Events from then on.
  yield* sql`
    CREATE TABLE visitor_alias (
      project_id text NOT NULL REFERENCES project (id) ON DELETE CASCADE,
      device_id text NOT NULL,
      visitor_id text NOT NULL,
      PRIMARY KEY (project_id, device_id)
    )`
  // Identify moves a device's earlier Events over to the identified Visitor.
  yield* sql`CREATE INDEX event_environment_visitor ON event (environment_id, visitor_id)`
})
