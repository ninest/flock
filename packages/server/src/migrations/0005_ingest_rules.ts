// Ingest rules (#6): allowed origins per Environment, and Event UUID dedupe.
// Additive only, so the previous release keeps working against this schema.
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

export default Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  // Empty: any public origin (production's default). See AllowedOrigins in @flock/shared.
  yield* sql`ALTER TABLE environment ADD COLUMN allowed_origins jsonb NOT NULL DEFAULT '[]'::jsonb`
  yield* sql`UPDATE environment SET allowed_origins = '["localhost", "*.ts.net"]'::jsonb WHERE name <> 'production'`
  // One row per stored Event: the partitioned event table can't hold a unique index
  // without the partition key, so UUID uniqueness lives here (ADR 0003).
  yield* sql`
    CREATE TABLE event_uuid (
      environment_id text NOT NULL REFERENCES environment (id) ON DELETE CASCADE,
      uuid uuid NOT NULL,
      PRIMARY KEY (environment_id, uuid)
    )`
})
