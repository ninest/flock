// Property filters: every report narrowed to the Events that match, observed through the
// reports and Custom events APIs.
import { assert, layer } from "@effect/vitest"
import type { EventPropertyFilter, TopRow } from "@flock/shared"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { customEvent, Harness, pageview } from "./harness.ts"

/** A ranked-list row's counts, leaving its engagement columns to engagement.test.ts. */
const counts = (rows: ReadonlyArray<TopRow>) =>
  rows.map(({ pageviews, value, visitors }) => pageviews === undefined ? { value, visitors } : { value, visitors, pageviews })

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
        h.client.customEvents.list({ params: { environmentId: production!.id }, query: day(filters) }).pipe(
          Effect.map((l) => ({ events: l.events.map(({ name, count, visitors }) => ({ name, count, visitors })) })),
          Effect.orDie
        )
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
  it.effect("top pages count only matching Events; entry and exit pages come from the whole of the matching Sessions", () =>
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

      assert.deepStrictEqual(counts((yield* h.top(production!.id, "pages", de)).rows), [
        { value: "/", visitors: 1, pageviews: 1 },
        { value: "/pricing", visitors: 1, pageviews: 1 }
      ])
      assert.deepStrictEqual(counts((yield* h.top(production!.id, "entryPages", de)).rows), [{ value: "/", visitors: 1 }])
      assert.deepStrictEqual(counts((yield* h.top(production!.id, "exitPages", de)).rows), [{ value: "/pricing", visitors: 1 }])
      // Filtering by a page selects the Sessions that viewed it; each keeps its own entry and exit.
      yield* at("2026-03-01T09:10:00Z")
      yield* h.ingest(production!.key, [pageview({ $url: url("/signup") })], { ip: DE })
      const pricing = day([is("$path", "/pricing")])
      assert.deepStrictEqual(counts((yield* h.top(production!.id, "entryPages", pricing)).rows), [
        { value: "/", visitors: 1 },
        { value: "/blog", visitors: 1 }
      ])
      assert.deepStrictEqual(counts((yield* h.top(production!.id, "exitPages", pricing)).rows), [
        { value: "/pricing", visitors: 1 },
        { value: "/signup", visitors: 1 }
      ])
    }))

  it.effect("referrers and UTM tags count only Visitors with a matching Session", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [pageview({ $url: url("/?utm_source=newsletter"), $referrer: "https://news.ycombinator.com/" })], { ip: DE })
      yield* h.ingest(production!.key, [pageview({ $url: url("/?utm_source=twitter"), $referrer: "https://www.google.com/" })], { ip: US })
      const de = day([is("$country", "DE")])

      assert.deepStrictEqual(counts((yield* h.top(production!.id, "referrers", de)).rows), [{ value: "news.ycombinator.com", visitors: 1 }])
      assert.deepStrictEqual(counts((yield* h.top(production!.id, "utmSources", de)).rows), [{ value: "newsletter", visitors: 1 }])
      const google = day([is("$referring_domain", "google.com")])
      assert.deepStrictEqual(counts((yield* h.top(production!.id, "countries", google)).rows), [{ value: "US", visitors: 1 }])
      const twitter = day([is("$utm_source", "twitter")])
      assert.deepStrictEqual(counts((yield* h.top(production!.id, "referrers", twitter)).rows), [{ value: "google.com", visitors: 1 }])
    }))

  it.effect("referrers and UTM tags come from the first Pageview of a Session matched by a later one", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      // Arrives from Hacker News on a tagged /landing, then views /pricing with an internal referrer and other tags.
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [pageview({
        $url: url("/landing?utm_source=newsletter&utm_medium=email&utm_campaign=launch"),
        $referrer: "https://news.ycombinator.com/item?id=42"
      })], { ip: DE })
      yield* at("2026-03-01T09:05:00Z")
      yield* h.ingest(production!.key, [pageview({
        $url: url("/pricing?utm_source=banner&utm_medium=onsite&utm_campaign=upsell"),
        $referrer: url("/landing")
      })], { ip: DE })
      // A direct, untagged Session that never views /pricing is not in the report.
      yield* h.ingest(production!.key, [pageview({ $url: url("/") })], { ip: US })

      const pricing = day([is("$path", "/pricing")])
      const rows = (report: "referrers" | "utmSources" | "utmMediums" | "utmCampaigns") =>
        h.top(production!.id, report, pricing).pipe(Effect.map((top) => counts(top.rows)))
      assert.deepStrictEqual(yield* rows("referrers"), [{ value: "news.ycombinator.com", visitors: 1 }])
      assert.deepStrictEqual(yield* rows("utmSources"), [{ value: "newsletter", visitors: 1 }])
      assert.deepStrictEqual(yield* rows("utmMediums"), [{ value: "email", visitors: 1 }])
      assert.deepStrictEqual(yield* rows("utmCampaigns"), [{ value: "launch", visitors: 1 }])
    }))

  it.effect("audience reports count only Visitors with a matching Event", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* at("2026-03-01T09:00:00Z")
      const firefox = "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0"
      yield* h.ingest(production!.key, [pageview({ $url: url("/pricing") })], { ip: DE, userAgent: firefox })
      yield* h.ingest(production!.key, [pageview({ $url: url("/") })], { ip: US, userAgent: firefox })
      yield* h.ingest(production!.key, [pageview({ $url: url("/pricing") })], { ip: US, userAgent: firefox })

      const pricing = day([is("$path", "/pricing")])
      assert.deepStrictEqual(counts((yield* h.top(production!.id, "countries", pricing)).rows), [
        { value: "DE", visitors: 1 },
        { value: "US", visitors: 1 }
      ])
      // The US Visitor's two Pageviews count once.
      assert.deepStrictEqual(counts((yield* h.top(production!.id, "browsers", day([is("$country", "US")]))).rows), [{ value: "Firefox", visitors: 1 }])
      // The exact-range breakdown endpoint takes filters too.
      const range = { from: "2026-03-01T00:00:00Z", to: "2026-03-02T00:00:00Z" }
      assert.deepStrictEqual(yield* h.breakdown(production!.id, "$country", range, undefined, [is("$path", "/")]), [{ value: "US", count: 1 }])
    }))

  it.effect("a Filter that matches only Custom events lists the Visitors the headline counts", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* at("2026-03-01T09:00:00Z")
      const firefox = "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0"
      // One Visitor signs up after a Pageview, one sends the Custom event alone, one only views a page.
      yield* h.ingest(production!.key, [pageview({ $url: url("/") }), customEvent("signup", { plan: "pro" })], { ip: DE, userAgent: firefox })
      yield* h.ingest(production!.key, [customEvent("signup", { plan: "pro" })], { ip: US, userAgent: firefox })
      yield* h.ingest(production!.key, [pageview({ $url: url("/") })], { ip: "198.51.100.99" })

      const pro = day([is("plan", "pro")])
      assert.strictEqual((yield* h.overview(production!.id, pro)).totals.visitors, 2)
      const rows = (report: "countries" | "browsers" | "oses" | "devices") => h.top(production!.id, report, pro).pipe(Effect.map((top) => top.rows))
      // The US Session is its one Custom event, a Bounce; the DE one has a Pageview too.
      assert.deepStrictEqual(yield* rows("countries"), [
        { value: "DE", visitors: 1, bounceRate: 0 },
        { value: "US", visitors: 1, bounceRate: 1 }
      ])
      assert.deepStrictEqual(yield* rows("browsers"), [{ value: "Firefox", visitors: 2, bounceRate: 0.5 }])
      assert.deepStrictEqual(yield* rows("oses"), [{ value: "Linux", visitors: 2, bounceRate: 0.5 }])
      assert.deepStrictEqual(yield* rows("devices"), [{ value: "desktop", visitors: 2, bounceRate: 0.5 }])
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
      assert.deepStrictEqual(list.events.map(({ name, count, visitors }) => ({ name, count, visitors })), [
        { name: "game_completed", count: 2, visitors: 2 }
      ])
      assert.deepStrictEqual(list.events[0]!.series.filter((b) => b.count > 0), [{ bucket: "2026-03-01T09:00", count: 2 }])

      assert.strictEqual(list.events[0]!.previousCount, 0)

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

  it.effect("the list's previous-period count matches the same Filters", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* at("2026-02-28T09:00:00Z") // the previous period of 2026-03-01
      yield* h.ingest(production!.key, [
        customEvent("game_completed", { level: "hard" }),
        customEvent("game_completed", { level: "easy" }),
        customEvent("game_completed", { level: "hard" })
      ], { ip: DE })
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [customEvent("game_completed", { level: "hard" })], { ip: DE })
      yield* at("2026-03-02T09:00:00Z") // after the range, so its previous period is the whole of 2026-02-28

      const list = yield* h.client.customEvents.list({ params: { environmentId: production!.id }, query: day([is("level", "hard")]) })
        .pipe(Effect.orDie)
      assert.deepStrictEqual(list.events.map((e) => [e.name, e.count, e.previousCount]), [["game_completed", 1, 2]])
    }))
})
