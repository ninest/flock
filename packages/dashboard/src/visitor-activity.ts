// The Visitor profile's activity grid: Events per local day, one column per week.

export interface ActivityDay {
  readonly date: string
  readonly events: number
  /** 0 for no Events, else 1–4 by the share of the busiest day. */
  readonly level: number
}

/** Monday 0 … Sunday 6 of a `2026-03-04` date. */
const weekday = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7

/** The days (oldest first, consecutive) as Monday-first weeks; `null` pads the first and last week. */
export const activityWeeks = (days: ReadonlyArray<{ readonly date: string; readonly events: number }>): Array<Array<ActivityDay | null>> => {
  if (days.length === 0) return []
  const max = Math.max(...days.map((d) => d.events))
  const cells: Array<ActivityDay | null> = [
    ...Array<null>(weekday(days[0]!.date)).fill(null),
    ...days.map((d) => ({ ...d, level: d.events === 0 ? 0 : Math.max(1, Math.round((d.events / max) * 4)) }))
  ]
  while (cells.length % 7 !== 0) cells.push(null)
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7))
}
