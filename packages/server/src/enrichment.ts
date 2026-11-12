// Enrichment: one Event's properties + the request it came in -> the properties Flock stores.
// Adds $country, $region, $browser, $os and $device, strips query strings from URLs
// except utm_* parameters, and copies those from $url into $utm_source and friends. The request IP is only used for the GeoIP lookup, never returned.
import Bowser from "bowser"
import { Context, Effect, Layer } from "effect"
import { GeoIp } from "./geoip.ts"

/** What Enrichment knows about the request a batch came in. */
export interface RequestContext {
  /** The client IP (first X-Forwarded-For address, else the socket address). */
  readonly ip: string | null
  readonly userAgent: string | null
}

/** Properties Flock derives itself; values sent by the client are replaced. */
export const AUDIENCE_PROPERTIES = ["$country", "$region", "$browser", "$os", "$device"] as const

/** UTM tags copied from `$url` into `$utm_…` properties; values sent by the client are replaced. */
export const UTM_TAGS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const

/** Event properties holding URLs that get cleaned. */
const URL_PROPERTIES = ["$url", "$referrer"] as const

type Properties = Readonly<Record<string, unknown>>

export class Enrichment extends Context.Service<Enrichment, {
  /** Derives the audience properties for one request, shared by every Event in its batch. */
  readonly audience: (request: RequestContext) => Effect.Effect<Properties>
  /** One Event's properties with URLs cleaned and the audience properties set. */
  readonly enrich: (properties: Properties, audience: Properties) => Properties
}>()("flock/Enrichment") {
  static readonly layer = Layer.effect(
    Enrichment,
    Effect.gen(function*() {
      const geoIp = yield* GeoIp

      const audience = Effect.fn("Enrichment.audience")(function*(request: RequestContext) {
        const location = request.ip ? yield* geoIp.lookup(request.ip) : { country: null, region: null }
        const agent = request.userAgent ? parseUserAgent(request.userAgent) : {}
        return withoutNulls({
          $country: location.country,
          $region: location.region,
          ...agent
        })
      })

      const enrich = (properties: Properties, audience: Properties): Properties => {
        const result: Record<string, unknown> = { ...properties }
        for (const key of AUDIENCE_PROPERTIES) delete result[key]
        for (const tag of UTM_TAGS) delete result[`$${tag}`]
        for (const key of URL_PROPERTIES) {
          const value = result[key]
          if (typeof value === "string") result[key] = cleanUrl(value)
        }
        return { ...result, ...utmTags(result["$url"]), ...audience }
      }

      return Enrichment.of({ audience, enrich })
    })
  )
}

const withoutNulls = (record: Record<string, string | null | undefined>) =>
  Object.fromEntries(Object.entries(record).filter(([, value]) => value != null && value !== ""))

/** Browser, OS and device type (`desktop`, `mobile`, `tablet`, `tv`) from a User-Agent header. */
const parseUserAgent = (userAgent: string) => {
  const parser = Bowser.getParser(userAgent)
  return {
    $browser: parser.getBrowserName(),
    $os: parser.getOSName(),
    $device: parser.getPlatformType(true)
  }
}

/** `$utm_source` etc. from a URL's query (tag names are case-insensitive; the first one wins). */
const utmTags = (url: unknown): Record<string, string> => {
  if (typeof url !== "string") return {}
  let params: URLSearchParams
  try {
    params = new URL(url).searchParams
  } catch {
    return {}
  }
  const tags: Record<string, string> = {}
  for (const [name, value] of params) {
    const tag = name.toLowerCase()
    if ((UTM_TAGS as ReadonlyArray<string>).includes(tag) && value !== "" && !(`$${tag}` in tags)) tags[`$${tag}`] = value
  }
  return tags
}

/**
 * Drops every query parameter except `utm_*`, so tokens or emails in URLs are never stored.
 * The fragment is kept (hash-routed SPAs use it for pages). Strings that aren't absolute
 * URLs lose everything from `?` up to the fragment.
 */
export const cleanUrl = (value: string): string => {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    const query = value.indexOf("?")
    if (query === -1) return value
    const hash = value.indexOf("#", query)
    return value.slice(0, query) + (hash === -1 ? "" : value.slice(hash))
  }
  const kept = [...url.searchParams].filter(([name]) => name.toLowerCase().startsWith("utm_"))
  url.search = new URLSearchParams(kept).toString()
  return url.toString()
}
