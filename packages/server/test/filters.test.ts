// Property filters: every report narrowed to the Events that match, observed through the
// reports and Custom events APIs.
import { assert, layer } from "@effect/vitest"
import type { EventPropertyFilter } from "@flock/shared"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { customEvent, Harness, pageview } from "./harness.ts"

const at = (iso: string) => TestClock.setTime(Date.parse(iso))
const DE = "203.0.113.7"
const US = "198.51.100.23"
const geoIp = { [DE]: "DE", [US]: "US" }
const day = (filters: ReadonlyArray<EventPropertyFilter>) => ({ period: "custom" as const, from: "2026-03-01", to: "2026-03-01", filters })
const is = (eventProperty: string, value: string): EventPropertyFilter => ({ eventProperty, op: "is", value })
const url = (path: string) => `https://example.com${path}`

layer(Harness.layer({ geoIp }))("Overview with filters", (it) => {
  it.effect("counts only the Events that match a filter", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [pageview({ $url: url("/") }), pageview({ $url: url("/pricing") })], { ip: DE })
      yield* h.ingest(production!.key, [pageview({ $url: url("/") })], { ip: US })

      const overview = yield* h.overview(production!.id, day([is("$country", "DE")]))
      assert.deepStrictEqual(overview.totals, { visitors: 1, pageviews: 2, sessions: 1, bounceRate: 0, visitDuration: 0 })
      const unfiltered = yield* h.overview(production!.id, day([]))
      assert.strictEqual(unfiltered.totals.pageviews, 3)
    }))
})

layer(Harness.layer({ geoIp }))("Filter operators", (it) => {
  it.effect("combine with AND, and support is, isNot and contains", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [
        pageview({ $url: url("/pricing"), plan: "Pro" }),
        pageview({ $url: url("/pricing/teams"), plan: "team" }),
        pageview({ $url: url("/blog") })
      ], { ip: DE })
      yield* h.ingest(production!.key, [pageview({ $url: url("/pricing"), plan: "pro" })], { ip: US })
      const pageviews = (filters: ReadonlyArray<EventPropertyFilter>) =>
        h.overview(production!.id, day(filters)).pipe(Effect.map((o) => o.totals.pageviews))

      assert.strictEqual(yield* pageviews([is("$country", "DE"), is("$path", "/pricing")]), 1)
      // isNot keeps Events without the property.
      assert.strictEqual(yield* pageviews([{ eventProperty: "plan", op: "isNot", value: "team" }]), 3)
      // contains ignores case and skips Events without the property.
      assert.strictEqual(yield* pageviews([{ eventProperty: "plan", op: "contains", value: "PR" }]), 2)
      assert.strictEqual(yield* pageviews([{ eventProperty: "$url", op: "contains", value: "/pricing" }, is("$country", "US")]), 1)
      assert.strictEqual(yield* pageviews([is("$country", "FR")]), 0)
    }))

  it.effect("compare numbers and booleans by their text", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [
        customEvent("game_completed", { score: 34, won: true }),
        customEvent("game_completed", { score: 12, won: false })
      ])
      const list = (filters: ReadonlyArray<EventPropertyFilter>) =>
        h.client.customEvents.list({ params: { environmentId: production!.id }, query: day(filters) }).pipe(Effect.orDie)
      assert.deepStrictEqual((yield* list([is("score", "34")])).events, [{ name: "game_completed", count: 1, visitors: 1 }])
      assert.deepStrictEqual((yield* list([is("won", "false")])).events, [{ name: "game_completed", count: 1, visitors: 1 }])
    }))

  it.effect("travel in the query string as one JSON parameter, and invalid ones are rejected", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [pageview()], { ip: DE })
      yield* h.ingest(production!.key, [pageview()], { ip: US })
      const get = (filters: string) => {
        const query = new URLSearchParams({ period: "custom", from: "2026-03-01", to: "2026-03-01", filters })
        return Effect.promise(() => h.admin.fetch(`/api/environments/${production!.id}/overview?${query}`))
      }
      const ok = yield* get(JSON.stringify([is("$country", "US")]))
      assert.strictEqual(ok.status, 200)
      const body = (yield* Effect.promise(() => ok.json())) as { totals: { pageviews: number } }
      assert.strictEqual(body.totals.pageviews, 1)
      assert.strictEqual((yield* get(JSON.stringify([{ eventProperty: "$country", op: "like", value: "US" }]))).status, 400)
      assert.strictEqual((yield* get("not json")).status, 400)
    }))
})

layer(Harness.layer({ geoIp }))("Pages, sources and audience with filters", (it) => {
  it.effect("top, entry and exit pages count only matching Events", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [pageview({ $url: url("/") })], { ip: DE })
      yield* h.ingest(production!.key, [pageview({ $url: url("/blog") })], { ip: US })
      yield* at("2026-03-01T09:05:00Z")
      yield* h.ingest(production!.key, [pageview({ $url: url("/pricing") })], { ip: DE })
      yield* h.ingest(production!.key, [pageview({ $url: url("/pricing") })], { ip: US })
      const de = day([is("$country", "DE")])

      assert.deepStrictEqual((yield* h.top(production!.id, "pages", de)).rows, [
        { value: "/", count: 1 },
        { value: "/pricing", count: 1 }
      ])
      assert.deepStrictEqual((yield* h.top(production!.id, "entryPages", de)).rows, [{ value: "/", count: 1 }])
      assert.deepStrictEqual((yield* h.top(production!.id, "exitPages", de)).rows, [{ value: "/pricing", count: 1 }])
      // Filtering by a page keeps only its Pageviews, so it is each Session's entry and exit.
      const pricing = day([is("$path", "/pricing")])
      assert.deepStrictEqual((yield* h.top(production!.id, "entryPages", pricing)).rows, [{ value: "/pricing", count: 2 }])
    }))

  it.effect("referrers and UTM tags count only matching Sessions", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [pageview({ $url: url("/?utm_source=newsletter"), $referrer: "https://news.ycombinator.com/" })], { ip: DE })
      yield* h.ingest(production!.key, [pageview({ $url: url("/?utm_source=twitter"), $referrer: "https://www.google.com/" })], { ip: US })
      const de = day([is("$country", "DE")])

      assert.deepStrictEqual((yield* h.top(production!.id, "referrers", de)).rows, [{ value: "news.ycombinator.com", count: 1 }])
      assert.deepStrictEqual((yield* h.top(production!.id, "utmSources", de)).rows, [{ value: "newsletter", count: 1 }])
      const google = day([is("$referring_domain", "google.com")])
      assert.deepStrictEqual((yield* h.top(production!.id, "countries", google)).rows, [{ value: "US", count: 1 }])
      const twitter = day([is("$utm_source", "twitter")])
      assert.deepStrictEqual((yield* h.top(production!.id, "referrers", twitter)).rows, [{ value: "google.com", count: 1 }])
    }))

  it.effect("audience reports count only matching Pageviews", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* at("2026-03-01T09:00:00Z")
      const firefox = "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0"
      yield* h.ingest(production!.key, [pageview({ $url: url("/pricing") })], { ip: DE, userAgent: firefox })
      yield* h.ingest(production!.key, [pageview({ $url: url("/") })], { ip: US, userAgent: firefox })
      yield* h.ingest(production!.key, [pageview({ $url: url("/pricing") })], { ip: US, userAgent: firefox })

      const pricing = day([is("$path", "/pricing")])
      assert.deepStrictEqual((yield* h.top(production!.id, "countries", pricing)).rows, [
        { value: "DE", count: 1 },
        { value: "US", count: 1 }
      ])
      assert.deepStrictEqual((yield* h.top(production!.id, "browsers", day([is("$country", "US")]))).rows, [{ value: "Firefox", count: 2 }])
      // The exact-range breakdown endpoint takes filters too.
      const range = { from: "2026-03-01T00:00:00Z", to: "2026-03-02T00:00:00Z" }
      assert.deepStrictEqual(yield* h.breakdown(production!.id, "$country", range, undefined, [is("$path", "/")]), [{ value: "US", count: 1 }])
    }))

  it.effect("the live counter counts only Visitors with a matching Event", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [pageview({ $url: url("/pricing") })], { ip: DE })
      yield* h.ingest(production!.key, [pageview({ $url: url("/") })], { ip: US })
      assert.strictEqual(yield* h.live(production!.id), 2)
      assert.strictEqual(yield* h.live(production!.id, [is("$path", "/pricing")]), 1)
      assert.strictEqual(yield* h.live(production!.id, [is("$country", "US"), is("$path", "/pricing")]), 0)
    }))
})

layer(Harness.layer({ geoIp }))("Custom events with filters", (it) => {
  it.effect("the list, drill-down, breakdown and numeric stats count only matching Events", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [
        customEvent("game_completed", { score: 10, level: "easy" }),
        customEvent("game_completed", { score: 30, level: "hard" }),
        customEvent("login_clicked")
      ], { ip: DE })
      yield* h.ingest(production!.key, [customEvent("game_completed", { score: 100, level: "hard" })], { ip: US })
      const environmentId = production!.id
      const de = day([is("$country", "DE")])
      const api = h.client.customEvents

      const list = yield* api.list({ params: { environmentId }, query: day([is("level", "hard")]) }).pipe(Effect.orDie)
      assert.deepStrictEqual(list.events, [{ name: "game_completed", count: 2, visitors: 2 }])

      const detail = yield* api.detail({ params: { environmentId }, query: { ...de, name: "game_completed" } }).pipe(Effect.orDie)
      assert.deepStrictEqual(detail.totals, { count: 2, visitors: 1 })

      const breakdown = yield* api.breakdown({ params: { environmentId }, query: { ...de, name: "game_completed", eventProperty: "level" } })
        .pipe(Effect.orDie)
      assert.deepStrictEqual(breakdown.rows, [{ value: "easy", count: 1 }, { value: "hard", count: 1 }])

      const stats = yield* api.stats({
        params: { environmentId },
        query: { ...day([is("level", "hard")]), name: "game_completed", eventProperty: "score" }
      }).pipe(Effect.orDie)
      assert.deepStrictEqual(stats.totals, { count: 2, average: 65, sum: 130, min: 30, max: 100, median: 65 })
    }))
})
