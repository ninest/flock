// Forward-only migrations, run on boot (the whole run is one transaction under a
// table lock, so concurrent boots are safe). Never edit a released migration:
// add a new `<next id>_<name>` entry. Each one must stay compatible with the
// previous release (expand/contract), and must not use non-transactional DDL
// such as CREATE INDEX CONCURRENTLY.
import { NodeServices } from "@effect/platform-node"
import { PgMigrator } from "@effect/sql-pg"
import { Layer } from "effect"
import init from "./0001_init.ts"

export const migrations = PgMigrator.fromRecord({
  "0001_init": init
})

export const MigratorLive = PgMigrator.layer({ loader: migrations, table: "flock_migrations" }).pipe(
  Layer.provide(NodeServices.layer)
)
