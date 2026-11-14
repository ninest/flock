// The Projects page's numbers: how busy each Project's `production` Environment is, without
// opening it. They ignore the date range picker and Filters.
import { Schema } from "effect"
import { EnvironmentId, ProjectId } from "./domain.ts"

/** Unique Visitors on one local day. */
export const DailyVisitors = Schema.Struct({ date: Schema.String, visitors: Schema.Number })
export type DailyVisitors = typeof DailyVisitors.Type

/** The numbers for a Project's `production` Environment. */
export const ProductionNumbers = Schema.Struct({
  environmentId: EnvironmentId,
  /** Unique Visitors with an Event in the last 30 minutes, as the live counter counts them. */
  live: Schema.Number,
  /** Unique Visitors over the last 7 local days, today included. */
  visitors: Schema.Number,
  /** Unique Visitors over the 7 local days before those. */
  previousVisitors: Schema.Number,
  /** Unique Visitors per local day over the last 7 days, oldest first, ending today. */
  series: Schema.Array(DailyVisitors)
})
export type ProductionNumbers = typeof ProductionNumbers.Type

export const ProjectNumbers = Schema.Struct({
  projectId: ProjectId,
  /** Null when the Project has no `production` Environment. */
  production: Schema.NullOr(ProductionNumbers)
})
export type ProjectNumbers = typeof ProjectNumbers.Type
