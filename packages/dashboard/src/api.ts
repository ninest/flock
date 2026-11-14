// Typed client derived from the shared FlockApi (same origin; Vite proxies /api in dev).
import { FlockApi } from "@flock/shared"
import { Cause, Effect, Exit } from "effect"
import { FetchHttpClient } from "effect/http"
import { HttpApiClient } from "effect/http-api"

export type Client = HttpApiClient.ForApi<typeof FlockApi>

const client = HttpApiClient.make(FlockApi, { baseUrl: window.location.origin }).pipe(
  Effect.provide(FetchHttpClient.layer)
)

/** Thrown by `request` for a failed request; `message` is meant for the Member. */
export class RequestError extends Error {}

const describe = (error: unknown): string => {
  if (typeof error === "object" && error !== null) {
    const e = error as { _tag?: string; message?: unknown; name?: unknown }
    if (typeof e.message === "string" && e.message !== "") return e.message
    if (e._tag === "EnvironmentNameTaken") return `An Environment named "${String(e.name)}" already exists.`
    if (e._tag === "ProjectNotFound" || e._tag === "EnvironmentNotFound") return "Not found. It may have been deleted."
    if (e._tag === "NoMemberWithEmail") return `No Member of this Instance signs in with ${String((e as { email?: unknown }).email)}.`
    if (e._tag === "AlreadyProjectMember") return "That Member already has access. Change their role instead."
    if (e._tag === "AnnotationNotFound") return "That Annotation was already deleted."
    if (e._tag === "ProjectMemberNotFound") return "That Member no longer has access to this Project."
    if (e._tag) return e._tag
  }
  return "Something went wrong."
}

/** Runs a request against the API, e.g. `request((api) => api.projects.list())`. */
export const request = async <A, E>(f: (api: Client) => Effect.Effect<A, E>): Promise<A> => {
  const exit = await Effect.runPromiseExit(Effect.flatMap(client, f))
  if (Exit.isSuccess(exit)) return exit.value
  const failure = Cause.findErrorOption(exit.cause)
  throw Object.assign(new RequestError(describe(failure._tag === "Some" ? failure.value : Cause.squash(exit.cause))), {
    cause: exit.cause
  })
}
