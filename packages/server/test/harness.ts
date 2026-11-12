// Seam 1 harness: the whole server (HTTP API + static files) running in-process
// against a throwaway real Postgres database, with the Effect test layers for
// the clock (TestClock, from @effect/vitest) and the GeoIP lookup (a fixed table).
//
// Usage:
//   layer(Harness.layer())("Suite", (it) => {
//     it.effect("does a thing", () => Effect.gen(function*() {
//       const h = yield* Harness
//       const project = yield* h.createProject({ environments: ["production", "dev"] })
//       yield* TestClock.setTime(Date.parse("2026-03-01T10:00:00Z"))
//       yield* h.sdk.ingest.send({ payload: { key: project.environments[0]!.key, events: [pageview()] } })
//     }))
//   })
//
// `h.client` is signed in as an Instance admin; `h.fetch` and `h.sdk` send no cookies (and no Origin). `h.browser()`
// gives a fresh cookie jar for sign-up/sign-in flows. FLOCK_ADMIN_EMAIL is `options.adminEmail`.
//
// One database per `layer(...)` block (usually one per test file), dropped when
// the block finishes. Tests observe behavior only through HTTP: never query tables.
import { NodeHttpServer } from "@effect/platform-node"
import { type EnvironmentId, FlockApi, type IngestEvent, type MemberId, type Project } from "@flock/shared"
import { Context, DateTime, Effect, Layer, Option, Redacted, type Scope } from "effect"
import { FetchHttpClient, HttpEffect, HttpRouter } from "effect/http"
import type { HttpServerRequest } from "effect/http/HttpServerRequest"
import { HttpApiClient } from "effect/http-api"
import { TestClock } from "effect/testing"
import { fileURLToPath } from "node:url"
import { Access, AuthConfig } from "../src/access.ts"
import { type AdminCommandError, adminCommand } from "../src/admin-command.ts"
import { AppLive } from "../src/app.ts"
import { PgLive } from "../src/db.ts"
import { GeoIp } from "../src/geoip.ts"
import { AppRoutes } from "../src/http.ts"
import { MigratorLive } from "../src/migrations/index.ts"
import { Seed } from "../src/seed.ts"
import { TestDatabase } from "./test-database.ts"

export const BASE_URL = "http://flock.test"
const publicDir = fileURLToPath(new URL("./fixtures/public", import.meta.url))
/** Stands in for the built browser script. */
export const scriptFile = fileURLToPath(new URL("./fixtures/flock.js", import.meta.url))

export interface HarnessOptions {
  /** IP address -> ISO country code, served by the GeoIP test layer. */
  readonly geoIp?: Record<string, string>
  /** FLOCK_ADMIN_EMAIL (default `owner@flock.test`). */
  readonly adminEmail?: string
  /** Leave FLOCK_PUBLIC_URL and BETTER_AUTH_SECRET unset, like a fresh self-hosted Instance. */
  readonly zeroConfig?: boolean
}

/** A browser with its own cookie jar, talking to the server. */
export interface Browser {
  /** `fetch` that sends and stores cookies, with an `Origin` header like a browser. */
  readonly fetch: typeof globalThis.fetch
  /** Typed client sending this browser's cookies. */
  readonly client: HttpApiClient.ForApi<typeof FlockApi>
  /** POSTs JSON to a Better Auth endpoint, e.g. `auth("/sign-up/email", {...})`. */
  readonly auth: (path: string, body?: object) => Effect.Effect<Response>
  readonly signUp: (input: { readonly email: string; readonly password: string; readonly name?: string }) => Effect.Effect<Response>
  readonly signIn: (input: { readonly email: string; readonly password: string }) => Effect.Effect<Response>
}

const makeBrowser = (handler: (request: Request) => Promise<Response>) =>
  Effect.gen(function*() {
    const jar = new Map<string, string>()
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(new URL(input.toString(), BASE_URL), init)
      const headers = new Headers(request.headers)
      if (jar.size > 0) headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "))
      if (!headers.has("origin")) headers.set("origin", BASE_URL)
      const response = await handler(new Request(request, { headers }))
      for (const cookie of response.headers.getSetCookie()) {
        const [pair = ""] = cookie.split(";")
        const i = pair.indexOf("=")
        const name = pair.slice(0, i)
        const value = pair.slice(i + 1)
        if (value === "" || /max-age=0/i.test(cookie)) jar.delete(name)
        else jar.set(name, value)
      }
      return response
    }) as typeof globalThis.fetch
    const client = yield* makeClient(fetch)
    const auth: Browser["auth"] = (path, body = {}) =>
      Effect.promise(() =>
        fetch(`/api/auth${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      )
    return {
      fetch,
      client,
      auth,
      signUp: ({ email, name, password }) => auth("/sign-up/email", { email, password, name: name ?? email.split("@")[0] }),
      signIn: (input) => auth("/sign-in/email", input)
    } satisfies Browser
  })

const makeClient = (fetch: typeof globalThis.fetch) =>
  HttpApiClient.make(FlockApi, { baseUrl: BASE_URL }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.Fetch, fetch)
  )

export class Harness extends Context.Service<Harness, {
  /** The server as a fetch-style handler (no port). */
  readonly handler: (request: Request) => Promise<Response>
  /** `fetch` against the server without cookies; relative URLs resolve against BASE_URL. */
  readonly fetch: typeof globalThis.fetch
  /**
   * Typed client without cookies or an `Origin` header, like a server or native app
   * sending Events. Use it for ingest unless the test is about browser origins.
   */
  readonly sdk: HttpApiClient.ForApi<typeof FlockApi>
  /** The browser signed in as an Instance admin; `client` is its typed client. */
  readonly admin: Browser
  /** Typed client derived from the shared FlockApi, signed in as an Instance admin. */
  readonly client: HttpApiClient.ForApi<typeof FlockApi>
  /** Runs the `admin` CLI command against this Instance and returns its output. */
  readonly adminCommand: (args: ReadonlyArray<string>) => Effect.Effect<string, AdminCommandError>
  /** A fresh browser (empty cookie jar). */
  readonly browser: () => Effect.Effect<Browser>
  /** Creates a Member who signs in with email + password (not an Instance admin). */
  readonly seedMember: (input: { readonly email: string; readonly password: string; readonly name?: string }) => Effect.Effect<MemberId>
  /**
   * Creates a Project through the Projects API as `h.client` (or `as`), adds the other
   * Environments (`production` always exists), and returns it with their keys.
   */
  readonly createProject: (options: {
    readonly name?: string
    readonly timeZone?: string
    readonly environments?: ReadonlyArray<string>
    readonly as?: Browser
  }) => Effect.Effect<Project>
  /** Convenience: the Pageview count for an Environment in `[from, to)` (ISO strings). */
  readonly pageviewCount: (
    environmentId: EnvironmentId,
    range: { readonly from: string; readonly to: string }
  ) => Effect.Effect<number, unknown>
}>()("test/Harness") {
  static readonly layer = (options: HarnessOptions = {}) =>
    Layer.effect(
      Harness,
      Effect.gen(function*() {
        const databaseUrl = Redacted.make(yield* TestDatabase)
        const settings: AuthConfig["Service"] = {
          publicUrl: options.zeroConfig ? Option.none() : Option.some(BASE_URL),
          trustedOrigins: [],
          secret: options.zeroConfig ? Option.none() : Option.some(Redacted.make("test-secret-test-secret-test-secret-0123")),
          adminEmail: Option.some(options.adminEmail ?? "owner@flock.test")
        }
        const Deps = AppLive(databaseUrl).pipe(
          Layer.provideMerge(Layer.succeed(AuthConfig, settings)),
          Layer.provideMerge(GeoIp.layerFixed(options.geoIp ?? {})),
          Layer.provideMerge(MigratorLive),
          Layer.provideMerge(PgLive(databaseUrl)),
          Layer.provideMerge(NodeHttpServer.layerHttpServices)
        )
        // Infra (pool timers, background fibers) must run on the live clock, or
        // TestClock.setTime would replay their timers. Requests below run on the TestClock.
        const deps = yield* TestClock.withLive(Layer.build(Deps))
        yield* TestClock.setTime(Date.now())

        const app = yield* HttpRouter.toHttpEffect(AppRoutes({ publicDir, scriptFile })).pipe(Effect.provide(deps))
        const context = yield* Effect.context<never>() // includes the TestClock
        const handler: (request: Request) => Promise<Response> = HttpEffect.toWebHandlerWith<
          never,
          HttpServerRequest | Scope.Scope
        >(context)(Effect.provide(app, deps))

        const fetch = ((input: string | URL | Request, init?: RequestInit) =>
          handler(
            input instanceof Request ? input : new Request(new URL(input.toString(), BASE_URL), init)
          )) as typeof globalThis.fetch

        const sdk = yield* makeClient(fetch)
        const seed = Context.get(deps, Seed)
        const browser = () => makeBrowser(handler)
        const seedMember: Harness["Service"]["seedMember"] = (input) => seed.member(input)

        // The default client: a seeded Member, made Instance admin, signed in.
        const admin = { email: "harness-admin@flock.test", password: "harness-password" }
        const adminId = yield* seedMember(admin)
        yield* Context.get(deps, Access).grantAdmin(adminId).pipe(Effect.orDie)
        const adminBrowser = yield* browser()
        yield* adminBrowser.signIn(admin)
        const client = adminBrowser.client

        let projects = 0
        const createProject: Harness["Service"]["createProject"] = (o) =>
          Effect.gen(function*() {
            const api = o.as?.client ?? client
            const project = yield* api.projects.create({
              payload: { name: o.name ?? `Project ${++projects}`, timeZone: o.timeZone ?? "UTC" }
            })
            for (const name of o.environments ?? []) {
              if (name !== "production") yield* api.projects.addEnvironment({ params: { projectId: project.id }, payload: { name } })
            }
            return yield* api.projects.get({ params: { projectId: project.id } })
          }).pipe(Effect.orDie)

        const pageviewCount: Harness["Service"]["pageviewCount"] = (environmentId, range) =>
          client.reports.pageviewCount({
            params: { environmentId },
            query: { from: DateTime.makeUnsafe(range.from), to: DateTime.makeUnsafe(range.to) }
          }).pipe(Effect.map((r) => r.pageviews))

        return Harness.of({
          handler,
          fetch,
          sdk,
          admin: adminBrowser,
          client,
          adminCommand: (args) => adminCommand(args).pipe(Effect.provide(deps)),
          browser, seedMember, createProject, pageviewCount })
      })
    ).pipe(Layer.provide(TestDatabase.layer))
}

/** A Pageview Event with a fresh UUID. */
export const pageview = (properties: IngestEvent["properties"] = {}): IngestEvent => ({
  uuid: crypto.randomUUID(),
  name: "$pageview",
  properties: { $url: "https://example.com/", ...properties }
})

/** A Custom event with a fresh UUID. */
export const customEvent = (name: string, properties: IngestEvent["properties"] = {}): IngestEvent => ({
  uuid: crypto.randomUUID(),
  name,
  properties
})
