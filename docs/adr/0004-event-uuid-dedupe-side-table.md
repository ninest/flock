# Event UUID dedupe in a side table

A repeated Event UUID must be ignored, but the `event` table is partitioned by day on `ts`, and Postgres only allows a unique index on a partitioned table if it includes the partition key. Each Environment's Event UUIDs are therefore kept unique in a separate, unpartitioned `event_uuid (environment_id, uuid)` table. Ingest writes it with `ON CONFLICT DO NOTHING RETURNING uuid` in the same transaction as the Events, and stores only the Events whose UUID came back. Deleting an Environment's Events deletes its UUIDs too, so the same Events can be sent again.

## Considered Options

- **Unique `(environment_id, uuid, ts)` on `event`**: rejected. A retry of an Event without a client timestamp, or one whose timestamp fell outside the 24-hour window, gets a new `ts`, so it would be stored twice.
- **Look up the UUID before inserting**: rejected. Concurrent retries race, and without a time bound the lookup scans every partition.

## Consequences

`event_uuid` grows by one small row per Event and is never pruned while its Events exist. A future per-Project retention policy has to delete the matching `event_uuid` rows along with the dropped partitions.
