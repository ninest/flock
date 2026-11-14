// What a Custom event's charts draw: its Event count or unique Visitors over time, and one numeric
// Event property's chosen statistic over time. The choices live in the URL (see project-search.ts).
import type { CustomEventDetail, CustomEventStats } from "@flock/shared"

/** What the event's own chart counts; Events when absent. */
export const EVENT_MEASURES = [{ key: "events", label: "Events" }, { key: "visitors", label: "Unique Visitors" }] as const
export type EventMeasure = (typeof EVENT_MEASURES)[number]["key"]

/** The statistic a numeric Event property's chart draws; average when absent. */
export const STATISTICS = [
  { key: "average", label: "Average" },
  { key: "median", label: "Median" },
  { key: "sum", label: "Sum" },
  { key: "min", label: "Min" },
  { key: "max", label: "Max" }
] as const
export type Statistic = (typeof STATISTICS)[number]["key"]

/** One line for the TrendChart: what it is and its value in each bucket (null leaves a gap). */
export interface ChartSeries {
  readonly name: string
  readonly values: ReadonlyArray<number | null>
}

export const eventSeries = (series: CustomEventDetail["series"], measure: EventMeasure | undefined): ChartSeries =>
  measure === "visitors"
    ? { name: "Unique Visitors", values: series.map((b) => b.visitors) }
    : { name: "Events", values: series.map((b) => b.count) }

export const statisticSeries = (series: CustomEventStats["series"], eventProperty: string, statistic: Statistic | undefined): ChartSeries => {
  const { key, label } = STATISTICS.find((s) => s.key === statistic) ?? STATISTICS[0]
  return { name: `${label} ${eventProperty}`, values: series.map((b) => b[key]) }
}

/** The numeric Event property to chart: the requested one if the event has it, else its first; none without any. */
export const chartedProperty = (numeric: ReadonlyArray<string>, requested: string | undefined) =>
  requested !== undefined && numeric.includes(requested) ? requested : numeric[0]
