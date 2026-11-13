import { Effect } from "effect"
import { SqlClient } from "effect/sql"

export default Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  yield* sql`
    CREATE TABLE project (
      id text PRIMARY KEY,
      name text NOT NULL,
      time_zone text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`
  yield* sql`
    CREATE TABLE environment (
      id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project (id) ON DELETE CASCADE,
      name text NOT NULL,
      key text NOT NULL UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (project_id, name)
    )`
  // Raw Events, partitioned by UTC day on `ts`. Daily partitions are created ahead
  // of time by EventPartitions (see src/event-partitions.ts); there is deliberately
  // no DEFAULT partition, so a missing partition can never trap rows.
  yield* sql`
    CREATE TABLE event (
      environment_id text NOT NULL,
      uuid uuid NOT NULL,
      name text NOT NULL,
      ts timestamptz NOT NULL,
      received_at timestamptz NOT NULL,
      properties jsonb NOT NULL DEFAULT '{}'::jsonb
    ) PARTITION BY RANGE (ts)`
  yield* sql`CREATE INDEX event_environment_ts ON event (environment_id, ts)`
  yield* sql`CREATE INDEX event_properties ON event USING gin (properties jsonb_path_ops)`
})
