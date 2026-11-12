// Member sign-in against Better Auth's endpoints (same origin; Vite proxies /api in dev).
import type { Member, SignInOptions } from "@flock/shared"
import { Effect } from "effect"
import { request } from "./api.ts"

const post = async (path: string, body: object): Promise<unknown> => {
  const response = await fetch(`/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  })
  if (response.ok) return response.json().catch(() => null)
  const error = (await response.json().catch(() => ({}))) as { message?: string }
  throw new Error(error.message ?? `Request failed (${response.status})`)
}

export const signIn = (input: { email: string; password: string }) => post("/sign-in/email", input)
/** `invite` is the token from an Invite link; without one, sign-up needs Open sign-up or FLOCK_ADMIN_EMAIL. */
export const signUp = (input: { email: string; password: string; name: string; invite?: string | undefined }) => post("/sign-up/email", input)
export const signOut = () => post("/sign-out", {})

/** What the sign-in page offers: the password form and/or the OIDC issuer. */
export const signInOptions = (): Promise<SignInOptions> => request((api) => api.signIn.options())

/**
 * Starts the OIDC code flow: the browser leaves for the issuer and comes back signed in
 * at `/`, or at `/sign-in?error=…&error_description=…` when sign-in was refused.
 * `invite` (from an Invite link) travels through the flow in Better Auth's OAuth state.
 */
export const oidcSignIn = async (invite: string | undefined) => {
  const result = (await post("/sign-in/social", {
    provider: "misc",
    callbackURL: "/",
    errorCallbackURL: invite ? `/sign-in?invite=${encodeURIComponent(invite)}` : "/sign-in",
    ...(invite ? { additionalData: { invite } } : {})
  })) as { url: string }
  window.location.assign(result.url)
}

/** The signed-in Member, or null when nobody is signed in. */
export const currentMember = (): Promise<Member | null> =>
  request((api) => api.members.me().pipe(Effect.catchTag("Unauthorized", () => Effect.succeed(null))))
