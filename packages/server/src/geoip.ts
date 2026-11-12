import { Context, Effect, Layer } from "effect"
import { type CityResponse, Reader } from "mmdb-lib"
import { readFile } from "node:fs/promises"

export interface GeoLocation {
  /** ISO 3166-1 alpha-2 country code, or null when unknown. */
  readonly country: string | null
  /** Region (state, province) name in English, or null when unknown or the database has none. */
  readonly region: string | null
}

const unknown: GeoLocation = { country: null, region: null }

/** IP address -> location. Its own service so tests can swap in a fixed table. */
export class GeoIp extends Context.Service<GeoIp, {
  readonly lookup: (ip: string) => Effect.Effect<GeoLocation>
}>()("flock/GeoIp") {
  /** Resolves every IP to an unknown location. */
  static readonly layerUnknown = Layer.succeed(GeoIp, GeoIp.of({ lookup: () => Effect.succeed(unknown) }))

  /**
   * Reads a MaxMind-format database (`.mmdb`), such as the bundled DB-IP IP to Country Lite.
   * A City database also yields regions. When the file can't be read, every IP resolves
   * to an unknown location and a warning is logged, so a missing database never stops ingest.
   */
  static readonly layerMmdb = (path: string) =>
    Layer.effect(
      GeoIp,
      Effect.tryPromise(() => readFile(path)).pipe(
        Effect.map((buffer) => {
          const reader = new Reader<CityResponse>(buffer)
          return GeoIp.of({
            lookup: (ip) =>
              Effect.sync(() => {
                try {
                  const record = reader.get(ip)
                  return {
                    country: record?.country?.iso_code ?? null,
                    region: record?.subdivisions?.[0]?.names?.en ?? null
                  }
                } catch {
                  return unknown // not an IP address
                }
              })
          })
        }),
        Effect.tap(() => Effect.logInfo(`GeoIP database loaded from ${path}`)),
        Effect.catch(() =>
          Effect.logWarning(`No GeoIP database at ${path}; countries and regions will be unknown`).pipe(
            Effect.as(GeoIp.of({ lookup: () => Effect.succeed(unknown) }))
          )
        )
      )
    )

  /** Test layer: looks IPs up in a fixed table of country codes (or countries with regions). */
  static readonly layerFixed = (table: Record<string, string | { readonly country: string; readonly region?: string }>) =>
    Layer.succeed(
      GeoIp,
      GeoIp.of({
        lookup: (ip) =>
          Effect.sync(() => {
            const entry = table[ip]
            if (entry === undefined) return unknown
            if (typeof entry === "string") return { country: entry, region: null }
            return { country: entry.country, region: entry.region ?? null }
          })
      })
    )
}
