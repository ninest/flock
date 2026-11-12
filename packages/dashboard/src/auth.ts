// Member sign-in against Better Auth's endpoints (same origin; Vite proxies /api in dev).
import type { Member } from "@flock/shared"
import { Effect } from "effect"
import { request } from "./api.ts"

const post = async (path: string, body: object) => {
  const response = await fetch(`/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  })
  if (response.ok) return
  const error = (await response.json().catch(() => ({}))) as { message?: string }
  throw new Error(error.message ?? `Request failed (${response.status})`)
}

export const signIn = (input: { email: string; password: string }) => post("/sign-in/email", input)
/** `invite` is the token from an Invite link; without one, sign-up needs Open sign-up or FLOCK_ADMIN_EMAIL. */
export const signUp = (input: { email: string; password: string; name: string; invite?: string | undefined }) => post("/sign-up/email", input)
export const signOut = () => post("/sign-out", {})

/** The signed-in Member, or null when nobody is signed in. */
export const currentMember = (): Promise<Member | null> =>
  request((api) => api.members.me().pipe(Effect.catchTag("Unauthorized", () => Effect.succeed(null))))
