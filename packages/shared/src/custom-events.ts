// Custom event report schemas: the list, the drill-down over time, property
// breakdowns and numeric statistics. Every report takes the date range picker.
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { EnvironmentId, EnvironmentNotFound } from "./domain.ts"
import { MemberAuth } from "./members.ts"
import { ReportInterval, ReportRangeQuery } from "./reports.ts"

/** The resolved range of a report, as local dates (inclusive) in the Project's time zone. */
const ResolvedRange = {
  from: Schema.String,
  to: Schema.String,
  timeZone: Schema.String,
  interval: ReportInterval
}

/** How often a Custom event was sent and by how many unique Visitors. */
export const CustomEventNumbers = Schema.Struct({ count: Schema.Number, visitors: Schema.Number })
export type CustomEventNumbers = typeof CustomEventNumbers.Type

export const CustomEventSummary = Schema.Struct({ name: Schema.String, ...CustomEventNumbers.fields })
export type CustomEventSummary = typeof CustomEventSummary.Type

export const CustomEventList = Schema.Struct({
  ...ResolvedRange,
  /** Every Custom event name sent in the range, most sent first. Built-in events are left out. */
  events: Schema.Array(CustomEventSummary)
})
export type CustomEventList = typeof CustomEventList.Type

/** The JSON types an Event property was sent with. */
export const PropertyType = Schema.Literals(["string", "number", "boolean"])
export type PropertyType = typeof PropertyType.Type

export const CustomEventProperty = Schema.Struct({
  key: Schema.String,
  /** Detected from stored values, sorted. A key sent with mixed types lists each. */
  types: Schema.Array(PropertyType)
})
export type CustomEventProperty = typeof CustomEventProperty.Type

export const CustomEventDetail = Schema.Struct({
  ...ResolvedRange,
  name: Schema.String,
  totals: CustomEventNumbers,
  /** Every bucket in the range, including empty ones. */
  series: Schema.Array(Schema.Struct({ bucket: Schema.String, ...CustomEventNumbers.fields })),
  /** The Event properties sent with this Custom event in the range, by key. */
  properties: Schema.Array(CustomEventProperty)
})
export type CustomEventDetail = typeof CustomEventDetail.Type

/** One value of an Event property (`null`: Events without it) and how many Events had it. */
export const CustomEventBreakdownRow = Schema.Struct({ value: Schema.NullOr(Schema.String), count: Schema.Number })

export const CustomEventBreakdown = Schema.Struct({
  ...ResolvedRange,
  /** Most frequent first, `null` last. Booleans read `true` and `false`. */
  rows: Schema.Array(CustomEventBreakdownRow)
})
export type CustomEventBreakdown = typeof CustomEventBreakdown.Type

/** Statistics over the numeric values of one Event property. Null when there are none. */
export const NumericStats = Schema.Struct({
  /** How many Events had a numeric value. */
  count: Schema.Number,
  average: Schema.NullOr(Schema.Number),
  sum: Schema.NullOr(Schema.Number),
  min: Schema.NullOr(Schema.Number),
  max: Schema.NullOr(Schema.Number),
  median: Schema.NullOr(Schema.Number)
})
export type NumericStats = typeof NumericStats.Type

export const CustomEventStats = Schema.Struct({
  ...ResolvedRange,
  totals: NumericStats,
  series: Schema.Array(Schema.Struct({ bucket: Schema.String, ...NumericStats.fields }))
})
export type CustomEventStats = typeof CustomEventStats.Type

const params = { environmentId: EnvironmentId }
// Extra fields leave the range check (which reads only period, from and to) valid.
const withRange = <F extends Schema.Struct.Fields>(fields: F) =>
  ReportRangeQuery.mapFields((range) => ({ ...range, ...fields }), { unsafePreserveChecks: true })
/** `name`: the Custom event. */
const eventQuery = withRange({ name: Schema.String })
/** `eventProperty`: the Event property key. */
const eventPropertyQuery = withRange({ name: Schema.String, eventProperty: Schema.String })

export class CustomEventsGroup extends HttpApiGroup.make("customEvents")
  .add(
    HttpApiEndpoint.get("list", "/:environmentId/custom-events", {
      params,
      query: ReportRangeQuery,
      success: CustomEventList,
      error: EnvironmentNotFound
    }),
    /** One Custom event: count and unique Visitors over time, and its Event properties. */
    HttpApiEndpoint.get("detail", "/:environmentId/custom-event", {
      params,
      query: eventQuery,
      success: CustomEventDetail,
      error: EnvironmentNotFound
    }),
    /** Counts the Custom event by the value of one string or boolean Event property. */
    HttpApiEndpoint.get("breakdown", "/:environmentId/custom-event/breakdown", {
      params,
      query: eventPropertyQuery,
      success: CustomEventBreakdown,
      error: EnvironmentNotFound
    }),
    /**
     * Average, sum, min, max and median of one Event property, in total and over time.
     * Only numeric values count: strings, booleans and missing values are skipped.
     */
    HttpApiEndpoint.get("stats", "/:environmentId/custom-event/stats", {
      params,
      query: eventPropertyQuery,
      success: CustomEventStats,
      error: EnvironmentNotFound
    })
  )
  .middleware(MemberAuth)
  .prefix("/api/environments")
  .annotateMerge(OpenApi.annotations({ title: "Custom events" })) {}
