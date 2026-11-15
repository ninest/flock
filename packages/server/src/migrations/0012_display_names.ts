// Display names (#50). Expand only: nullable columns the previous release never reads or writes; a
// name it receives while both run is recorded by the Visitor's next Identify that carries one.
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

export default Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  // The Display name of the latest Identify that carried one, and that Identify's Event time, so a
  // late Identify with an earlier timestamp never overwrites a newer name.
  yield* sql`
    ALTER TABLE identified_visitor
      ADD COLUMN display_name text,
      ADD COLUMN display_name_at timestamptz`
})
