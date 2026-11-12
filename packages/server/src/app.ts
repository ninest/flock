// The server's services, without infrastructure (Postgres, migrations, GeoIP, HTTP).
// main.ts provides the real infrastructure; the Seam 1 harness provides test layers.
import { Layer } from "effect"
import { EventPartitions } from "./event-partitions.ts"
import { Ingest } from "./ingest.ts"
import { Projects } from "./projects.ts"
import { Reports } from "./reports.ts"
import { Seed } from "./seed.ts"

export const AppLive = Layer.mergeAll(Ingest.layer, Reports.layer, Seed.layer, EventPartitions.maintenance).pipe(
  Layer.provideMerge(Projects.layer),
  Layer.provideMerge(EventPartitions.layer)
)
