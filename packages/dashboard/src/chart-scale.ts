// The arithmetic behind the time series chart: a round top for the axis, how many x labels fit,
// and what a bucket is called.
import type { ReportInterval } from "@flock/shared"

const STEPS = [1, 1.5, 2, 3, 4, 5, 6, 8, 10]

/** The axis top: the smallest round number at or above `value`. Shares (at most 1) top out at 50% or 100%. */
export const niceMax = (value: number) => {
  if (value <= 0) return 1
  if (value <= 1) return value <= 0.5 ? 0.5 : 1
  const power = 10 ** Math.floor(Math.log10(value))
  return STEPS.map((m) => m * power).find((m) => m >= value)!
}

/** Labels need about this many pixels each. */
const LABEL_WIDTH = 64

/** Label every nth bucket so `count` labels fit in `width` pixels. */
export const labelStep = (count: number, width: number) => Math.max(1, Math.ceil(count / Math.max(1, Math.floor(width / LABEL_WIDTH))))

/** A bucket's label: `13:00` for an hour, `Mar 1` for a day. */
export const bucketLabel = (interval: ReportInterval, bucket: string) =>
  interval === "hour"
    ? bucket.slice(11, 16)
    : new Date(`${bucket}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })
