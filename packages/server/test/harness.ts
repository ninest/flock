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
// With `options.oidc`, a stub OIDC issuer (`h.oidc`) is configured and `browser.oidcSignIn()`
// runs the whole code flow against it.
//
// One database per `layer(...)` block (usually one per test file), dropped when
// the block finishes. Tests observe behavior only through HTTP: never query tables.
import { NodeHttpServer } from "@effect/platform-node"
import {
  type BreakdownRow,
  type EnvironmentId,
  FlockApi,
  type IngestEvent,
  type IngestResult,
  type MemberId,
  type Overview,
  type OverviewQuery,
  type PropertyFilters,
  type Project,
  type ReportRangeQuery,
  type Top,
  type TopReport
} from "@flock/shared"
import { Context, DateTime, Effect, Layer, Option, Redacted, type Scope } from "effect"
import { FetchHttpClient, HttpEffect, HttpRouter } from "effect/http"
import type { HttpServerRequest } from "effect/http/HttpServerRequest"
import { HttpApiClient } from "effect/http-api"
import { TestClock } from "effect/testing"
import { fileURLToPath } from "node:url"
import { Access, AuthConfig } from "../src/access.ts"
import { type AdminCommandError, adminCommand } from "../src/admin-command.ts"
import { AppLive } from "../src/app.ts"
import { parseTrustedProxies } from "../src/client-ip.ts"
import { PgLive } from "../src/db.ts"
import { GeoIp } from "../src/geoip.ts"
import { AppRoutes } from "../src/http.ts"
import { MigratorLive } from "../src/migrations/index.ts"
import { Seed } from "../src/seed.ts"
import { type OidcStub, startOidcStub } from "./oidc-stub.ts"
import { TestDatabase } from "./test-database.ts"

export const BASE_URL = "http://flock.test"
const publicDir = fileURLToPath(new URL("./fixtures/public", import.meta.url))
/** Stands in for the built browser script. */
export const scriptFile = fileURLToPath(new URL("./fixtures/flock.js", import.meta.url))

export interface HarnessOptions {
  /** IP address -> ISO country code (or country and region), served by the GeoIP test layer. */
  readonly geoIp?: Record<string, string | { readonly country: string; readonly region?: string }>
  /** FLOCK_ADMIN_EMAIL (default `owner@flock.test`). */
  readonly adminEmail?: string
  /** Leave FLOCK_PUBLIC_URL and BETTER_AUTH_SECRET unset, like a fresh self-hosted Instance. */
  readonly zeroConfig?: boolean
  /** Configure the stub OIDC issuer; `trustEmails` is FLOCK_OIDC_TRUST_EMAILS. */
  readonly oidc?: { readonly trustEmails?: boolean }
  /** FLOCK_TRUSTED_PROXIES (default `1`, so `ingest`'s `ip` is the client IP). */
  readonly trustedProxies?: string
  /** FLOCK_PASSWORD_SIGN_IN (default true). */
  readonly passwordSignIn?: boolean
}

/** The name the sign-in page shows for the stub issuer (FLOCK_OIDC_NAME). */
export const OIDC_NAME = "Example ID"

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
  /**
   * Signs in with the OIDC issuer (as whoever `h.oidc.setNextUser` set), following every
   * redirect between Flock and the issuer. Returns the response that leaves the auth flow:
   * a redirect to `/` on success, or to `/sign-in?error=…` on failure.
   */
  readonly oidcSignIn: (input?: { readonly invite?: string }) => Effect.Effect<Response>
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
    const oidcSignIn: Browser["oidcSignIn"] = ({ invite } = {}) =>
      Effect.promise(async () => {
        const start = await fetch("/api/auth/sign-in/social", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            provider: "misc",
            callbackURL: "/",
            errorCallbackURL: "/sign-in",
            ...(invite === undefined ? {} : { additionalData: { invite } })
          })
        })
        if (!start.ok) return start
        let url = new URL(((await start.json()) as { url: string }).url)
        for (let hop = 0; hop < 10; hop++) {
          const response = url.origin === BASE_URL
            ? await fetch(url.toString(), { redirect: "manual" })
            : await globalThis.fetch(url, { redirect: "manual" })
          const location = response.headers.get("location")
          if (response.status < 300 || response.status >= 400 || location === null) return response
          const next = new URL(location, url)
          if (next.origin === BASE_URL && !next.pathname.startsWith("/api/")) return response
          url = next
        }
        throw new Error("Too many redirects")
      })
    return {
      fetch,
      client,
      auth,
      oidcSignIn,
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
  /** The stub OIDC issuer, when `options.oidc` is set. */
  readonly oidc: OidcStub | undefined
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
  /**
   * POSTs a batch to the ingest endpoint like a browser behind a proxy would:
   * `ip` goes in X-Forwarded-For, `userAgent` in User-Agent (both omitted by default).
   */
  readonly ingest: (
    key: string,
    events: ReadonlyArray<IngestEvent>,
    request?: { readonly ip?: string; readonly userAgent?: string }
  ) => Effect.Effect<IngestResult>
  /** Convenience: a breakdown report (Pageviews unless `event`) by one Event property. */
  readonly breakdown: (
    environmentId: EnvironmentId,
    property: string,
    range: { readonly from: string; readonly to: string },
    event?: string,
    filters?: PropertyFilters
  ) => Effect.Effect<ReadonlyArray<BreakdownRow>>
  /** Convenience: the Event property keys seen in `[from, to)`. */
  readonly propertyKeys: (
    environmentId: EnvironmentId,
    range: { readonly from: string; readonly to: string }
  ) => Effect.Effect<ReadonlyArray<string>>
  /** Convenience: the overview report for an Environment, as `h.client`. */
  readonly overview: (environmentId: EnvironmentId, range: OverviewQuery) => Effect.Effect<Overview, unknown>
  /** Convenience: a ranked-list report for an Environment, as `h.client`. */
  readonly top: (environmentId: EnvironmentId, report: TopReport, range: ReportRangeQuery) => Effect.Effect<Top>
  /** Convenience: the live counter (unique Visitors in the last 30 minutes), as `h.client`. */
  readonly live: (environmentId: EnvironmentId, filters?: PropertyFilters) => Effect.Effect<number>
}>()("test/Harness") {
  static readonly layer = (options: HarnessOptions = {}) =>
    Layer.effect(
      Harness,
      Effect.gen(function*() {
        const databaseUrl = Redacted.make(yield* TestDatabase)
        const clientId = "flock-test"
        const clientSecret = "flock-test-secret"
        const oidc = options.oidc === undefined ? undefined : yield* Effect.acquireRelease(
          Effect.promise(() => startOidcStub({ clientId, clientSecret })),
          (stub) => Effect.promise(() => stub.close())
        )
        const settings: AuthConfig["Service"] = {
          publicUrl: options.zeroConfig ? Option.none() : Option.some(BASE_URL),
          trustedOrigins: [],
          secret: options.zeroConfig ? Option.none() : Option.some(Redacted.make("test-secret-test-secret-test-secret-0123")),
          adminEmail: Option.some(options.adminEmail ?? "owner@flock.test"),
          passwordSignIn: options.passwordSignIn ?? true,
          oidc: oidc === undefined ? Option.none() : Option.some({
            issuer: oidc.issuer,
            clientId,
            clientSecret: Redacted.make(clientSecret),
            name: OIDC_NAME,
            trustEmails: options.oidc?.trustEmails ?? false
          })
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

        const trustedProxies = parseTrustedProxies(options.trustedProxies ?? "1")
        if (typeof trustedProxies === "string") return yield* Effect.die(trustedProxies)
        const app = yield* HttpRouter.toHttpEffect(AppRoutes({ publicDir, scriptFile, trustedProxies })).pipe(Effect.provide(deps))
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

        // The default client: a Member made Instance admin, signed in. With password sign-in
        // off, they join through the OIDC issuer during a moment of Open sign-up.
        const access = Context.get(deps, Access)
        const admin = { email: "harness-admin@flock.test", password: "harness-password" }
        const adminBrowser = yield* browser()
        if (settings.passwordSignIn || oidc === undefined) {
          const adminId = yield* seedMember(admin)
          yield* access.grantAdmin(adminId).pipe(Effect.orDie)
          yield* adminBrowser.signIn(admin)
        } else {
          oidc.setNextUser({ sub: "harness-admin", email: admin.email, email_verified: true })
          yield* access.updateSettings({ openSignUp: true }).pipe(Effect.orDie)
          yield* adminBrowser.oidcSignIn()
          yield* access.updateSettings({ openSignUp: false }).pipe(Effect.orDie)
          const adminMember = yield* access.memberByEmail(admin.email).pipe(Effect.orDie)
          yield* access.grantAdmin(Option.getOrThrow(adminMember).id).pipe(Effect.orDie)
        }
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

        const toRange = (range: { readonly from: string; readonly to: string }) => ({
          from: DateTime.makeUnsafe(range.from),
          to: DateTime.makeUnsafe(range.to)
        })

        const ingest: Harness["Service"]["ingest"] = (key, events, request = {}) =>
          Effect.promise(async () => {
            const headers = new Headers({ "content-type": "application/json" })
            if (request.ip !== undefined) headers.set("x-forwarded-for", request.ip)
            if (request.userAgent !== undefined) headers.set("user-agent", request.userAgent)
            const response = await fetch("/api/ingest", { method: "POST", headers, body: JSON.stringify({ key, events }) })
            if (!response.ok) throw new Error(`ingest answered ${response.status}: ${await response.text()}`)
            return (await response.json()) as IngestResult
          })

        const overview: Harness["Service"]["overview"] = (environmentId, query) =>
          client.reports.overview({ params: { environmentId }, query })

        const breakdown: Harness["Service"]["breakdown"] = (environmentId, property, range, event, filters) =>
          client.reports.breakdown({ params: { environmentId }, query: { ...toRange(range), property, event, filters } }).pipe(Effect.orDie)

        const propertyKeys: Harness["Service"]["propertyKeys"] = (environmentId, range) =>
          client.reports.propertyKeys({ params: { environmentId }, query: toRange(range) }).pipe(
            Effect.map((r) => r.keys),
            Effect.orDie
          )

        const top: Harness["Service"]["top"] = (environmentId, report, range) =>
          client.reports.top({ params: { environmentId }, query: { ...range, report } }).pipe(Effect.orDie)

        const live: Harness["Service"]["live"] = (environmentId, filters) =>
          client.reports.live({ params: { environmentId }, query: { filters } }).pipe(Effect.map((r) => r.visitors), Effect.orDie)

        return Harness.of({
          ingest, breakdown, propertyKeys, top, live,
          handler,
          oidc,
          fetch,
          sdk,
          admin: adminBrowser,
          client,
          adminCommand: (args) => adminCommand(args).pipe(Effect.provide(deps)),
          browser, seedMember, createProject, pageviewCount, overview })
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
