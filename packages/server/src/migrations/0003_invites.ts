// Open sign-up and Invites (#13).
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

export default Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  // A single row of Instance-wide settings.
  yield* sql`
    CREATE TABLE instance_settings (
      singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
      open_sign_up boolean NOT NULL DEFAULT false
    )`
  yield* sql`INSERT INTO instance_settings DEFAULT VALUES`
  // Only a hash of each Invite's token is kept; the token itself is shown once.
  yield* sql`
    CREATE TABLE invite (
      id text PRIMARY KEY,
      token_hash text NOT NULL UNIQUE,
      note text NOT NULL,
      created_by text REFERENCES member (id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL,
      used_at timestamptz,
      used_by text
    )`
})
