// The server's services, without infrastructure (Postgres, migrations, GeoIP,
// AuthConfig, HTTP). Better Auth keeps its own pool, so it takes the database URL.
// main.ts provides the real infrastructure; the Seam 1 harness provides test layers.
import { Layer, type Redacted } from "effect"
import { Access } from "./access.ts"
import { BetterAuth } from "./auth.ts"
import { EventPartitions } from "./event-partitions.ts"
import { Ingest } from "./ingest.ts"
import { Projects } from "./projects.ts"
import { Reports } from "./reports.ts"
import { Seed } from "./seed.ts"

export const AppLive = (databaseUrl: Redacted.Redacted<string>) =>
  Layer.mergeAll(Ingest.layer, Reports.layer, Seed.layer, EventPartitions.maintenance).pipe(
    Layer.provideMerge(Projects.layer),
    Layer.provideMerge(EventPartitions.layer),
    Layer.provideMerge(BetterAuth.layer(databaseUrl)),
    Layer.provideMerge(Access.layer)
  )
