// The server's services, without infrastructure (Postgres, migrations, GeoIP,
// AuthConfig, HTTP). Better Auth keeps its own pool, so it takes the database URL.
// main.ts provides the real infrastructure; the Seam 1 harness provides test layers.
import { Layer, type Redacted } from "effect"
import { Access } from "./access.ts"
import { AdminBootstrap } from "./admin-command.ts"
import { BetterAuth } from "./auth.ts"
import { Enrichment } from "./enrichment.ts"
import { EventPartitions } from "./event-partitions.ts"
import { Ingest } from "./ingest.ts"
import { Projects } from "./projects.ts"
import { Queries } from "./queries.ts"
import { Seed } from "./seed.ts"
import { Sessions } from "./sessions.ts"
import { Visitors } from "./visitors.ts"

export const AppLive = (databaseUrl: Redacted.Redacted<string>) =>
  Layer.mergeAll(Queries.layer, Seed.layer, EventPartitions.maintenance, AdminBootstrap).pipe(
    Layer.provideMerge(Projects.layer),
    // Ingest owns Events (and, through Sessions, their Sessions); Projects deletes them through it.
    Layer.provideMerge(Ingest.layer),
    Layer.provideMerge(Layer.mergeAll(Visitors.layer, Sessions.layer)),
    Layer.provideMerge(Enrichment.layer),
    Layer.provideMerge(EventPartitions.layer),
    Layer.provideMerge(BetterAuth.layer(databaseUrl)),
    Layer.provideMerge(Access.layer)
  )
