// Pages, sources and the live counter, observed through the reports API.
import { assert, layer } from "@effect/vitest"
import type { IngestEvent } from "@flock/shared"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { customEvent, Harness, pageview } from "./harness.ts"

const at = (iso: string) => TestClock.setTime(Date.parse(iso))
const day = { period: "custom" as const, from: "2026-03-01", to: "2026-03-01" }
const visit = (url: string, referrer?: string): IngestEvent =>
  pageview(referrer === undefined ? { $url: url } : { $url: url, $referrer: referrer })

layer(Harness.layer())("Top pages", (it) => {
  it.effect("counts Pageviews per cleaned URL path", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* at("2026-03-01T10:00:00Z")
      yield* h.ingest(production!.key, [
        visit("https://example.com/pricing?plan=pro"),
        visit("https://example.com/pricing?utm_source=newsletter#faq"),
        visit("https://www.example.com/pricing"),
        visit("https://example.com/"),
        visit("https://example.com"),
        visit("https://example.com/blog/first-post"),
        customEvent("login_clicked", { $url: "https://example.com/blog/first-post" })
      ])

      const top = yield* h.top(production!.id, "pages", day)
      assert.deepStrictEqual(top.rows, [
        { value: "/pricing", count: 3 },
        { value: "/", count: 2 },
        { value: "/blog/first-post", count: 1 }
      ])
    }))
})

layer(Harness.layer())("Entry and exit pages", (it) => {
  it.effect("come from the first and last Pageview of each Session", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      // Visitor 1, Session 1: / -> /pricing -> /signup, then a Custom event (not a Pageview).
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [visit("https://example.com/")], { ip: "198.51.100.1" })
      yield* at("2026-03-01T09:05:00Z")
      yield* h.ingest(production!.key, [visit("https://example.com/pricing")], { ip: "198.51.100.1" })
      yield* at("2026-03-01T09:10:00Z")
      yield* h.ingest(production!.key, [visit("https://example.com/signup?token=x")], { ip: "198.51.100.1" })
      yield* at("2026-03-01T09:11:00Z")
      yield* h.ingest(production!.key, [customEvent("signup_completed", { $url: "https://example.com/welcome" })], { ip: "198.51.100.1" })
      // Visitor 1, Session 2 (over 30 minutes later): a single Pageview on /pricing.
      yield* at("2026-03-01T11:00:00Z")
      yield* h.ingest(production!.key, [visit("https://example.com/pricing")], { ip: "198.51.100.1" })
      // Visitor 2: /blog -> /
      yield* h.ingest(production!.key, [visit("https://example.com/blog")], { ip: "198.51.100.2" })
      yield* at("2026-03-01T11:02:00Z")
      yield* h.ingest(production!.key, [visit("https://example.com/")], { ip: "198.51.100.2" })

      const entries = yield* h.top(production!.id, "entryPages", day)
      assert.deepStrictEqual(entries.rows, [
        { value: "/", count: 1 },
        { value: "/blog", count: 1 },
        { value: "/pricing", count: 1 }
      ])
      const exits = yield* h.top(production!.id, "exitPages", day)
      assert.deepStrictEqual(exits.rows, [
        { value: "/", count: 1 },
        { value: "/pricing", count: 1 },
        { value: "/signup", count: 1 }
      ])
    }))
})

layer(Harness.layer())("Referrers", (it) => {
  it.effect("group Sessions by the referring domain of their first Pageview", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* at("2026-03-01T09:00:00Z")
      const sessions: ReadonlyArray<[ip: string, referrer: string | undefined]> = [
        ["198.51.100.1", "https://news.ycombinator.com/item?id=42"],
        ["198.51.100.2", "https://news.ycombinator.com/"],
        ["198.51.100.3", "https://www.google.com/"],
        ["198.51.100.4", "https://google.com/search?q=flock"],
        ["198.51.100.9", "https://wwwhat.example.net/"],
        ["198.51.100.5", "https://Mail.Example.org:8443/inbox"],
        ["198.51.100.6", ""],
        ["198.51.100.7", undefined],
        // From the site's own pages: not a referrer.
        ["198.51.100.8", "https://example.com/blog"]
      ]
      for (const [ip, referrer] of sessions) {
        yield* h.ingest(production!.key, [visit("https://example.com/", referrer)], { ip })
      }
      // A later Pageview in Session 1 carries an internal referrer and changes nothing.
      yield* at("2026-03-01T09:01:00Z")
      yield* h.ingest(production!.key, [visit("https://example.com/pricing", "https://example.com/")], { ip: "198.51.100.1" })

      const referrers = yield* h.top(production!.id, "referrers", day)
      // `null` is direct traffic, ranked by its count like any other row.
      assert.deepStrictEqual(referrers.rows, [
        { value: null, count: 3 },
        { value: "google.com", count: 2 },
        { value: "news.ycombinator.com", count: 2 },
        { value: "mail.example.org", count: 1 },
        { value: "wwwhat.example.net", count: 1 }
      ])
    }))
})

layer(Harness.layer())("UTM sources", (it) => {
  it.effect("group Sessions by the utm_* tags of their first Pageview", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* at("2026-03-01T09:00:00Z")
      const landing = "https://example.com/"
      const entries: ReadonlyArray<[ip: string, event: IngestEvent]> = [
        ["198.51.100.1", visit(`${landing}?utm_source=newsletter&utm_medium=email&utm_campaign=spring%20sale`)],
        ["198.51.100.2", visit(`${landing}pricing?utm_source=newsletter&utm_medium=email&utm_campaign=launch`)],
        ["198.51.100.3", visit(`${landing}?UTM_SOURCE=twitter&utm_medium=social&utm_campaign=launch&token=x`)],
        // An app sending the tags as Event properties, without a URL query.
        ["198.51.100.4", pageview({ $url: "app://game/menu", utm_source: "app-store", utm_campaign: "launch" })],
        // Untagged Sessions are left out.
        ["198.51.100.5", visit(landing)]
      ]
      for (const [ip, event] of entries) yield* h.ingest(production!.key, [event], { ip })
      // Tags on a later Pageview in Session 5 don't count: only the first Pageview's do.
      yield* at("2026-03-01T09:01:00Z")
      yield* h.ingest(production!.key, [visit(`${landing}?utm_source=later`)], { ip: "198.51.100.5" })

      assert.deepStrictEqual((yield* h.top(production!.id, "utmSources", day)).rows, [
        { value: "newsletter", count: 2 },
        { value: "app-store", count: 1 },
        { value: "twitter", count: 1 }
      ])
      assert.deepStrictEqual((yield* h.top(production!.id, "utmMediums", day)).rows, [
        { value: "email", count: 2 },
        { value: "social", count: 1 }
      ])
      assert.deepStrictEqual((yield* h.top(production!.id, "utmCampaigns", day)).rows, [
        { value: "launch", count: 3 },
        { value: "spring sale", count: 1 }
      ])
    }))
})

const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1"

layer(Harness.layer({ geoIp: { "203.0.113.7": "DE", "198.51.100.23": "US" } }))("Audience on the date range", (it) => {
  it.effect("countries, browsers, OSes and devices count Pageviews on the Project's local days", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({ timeZone: "America/New_York" })
      // 2026-03-01 in New York runs from 05:00Z to 05:00Z the next day.
      yield* at("2026-03-01T04:59:00Z") // still 2026-02-28 locally: outside the range
      yield* h.ingest(production!.key, [pageview()], { ip: "203.0.113.7", userAgent: CHROME_WINDOWS })
      yield* at("2026-03-01T12:00:00Z")
      yield* h.ingest(production!.key, [pageview(), pageview(), customEvent("signup")], { ip: "203.0.113.7", userAgent: CHROME_WINDOWS })
      yield* at("2026-03-02T04:00:00Z") // still 2026-03-01 locally
      yield* h.ingest(production!.key, [pageview()], { ip: "198.51.100.23", userAgent: SAFARI_IPHONE })
      yield* h.ingest(production!.key, [pageview()], {})

      const rows = (report: "countries" | "browsers" | "oses" | "devices") =>
        h.top(production!.id, report, day).pipe(Effect.map((top) => top.rows))
      assert.deepStrictEqual(yield* rows("countries"), [
        { value: "DE", count: 2 },
        { value: "US", count: 1 },
        { value: null, count: 1 }
      ])
      assert.deepStrictEqual(yield* rows("browsers"), [
        { value: "Chrome", count: 2 },
        { value: "Safari", count: 1 },
        { value: null, count: 1 }
      ])
      assert.deepStrictEqual(yield* rows("oses"), [
        { value: "Windows", count: 2 },
        { value: "iOS", count: 1 },
        { value: null, count: 1 }
      ])
      assert.deepStrictEqual(yield* rows("devices"), [
        { value: "desktop", count: 2 },
        { value: "mobile", count: 1 },
        { value: null, count: 1 }
      ])
      const top = yield* h.top(production!.id, "countries", day)
      assert.deepStrictEqual([top.from, top.to, top.timeZone], ["2026-03-01", "2026-03-01", "America/New_York"])
    }))
})

layer(Harness.layer())("Live counter", (it) => {
  it.effect("counts unique Visitors with an Event in the last 30 minutes", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production, dev] } = yield* h.createProject({ environments: ["dev"] })
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [pageview()], { ip: "198.51.100.1" }) // 31 minutes before "now"
      yield* at("2026-03-01T09:10:00Z")
      yield* h.ingest(production!.key, [pageview(), pageview()], { ip: "198.51.100.2" })
      yield* at("2026-03-01T09:25:00Z")
      yield* h.ingest(production!.key, [customEvent("login_clicked")], { ip: "198.51.100.3" })
      yield* h.ingest(dev!.key, [pageview()], { ip: "198.51.100.4" })
      yield* at("2026-03-01T09:31:00Z")

      assert.strictEqual(yield* h.live(production!.id), 2)
      assert.strictEqual(yield* h.live(dev!.id), 1)

      yield* at("2026-03-01T09:41:00Z")
      assert.strictEqual(yield* h.live(production!.id), 1)
      yield* at("2026-03-01T10:00:00Z")
      assert.strictEqual(yield* h.live(production!.id), 0)
    }))

  it.effect("only Members of the Project can read the reports", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      const password = "outsider-password"
      yield* h.seedMember({ email: "outsider@example.com", password })
      const outsider = yield* h.browser()
      yield* outsider.signIn({ email: "outsider@example.com", password })

      const params = { environmentId: production!.id }
      const live = yield* outsider.client.reports.live({ params, query: {} }).pipe(Effect.flip)
      assert.strictEqual(live._tag, "EnvironmentNotFound")
      const top = yield* outsider.client.reports.top({ params, query: { ...day, report: "pages" } }).pipe(Effect.flip)
      assert.strictEqual(top._tag, "EnvironmentNotFound")
    }))
})
