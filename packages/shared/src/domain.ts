import { Schema } from "effect"
import { MemberId } from "./members.ts"

export const ProjectId = Schema.String.pipe(Schema.brand("ProjectId"))
export type ProjectId = typeof ProjectId.Type

export const EnvironmentId = Schema.String.pipe(Schema.brand("EnvironmentId"))
export type EnvironmentId = typeof EnvironmentId.Type

/** The Environment every Project starts with. It can't be deleted or emptied. */
export const PRODUCTION = "production"

/**
 * An Environment name: lowercase letters, digits and dashes, starting with a letter.
 * It appears in the Environment's key (`pk_<name>_…`), so it has no underscores.
 */
export const EnvironmentName = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9-]{0,31}$/, {
    expected: "an Environment name: up to 32 lowercase letters, digits or dashes, starting with a letter"
  })
)

const isTimeZone = (value: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value })
    return true
  } catch {
    return false
  }
}

/** An IANA time zone, such as `Europe/Berlin` or `UTC`. */
export const TimeZone = Schema.String.check(
  Schema.makeFilter((value: string) => isTimeZone(value), { expected: "an IANA time zone, such as Europe/Berlin" })
)

export const ProjectName = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isNonEmpty(),
  Schema.isMaxLength(100)
)

/** A Member's role in a Project: owners manage it, viewers only read its reports. */
export const ProjectRole = Schema.Literals(["owner", "viewer"])
export type ProjectRole = typeof ProjectRole.Type

/**
 * How a Project recognises Visitors (ADR 0002). `cookieless` (the default) hashes the IP and
 * user agent with a daily salt and stores nothing on the device; `persistent` uses an ID the
 * browser script stores on the device, which Identify can link to the tracked app's own ID.
 */
export const TrackingMode = Schema.Literals(["cookieless", "persistent"])
export type TrackingMode = typeof TrackingMode.Type

/**
 * One allowed origin of an Environment, matched against a browser request's host
 * (any scheme and port): `blog.example.com`, `*.example.com` (subdomains only),
 * `localhost`, or `*` for any origin.
 */
export const AllowedOrigin = Schema.String.check(
  Schema.isPattern(/^(\*|(\*\.)?[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*)$/, {
    expected: "a host such as blog.example.com, *.example.com (subdomains), localhost, or * (any origin)"
  }),
  Schema.isMaxLength(253)
)

/**
 * An Environment's allowed origins. Empty means any public origin: localhost and
 * private-network origins are rejected. Otherwise only matching origins are accepted.
 */
export const AllowedOrigins = Schema.Array(AllowedOrigin).check(Schema.isMaxLength(100))

/** `production` accepts any public origin; other Environments start with localhost and `*.ts.net`. */
export const defaultAllowedOrigins = (environmentName: string): ReadonlyArray<string> =>
  environmentName === PRODUCTION ? [] : ["localhost", "*.ts.net"]

/** A separate data stream inside a Project, written to with its public key. */
export class Environment extends Schema.Class<Environment>("Environment")({
  id: EnvironmentId,
  name: Schema.String,
  /** Public, write-only ingest key: `pk_<environment name>_<random>`. */
  key: Schema.String,
  /** Browser origins allowed to send Events with this key; see AllowedOrigins. */
  allowedOrigins: Schema.Array(Schema.String)
}) {}

export class Project extends Schema.Class<Project>("Project")({
  id: ProjectId,
  name: Schema.String,
  timeZone: Schema.String,
  trackingMode: TrackingMode,
  /** The signed-in Member's role in this Project. */
  role: ProjectRole,
  /** `production` first, then the others by name. */
  environments: Schema.Array(Environment)
}) {}

export class ProjectNotFound extends Schema.TaggedError<ProjectNotFound>()(
  "ProjectNotFound",
  { id: ProjectId },
  { httpApiStatus: 404 }
) {}

export class EnvironmentNotFound extends Schema.TaggedError<EnvironmentNotFound>()(
  "EnvironmentNotFound",
  { id: EnvironmentId },
  { httpApiStatus: 404 }
) {}

/** Another Environment in the Project already has this name. */
export class EnvironmentNameTaken extends Schema.TaggedError<EnvironmentNameTaken>()(
  "EnvironmentNameTaken",
  { name: Schema.String },
  { httpApiStatus: 409 }
) {}

/** Refused for `production`: it can't be deleted or emptied. */
export class ProductionProtected extends Schema.TaggedError<ProductionProtected>()(
  "ProductionProtected",
  { message: Schema.String },
  { httpApiStatus: 409 }
) {}

/** The action needs the Project owner role. */
export class ProjectOwnerRequired extends Schema.TaggedError<ProjectOwnerRequired>()(
  "ProjectOwnerRequired",
  { message: Schema.String },
  { httpApiStatus: 403 }
) {}

/** A Member who belongs to a Project, with their role in it. */
export class ProjectMember extends Schema.Class<ProjectMember>("ProjectMember")({
  id: MemberId,
  email: Schema.String,
  name: Schema.String,
  role: ProjectRole
}) {}

/** No Member of this Instance signs in with that email. */
export class NoMemberWithEmail extends Schema.TaggedError<NoMemberWithEmail>()(
  "NoMemberWithEmail",
  { email: Schema.String },
  { httpApiStatus: 404 }
) {}

/** The Member already belongs to the Project; change their role instead. */
export class AlreadyProjectMember extends Schema.TaggedError<AlreadyProjectMember>()(
  "AlreadyProjectMember",
  { id: MemberId },
  { httpApiStatus: 409 }
) {}

/** The Member doesn't belong to the Project. */
export class ProjectMemberNotFound extends Schema.TaggedError<ProjectMemberNotFound>()(
  "ProjectMemberNotFound",
  { id: MemberId },
  { httpApiStatus: 404 }
) {}

/** Refused: a Project always keeps at least one owner. */
export class LastProjectOwner extends Schema.TaggedError<LastProjectOwner>()(
  "LastProjectOwner",
  { message: Schema.String },
  { httpApiStatus: 409 }
) {}

/**
 * Refused: removing this Member from the Instance would leave Projects they solely own without an owner.
 * Make another Member an owner of `projects` first.
 */
export class SoleProjectOwner extends Schema.TaggedError<SoleProjectOwner>()(
  "SoleProjectOwner",
  { message: Schema.String, projects: Schema.Array(ProjectId) },
  { httpApiStatus: 409 }
) {}
