// Member sign-in with Better Auth, mounted at /api/auth/* inside the Effect router.
// Better Auth keeps its own pg pool (@effect/sql-pg has its own driver) and calls
// back into Access through a promise bridge for sign-up gating and the admin bootstrap.
import { CurrentMember, Member, MemberAuth, MemberId, Unauthorized } from "@flock/shared"
import { betterAuth } from "better-auth"
import { APIError } from "better-auth/api"
import { Context, Effect, Layer, Option, Redacted } from "effect"
import { HttpEffect, HttpRouter, HttpServerRequest } from "effect/http"
import pg from "pg"
import { Access, AuthConfig } from "./access.ts"

/**
 * Origins allowed to call the auth API. Without FLOCK_PUBLIC_URL, a request's own
 * origin (from its Host header) is trusted: a cross-site request can't forge an
 * Origin that matches our Host, so the CSRF check still holds.
 */
const trustedOrigins = (settings: AuthConfig["Service"]) => (request?: Request) => {
  const configured = [...Option.toArray(settings.publicUrl), ...settings.trustedOrigins]
  const host = request?.headers.get("host")
  if (Option.isSome(settings.publicUrl) || !host) return configured
  return [...configured, `http://${host}`, `https://${host}`]
}

const makeAuth = (options: {
  readonly settings: AuthConfig["Service"]
  readonly secret: string
  readonly pool: pg.Pool
  readonly run: <A>(effect: Effect.Effect<A, unknown>) => Promise<A>
  readonly access: Access["Service"]
}) => {
  const { access, run, settings } = options
  return betterAuth({
    // Unset: Better Auth derives it from each request. (A dynamic `allowedHosts: ["*"]`
    // would also trust every origin.)
    baseURL: Option.getOrUndefined(settings.publicUrl),
    basePath: "/api/auth",
    secret: options.secret,
    database: options.pool,
    trustedOrigins: trustedOrigins(settings),
    telemetry: { enabled: false },
    // Better Auth turns the origin (CSRF) check off when NODE_ENV=test; keep it on so
    // Seam 1 tests see production behavior.
    advanced: { disableOriginCheck: false },
    // Our names, so "user" and "session" stay free for Visitors and Sessions (GLOSSARY.md).
    user: { modelName: "member" },
    session: { modelName: "member_session" },
    account: { modelName: "member_account" },
    verification: { modelName: "auth_verification" },
    emailAndPassword: { enabled: true, autoSignIn: true },
    databaseHooks: {
      user: {
        create: {
          before: async (member, context) => {
            // No endpoint context: a trusted server-side call (the admin CLI, seeding).
            if (!context) return
            const verdict = await run(access.canSignUp(member.email))
            if (!verdict.ok) throw new APIError("FORBIDDEN", { code: verdict.code, message: verdict.message })
          }
        }
      },
      session: {
        create: {
          after: async (session) => {
            await run(access.signedIn(MemberId.make(session.userId)))
          }
        }
      }
    }
  })
}

export class BetterAuth extends Context.Service<BetterAuth, {
  readonly handler: (request: Request) => Promise<Response>
  readonly getSession: (headers: Headers) => Promise<{ readonly user: { readonly id: string; readonly email: string } } | null>
  /** Creates a Member with an email + password, bypassing sign-up rules (trusted callers only). */
  readonly createMember: (input: {
    readonly email: string
    readonly password: string
    readonly name: string
  }) => Effect.Effect<MemberId>
}>()("flock/BetterAuth") {
  static readonly layer = (databaseUrl: Redacted.Redacted<string>) =>
    Layer.effect(
      BetterAuth,
      Effect.gen(function*() {
        const settings = yield* AuthConfig
        const access = yield* Access
        const context = yield* Effect.context<never>()
        const pool = yield* Effect.acquireRelease(
          Effect.sync(() => new pg.Pool({ connectionString: Redacted.value(databaseUrl), max: 5 })),
          (pool) => Effect.promise(() => pool.end())
        )
        const secret = yield* Option.match(settings.secret, {
          onSome: (secret) => Effect.succeed(Redacted.value(secret)),
          onNone: () => access.generatedSecret.pipe(Effect.orDie)
        })
        const auth = makeAuth({ settings, secret, pool, access, run: (effect) => Effect.runPromiseWith(context)(effect) })

        return BetterAuth.of({
          handler: (request) => auth.handler(request),
          getSession: (headers) => auth.api.getSession({ headers }),
          createMember: ({ email, name, password }) =>
            Effect.promise(async () => {
              const ctx = await auth.$context
              const hash = await ctx.password.hash(password)
              const member = await ctx.internalAdapter.createUser({ email: email.toLowerCase(), name, emailVerified: false }, { method: "email-password" })
              await ctx.internalAdapter.linkAccount({ userId: member.id, providerId: "credential", accountId: member.id, password: hash })
              return MemberId.make(member.id)
            })
        })
      })
    )
}

/** Reads the session cookie and provides the signed-in Member, or fails with 401. */
export const MemberAuthLive = Layer.effect(
  MemberAuth,
  Effect.gen(function*() {
    const auth = yield* BetterAuth
    return MemberAuth.of((httpEffect) =>
      Effect.gen(function*() {
        const request = yield* HttpServerRequest.HttpServerRequest
        const session = yield* Effect.tryPromise(() => auth.getSession(new Headers(request.headers as Record<string, string>))).pipe(
          Effect.orElseSucceed(() => null)
        )
        if (!session) return yield* new Unauthorized({ message: "Sign in required" })
        return yield* Effect.provideService(httpEffect, CurrentMember, {
          id: MemberId.make(session.user.id),
          email: session.user.email
        })
      })
    )
  })
)

/** The signed-in Member, as the dashboard sees it. */
export const currentMember = Effect.gen(function*() {
  const access = yield* Access
  const { id } = yield* CurrentMember
  const member = yield* access.member(id).pipe(Effect.orDie)
  return yield* Option.match(member, {
    onNone: () => Effect.fail(new Unauthorized({ message: "Sign in required" })),
    onSome: (member: Member) => Effect.succeed(member)
  })
})

/** Better Auth's endpoints (sign-up, sign-in, sign-out, get-session). */
export const AuthRoutes = Layer.unwrap(Effect.gen(function*() {
  const auth = yield* BetterAuth
  return HttpRouter.add("*", "/api/auth/*", HttpEffect.fromWebHandler((request) => auth.handler(request)))
}))
