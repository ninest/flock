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

/** Ingest limits per Event. */
export const IngestLimits = {
  /** Event properties per Event. */
  maxProperties: 50,
  /** Bytes of the Event's JSON. */
  maxEventBytes: 8 * 1024,
  /** Characters in an Event name or Event property name. */
  maxNameLength: 200
} as const

/**
 * A batch of Events for one Environment, identified by its public key. Each Event
 * is checked on its own (see IngestEvent and IngestLimits), so one bad Event is
 * rejected without failing the rest of the batch.
 */
export const IngestBatch = Schema.Struct({
  key: Schema.String,
  events: Schema.Array(Schema.Unknown.annotate({ description: "An IngestEvent" }))
})
export type IngestBatch = typeof IngestBatch.Type

/** A rejected Event: its position in the batch, its `uuid` as sent (if any), and why. */
export const IngestRejection = Schema.Struct({ index: Schema.Number, uuid: Schema.String, reason: Schema.String })
export type IngestRejection = typeof IngestRejection.Type

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

/** A browser request from an origin the Environment doesn't allow. */
export class OriginNotAllowed extends Schema.TaggedError<OriginNotAllowed>()(
  "OriginNotAllowed",
  { message: Schema.String },
  { httpApiStatus: 403 }
) {}
