import { Schema } from "effect"

export const ProjectId = Schema.String.pipe(Schema.brand("ProjectId"))
export type ProjectId = typeof ProjectId.Type

export const EnvironmentId = Schema.String.pipe(Schema.brand("EnvironmentId"))
export type EnvironmentId = typeof EnvironmentId.Type

/** A separate data stream inside a Project, written to with its public key. */
export class Environment extends Schema.Class<Environment>("Environment")({
  id: EnvironmentId,
  name: Schema.String,
  /** Public, write-only ingest key: `pk_<environment name>_<random>`. */
  key: Schema.String
}) {}

export class Project extends Schema.Class<Project>("Project")({
  id: ProjectId,
  name: Schema.String,
  timeZone: Schema.String,
  environments: Schema.Array(Environment)
}) {}

export class EnvironmentNotFound extends Schema.TaggedError<EnvironmentNotFound>()(
  "EnvironmentNotFound",
  { id: EnvironmentId },
  { httpApiStatus: 404 }
) {}
