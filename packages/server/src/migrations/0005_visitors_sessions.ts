// Visitors and Sessions. Expand only: nullable columns on `event` (the previous
// release keeps inserting without them) and new tables.
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

export default Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  yield* sql`ALTER TABLE event ADD COLUMN visitor_id text, ADD COLUMN session_id text`
  // One random salt per UTC day for cookieless Visitor IDs. Old salts are deleted,
  // so a Visitor ID can't be recomputed from an IP and user agent afterwards.
  yield* sql`
    CREATE TABLE visitor_salt (
      day date PRIMARY KEY,
      salt text NOT NULL
    )`
  // Open and past Sessions, used to assign each new Event to a Session.
  yield* sql`
    CREATE TABLE session (
      id text PRIMARY KEY,
      environment_id text NOT NULL REFERENCES environment (id) ON DELETE CASCADE,
      visitor_id text NOT NULL,
      started_at timestamptz NOT NULL,
      last_seen_at timestamptz NOT NULL
    )`
  yield* sql`CREATE INDEX session_visitor ON session (environment_id, visitor_id, last_seen_at)`
})
