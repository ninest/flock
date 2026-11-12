// Typed client derived from the shared FlockApi (same origin; Vite proxies /api in dev).
import { FlockApi } from "@flock/shared"
import { Effect } from "effect"
import { FetchHttpClient } from "effect/http"
import { HttpApiClient } from "effect/http-api"

export type Client = HttpApiClient.ForApi<typeof FlockApi>

const client = HttpApiClient.make(FlockApi, { baseUrl: window.location.origin }).pipe(
  Effect.provide(FetchHttpClient.layer)
)

/** Runs a request against the API, e.g. `request((api) => api.projects.list())`. */
export const request = <A, E>(f: (api: Client) => Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(Effect.flatMap(client, f))
