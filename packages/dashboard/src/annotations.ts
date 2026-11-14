// Where Annotations go on the overview chart, and the small conversions their form and details
// need: local wall-clock times in the Project's time zone, and links in a plain-text description.
import type { ReportInterval } from "@flock/shared"

const formatters = new Map<string, Intl.DateTimeFormat>()

/** The wall-clock fields of an instant in a time zone. */
const localParts = (ms: number, timeZone: string) => {
  let format = formatters.get(timeZone)
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    })
    formatters.set(timeZone, format)
  }
  const parts = Object.fromEntries(format.formatToParts(new Date(ms)).map((p) => [p.type, p.value]))
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: parts.hour!,
    minute: parts.minute!,
    second: Number(parts.second)
  }
}

/** The chart bucket an instant falls in: `2026-03-10` on daily charts, `2026-03-10T14:00` on hourly ones. */
export const localBucket = (ms: number, timeZone: string, interval: ReportInterval) => {
  const local = localParts(ms, timeZone)
  return interval === "hour" ? `${local.date}T${local.hour}:00` : local.date
}

/**
 * Each bucket that has Annotations, in bucket order, with its Annotations in the order given.
 * Annotations outside the buckets are left out.
 */
export const placeAnnotations = <A extends { readonly at: number }>(
  annotations: ReadonlyArray<A>,
  buckets: ReadonlyArray<string>,
  interval: ReportInterval,
  timeZone: string
): Array<{ index: number; annotations: Array<A> }> => {
  const indexOf = new Map(buckets.map((bucket, i) => [bucket, i]))
  const placed = new Map<number, Array<A>>()
  for (const annotation of annotations) {
    const index = indexOf.get(localBucket(annotation.at, timeZone, interval))
    if (index === undefined) continue
    placed.set(index, [...(placed.get(index) ?? []), annotation])
  }
  return [...placed].sort(([a], [b]) => a - b).map(([index, annotations]) => ({ index, annotations }))
}

/** An instant as a `datetime-local` value in the time zone: `2026-03-10T10:37`. */
export const toLocalInput = (ms: number, timeZone: string) => {
  const local = localParts(ms, timeZone)
  return `${local.date}T${local.hour}:${local.minute}`
}

/** Milliseconds a time zone is ahead of UTC at an instant. */
const offsetAt = (ms: number, timeZone: string) => {
  const local = localParts(ms, timeZone)
  const asUtc = Date.parse(`${local.date}T${local.hour}:${local.minute}:00Z`) + local.second * 1000
  return asUtc - Math.floor(ms / 1000) * 1000
}

/** A `datetime-local` value read as wall-clock time in the time zone; undefined when empty or invalid. */
export const fromLocalInput = (value: string, timeZone: string) => {
  const wall = Date.parse(`${value}:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || Number.isNaN(wall)) return undefined
  // Guess with the offset at the wall time read as UTC, then correct once for a DST change between.
  const guess = wall - offsetAt(wall, timeZone)
  return wall - offsetAt(guess, timeZone)
}

const URL_PATTERN = /https?:\/\/[^\s<>"]+/g
const TRAILING = /[.,;:!?)\]}'"]+$/

/** Plain text split into text and http(s) links, so a description's URLs can be clickable. */
export const linkParts = (text: string): Array<{ text: string; href?: string }> => {
  const parts: Array<{ text: string; href?: string }> = []
  let last = 0
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = match[0].replace(TRAILING, "")
    if (match.index > last) parts.push({ text: text.slice(last, match.index) })
    parts.push({ text: url, href: url })
    last = match.index + url.length
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  return parts
}
