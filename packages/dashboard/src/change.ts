// The change of a number against the previous period: a percentage for counts and durations,
// percentage points for shares such as bounce rate, and "–" when there is nothing to compare against.

/** `percent` for counts and durations; `points` for shares from 0 to 1, such as bounce rate. */
export type ChangeUnit = "percent" | "points"

export interface Change {
  /** `+20%`, `−5 pts`, `0%`, or `–` with nothing to compare against. */
  readonly label: string
  /** Null with nothing to compare against. */
  readonly direction: "up" | "down" | "flat" | null
  /** Whether the move is good news, so it can be coloured. */
  readonly tone: "good" | "bad" | "neutral"
}

const NONE: Change = { label: "–", direction: null, tone: "neutral" }

/**
 * The change from `previous` to `current`. A zero or missing previous value (or a missing current
 * one) has no change, so it reads `–` rather than `+∞%`.
 */
export const formatChange = (
  current: number | null | undefined,
  previous: number | null | undefined,
  unit: ChangeUnit,
  options: { readonly lowerIsBetter?: boolean } = {}
): Change => {
  if (current === null || current === undefined || previous === null || previous === undefined || previous === 0) return NONE
  const delta = unit === "percent" ? ((current - previous) / previous) * 100 : (current - previous) * 100
  const rounded = Math.round(Math.abs(delta))
  if (delta === 0) return { label: unit === "percent" ? "0%" : "0 pts", direction: "flat", tone: "neutral" }
  const direction = delta > 0 ? "up" : "down"
  const sign = delta > 0 ? "+" : "−"
  const size = rounded === 0 ? "<1" : String(rounded)
  const label = unit === "percent" ? `${sign}${size}%` : `${sign}${size} ${rounded === 1 ? "pt" : "pts"}`
  const better = options.lowerIsBetter ? direction === "down" : direction === "up"
  return { label, direction, tone: better ? "good" : "bad" }
}
