import { Context, Effect, Layer } from "effect"

export interface GeoLocation {
  /** ISO 3166-1 alpha-2 country code, or null when unknown. */
  readonly country: string | null
}

/** IP address -> location. Its own service so tests can swap in a fixed table. */
export class GeoIp extends Context.Service<GeoIp, {
  readonly lookup: (ip: string) => Effect.Effect<GeoLocation>
}>()("flock/GeoIp") {
  /** Resolves every IP to an unknown location (until a GeoIP database is bundled). */
  static readonly layerUnknown = Layer.succeed(GeoIp, GeoIp.of({ lookup: () => Effect.succeed({ country: null }) }))

  /** Test layer: looks IPs up in a fixed table. */
  static readonly layerFixed = (table: Record<string, string>) =>
    Layer.succeed(GeoIp, GeoIp.of({ lookup: (ip) => Effect.succeed({ country: table[ip] ?? null }) }))
}
