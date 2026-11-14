// The Ingest pipeline's rules, as pure steps (see ingest.ts for the order):
// origin check, bot filter, per-Event validation and limits, and the Event time.
import { IngestEvent, IngestLimits } from "@flock/shared"
import { DateTime, Duration, Option, Result, Schema } from "effect"
import { AUDIENCE_PROPERTIES } from "./enrichment.ts"

// --- Origins -----------------------------------------------------------------

const isPrivateIpv4 = (host: string) => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) // 100.64/10: carrier-grade NAT, Tailscale
}

/** The eight 16-bit groups of an IPv6 address as URL hostnames serialize it (compressed, hex only). */
const ipv6Groups = (ip: string): ReadonlyArray<number> | undefined => {
  const [head, tail, ...rest] = ip.split("::")
  if (rest.length > 0) return undefined
  const parse = (part: string | undefined) => (part ? part.split(":").map((g) => parseInt(g, 16)) : [])
  const left = parse(head)
  const right = parse(tail)
  const groups = tail === undefined ? left : [...left, ...Array(8 - left.length - right.length).fill(0), ...right]
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : undefined
}

/** A bracketed IPv6 literal that isn't publicly routable; IPv4-mapped addresses are judged as IPv4. */
const isPrivateIpv6 = (host: string) => {
  const groups = ipv6Groups(host.slice(1, -1))
  if (groups === undefined) return true
  const [first, , , , , mapped, high, low] = groups as [number, number, number, number, number, number, number, number]
  if (groups.slice(0, 5).every((g) => g === 0) && mapped === 0xffff) {
    return isPrivateIpv4([high >> 8, high & 0xff, low >> 8, low & 0xff].join("."))
  }
  return (groups.slice(0, 7).every((g) => g === 0) && low <= 1) || // :: (unspecified) and ::1 (loopback)
    (first & 0xfe00) === 0xfc00 || // fc00::/7, unique local
    (first & 0xffc0) === 0xfe80 // fe80::/10, link-local
}

const PRIVATE_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa", ".ts.net"]

/** localhost, private-network addresses (IPv4 and IPv6) and names, and single-label intranet names such as `hel`. */
export const isPrivateHost = (host: string) =>
  host.startsWith("[")
    ? isPrivateIpv6(host)
    : host === "localhost" || !host.includes(".") || isPrivateIpv4(host) ||
      PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))

const matches = (host: string, pattern: string) => {
  const p = pattern.toLowerCase()
  if (p === "*") return true
  if (p.startsWith("*.")) return host.endsWith(p.slice(1))
  return host === p
}

/**
 * Whether a browser request from `origin` may send Events to an Environment with these
 * allowed origins (see AllowedOrigins). Requests without an Origin aren't browser requests.
 */
export const originAllowed = (origin: string | undefined, allowedOrigins: ReadonlyArray<string>): boolean => {
  if (origin === undefined) return true
  if (allowedOrigins.includes("*")) return true
  let host: string
  try {
    host = new URL(origin).hostname.toLowerCase()
  } catch {
    return false // "null" (sandboxed pages, file://) and garbage
  }
  if (host === "") return false
  if (allowedOrigins.length === 0) return !isPrivateHost(host)
  return allowedOrigins.some((pattern) => matches(host, pattern))
}

// --- Bots --------------------------------------------------------------------

// Crawlers, link previewers, monitors and headless or automated browsers. Generic HTTP
// libraries (curl, python-requests…) are allowed: servers send Events through them too.
const BOT =
  /(?<!cu)bot\b|bot\/|crawl|spider|slurp|headless|phantomjs|puppeteer|playwright|selenium|webdriver|lighthouse|pagespeed|gtmetrix|pingdom|uptime|externalhit|embedly|preview|archiver|scraper/i

/** Known bots and headless browsers. A missing user agent (servers, native apps) is not a bot. */
export const isBot = (userAgent: string | undefined) => userAgent !== undefined && userAgent.trim() !== "" && BOT.test(userAgent)

// --- Events ------------------------------------------------------------------

/** Built-in events a client may send. Every other name starting with `$` is reserved. */
export const BUILT_IN_EVENTS: ReadonlySet<string> = new Set(["$pageview", "$identify"])

/**
 * Identify (persistent Tracking mode): the browser script's `identify(id)` sends this Built-in
 * event with `distinct_id` set to `id` and `$anon_distinct_id` set to the device's own Visitor ID.
 */
export const IDENTIFY = "$identify"
export const ANON_DISTINCT_ID = "$anon_distinct_id"

/**
 * Flock-defined Event properties a client may send on any Event: the URLs the browser
 * script adds, and the audience properties (which Enrichment replaces anyway). Every
 * other property name starting with `$` is reserved.
 */
export const CLIENT_FLOCK_PROPERTIES: ReadonlySet<string> = new Set(["$url", "$referrer", ...AUDIENCE_PROPERTIES])

const decodeEvent = Schema.decodeUnknownResult(IngestEvent)

const describeShapeError = (raw: unknown) => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return "An Event must be a JSON object"
  const e = raw as Record<string, unknown>
  if (typeof e.uuid !== "string" || !Schema.is(IngestEvent.fields.uuid)(e.uuid)) return "`uuid` must be a UUID"
  if (typeof e.name !== "string") return "`name` must be a string"
  if ("timestamp" in e && e.timestamp !== undefined && typeof e.timestamp !== "string") return "`timestamp` must be an ISO 8601 string"
  if ("distinct_id" in e && e.distinct_id !== undefined && typeof e.distinct_id !== "string") return "`distinct_id` must be a string"
  return "`properties` must be a JSON object"
}

/** A raw Event checked against the Ingest contract: the Event, or why it was rejected. */
export const validateEvent = (raw: unknown): Result.Result<IngestEvent, string> => {
  const decoded = decodeEvent(raw)
  if (Result.isFailure(decoded)) return Result.fail(describeShapeError(raw))
  const event = decoded.success
  const { maxEventBytes, maxNameLength, maxProperties } = IngestLimits
  const properties = Object.keys(event.properties ?? {})

  if (event.name === "") return Result.fail("`name` must not be empty")
  if (event.name.length > maxNameLength) return Result.fail(`Event names are limited to ${maxNameLength} characters`)
  if (event.name.startsWith("$") && !BUILT_IN_EVENTS.has(event.name)) {
    return Result.fail("Event names starting with $ are reserved for Built-in events")
  }
  if (properties.length > maxProperties) return Result.fail(`Events are limited to ${maxProperties} Event properties`)
  if (properties.some((name) => name.length > maxNameLength)) {
    return Result.fail(`Event property names are limited to ${maxNameLength} characters`)
  }
  if (event.name === IDENTIFY && (event.distinct_id === undefined || typeof event.properties?.[ANON_DISTINCT_ID] !== "string")) {
    return Result.fail(`${IDENTIFY} needs \`distinct_id\` and a string \`${ANON_DISTINCT_ID}\` property`)
  }
  const isClientProperty = (name: string) => CLIENT_FLOCK_PROPERTIES.has(name) || (event.name === IDENTIFY && name === ANON_DISTINCT_ID)
  if (properties.some((name) => name.startsWith("$") && !isClientProperty(name))) {
    return Result.fail("Event property names starting with $ are reserved for Flock")
  }
  if (Buffer.byteLength(JSON.stringify(raw)) > maxEventBytes) {
    return Result.fail(`Events are limited to ${maxEventBytes / 1024} KB of JSON`)
  }
  return Result.succeed(event)
}

/** The `uuid` of a raw Event as sent, for rejection reports. */
export const rawUuid = (raw: unknown) =>
  typeof raw === "object" && raw !== null && typeof (raw as { uuid?: unknown }).uuid === "string"
    ? (raw as { uuid: string }).uuid
    : ""

// --- Time ----------------------------------------------------------------------

const MAX_CLIENT_AGE = Duration.hours(24)

/** The client timestamp when it is at most 24 hours old (and not in the future), else the receive time. */
export const eventTime = (timestamp: string | undefined, receivedAt: DateTime.Utc): DateTime.Utc => {
  if (timestamp === undefined) return receivedAt
  return Option.match(DateTime.make(timestamp), {
    onNone: () => receivedAt,
    onSome: (client) => {
      const utc = DateTime.toUtc(client)
      const oldest = DateTime.subtractDuration(receivedAt, MAX_CLIENT_AGE)
      return DateTime.isLessThan(utc, oldest) || DateTime.isGreaterThan(utc, receivedAt) ? receivedAt : utc
    }
  })
}
