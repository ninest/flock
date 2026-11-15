// Forward-only migrations, run on boot (the whole run is one transaction under a
// table lock, so concurrent boots are safe). Never edit a released migration:
// add a new `<next id>_<name>` entry. Each one must stay compatible with the
// previous release (expand/contract), and must not use non-transactional DDL
// such as CREATE INDEX CONCURRENTLY. See docs/migrations.md; CI boots the previous
// release's image against the migrated schema.
import { NodeServices } from "@effect/platform-node"
import { PgMigrator } from "@effect/sql-pg"
import { Layer } from "effect"
import init from "./0001_init.ts"
import members from "./0002_members.ts"
import invites from "./0003_invites.ts"
import projectMembers from "./0004_project_members.ts"
import visitorsSessions from "./0005_visitors_sessions.ts"
import ingestRules from "./0006_ingest_rules.ts"
import trackingMode from "./0007_tracking_mode.ts"
import eventSessionIndex from "./0008_event_session_index.ts"
import annotations from "./0009_annotations.ts"
import annotationEnvironments from "./0010_annotation_environments.ts"
import identifiedVisitors from "./0011_identified_visitors.ts"
import displayNames from "./0012_display_names.ts"

export const migrations = PgMigrator.fromRecord({
  "0001_init": init,
  "0002_members": members,
  "0003_invites": invites,
  "0004_project_members": projectMembers,
  "0005_visitors_sessions": visitorsSessions,
  "0006_ingest_rules": ingestRules,
  "0007_tracking_mode": trackingMode,
  "0008_event_session_index": eventSessionIndex,
  "0009_annotations": annotations,
  "0010_annotation_environments": annotationEnvironments,
  "0011_identified_visitors": identifiedVisitors,
  "0012_display_names": displayNames
})

export const MigratorLive = PgMigrator.layer({ loader: migrations, table: "flock_migrations" }).pipe(
  Layer.provide(NodeServices.layer)
)
