// The Session timeline and Recent sessions read a Session's Events. Expand only: a new index.
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

export default Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE INDEX event_environment_session ON event (environment_id, session_id, ts)`
})
