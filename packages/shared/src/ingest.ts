import { Schema } from "effect"

/** One Event as sent by the browser script or any HTTP client. */
export const IngestEvent = Schema.Struct({
  uuid: Schema.String.check(Schema.isUUID()),
  name: Schema.String,
  timestamp: Schema.optional(Schema.String),
  distinct_id: Schema.optional(Schema.String),
  properties: Schema.optional(Schema.Record(Schema.String, Schema.Unknown))
})
export type IngestEvent = typeof IngestEvent.Type

/** A batch of Events for one Environment, identified by its public key. */
export const IngestBatch = Schema.Struct({
  key: Schema.String,
  events: Schema.Array(IngestEvent)
})
export type IngestBatch = typeof IngestBatch.Type

export const IngestRejection = Schema.Struct({ uuid: Schema.String, reason: Schema.String })

export const IngestResult = Schema.Struct({
  accepted: Schema.Number,
  rejected: Schema.Array(IngestRejection)
})
export type IngestResult = typeof IngestResult.Type

export class UnknownKey extends Schema.TaggedError<UnknownKey>()(
  "UnknownKey",
  { message: Schema.String },
  { httpApiStatus: 403 }
) {}
