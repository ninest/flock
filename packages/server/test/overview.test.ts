// Visitors, Sessions and the overview report, observed through the reports API.
import { assert, layer } from "@effect/vitest"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { customEvent, Harness, pageview } from "./harness.ts"

const at = (iso: string) => TestClock.setTime(Date.parse(iso))
const custom = (from: string, to: string) => ({ period: "custom" as const, from, to })

layer(Harness.layer())("Visitors", (it) => {
  it.effect("two Events from the same IP and user agent on the same day are one Visitor", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [pageview()], { ip: "198.51.100.1" })
      yield* at("2026-03-01T18:00:00Z")
      yield* h.ingest(production!.key, [pageview()], { ip: "198.51.100.1" })

      const overview = yield* h.overview(production!.id, custom("2026-03-01", "2026-03-01"))
      assert.strictEqual(overview.totals.visitors, 1)
      assert.strictEqual(overview.totals.pageviews, 2)
    }))

  it.effect("the same IP and user agent on different days are two Visitors (the salt rotates daily)", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* at("2026-03-01T23:50:00Z")
      yield* h.ingest(production!.key, [pageview()], { ip: "198.51.100.1" })
      yield* at("2026-03-02T00:10:00Z")
      yield* h.ingest(production!.key, [pageview()], { ip: "198.51.100.1" })

      const overview = yield* h.overview(production!.id, custom("2026-03-01", "2026-03-02"))
      assert.strictEqual(overview.totals.visitors, 2)
      assert.deepStrictEqual(overview.series.map((b) => [b.bucket, b.visitors]), [["2026-03-01", 1], ["2026-03-02", 1]])
    }))

  it.effect("a different IP or user agent is a different Visitor", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [pageview()], { ip: "198.51.100.1", userAgent: "Agent A" })
      yield* h.ingest(production!.key, [pageview()], { ip: "198.51.100.2", userAgent: "Agent A" })
      yield* h.ingest(production!.key, [pageview()], { ip: "198.51.100.1", userAgent: "Agent B" })
      yield* h.ingest(production!.key, [pageview()], { ip: "198.51.100.1", userAgent: "Agent A" })

      const overview = yield* h.overview(production!.id, custom("2026-03-01", "2026-03-01"))
      assert.strictEqual(overview.totals.visitors, 3)
    }))
})

layer(Harness.layer())("Sessions", (it) => {
  it.effect("Events more than 30 minutes apart fall into separate Sessions", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [pageview()])
      yield* at("2026-03-01T09:31:00Z")
      yield* h.ingest(production!.key, [pageview()])

      const overview = yield* h.overview(production!.id, custom("2026-03-01", "2026-03-01"))
      assert.strictEqual(overview.totals.visitors, 1)
      assert.strictEqual(overview.totals.sessions, 2)
    }))

  it.effect("a Session continues while each Event comes within 30 minutes of the last", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      for (const time of ["09:00", "09:29", "09:58", "10:20"]) {
        yield* at(`2026-03-01T${time}:00Z`)
        yield* h.ingest(production!.key, [pageview()])
      }

      const overview = yield* h.overview(production!.id, custom("2026-03-01", "2026-03-01"))
      assert.strictEqual(overview.totals.sessions, 1)
      assert.strictEqual(overview.totals.visitDuration, 80 * 60)
    }))

  it.effect("each Visitor has their own Sessions", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [pageview()], { ip: "198.51.100.1" })
      yield* h.ingest(production!.key, [pageview()], { ip: "198.51.100.2" })
      yield* at("2026-03-01T09:10:00Z")
      yield* h.ingest(production!.key, [pageview()], { ip: "198.51.100.1" })

      const overview = yield* h.overview(production!.id, custom("2026-03-01", "2026-03-01"))
      assert.strictEqual(overview.totals.sessions, 2)
    }))

  it.effect("bounce rate and visit duration are computed from Sessions", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      // Visitor 1: two Pageviews ten minutes apart (not a bounce, 600 s).
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [pageview()], { ip: "198.51.100.1" })
      yield* at("2026-03-01T09:10:00Z")
      yield* h.ingest(production!.key, [pageview()], { ip: "198.51.100.1" })
      // Visitor 2: one Pageview (a bounce, 0 s).
      yield* h.ingest(production!.key, [pageview()], { ip: "198.51.100.2" })
      // Visitor 3: a Pageview then a Custom event five minutes later (not a bounce, 300 s).
      yield* h.ingest(production!.key, [pageview()], { ip: "198.51.100.3" })
      yield* at("2026-03-01T09:15:00Z")
      yield* h.ingest(production!.key, [customEvent("login_clicked")], { ip: "198.51.100.3" })
      // Visitor 4: one Pageview (a bounce, 0 s).
      yield* h.ingest(production!.key, [pageview()], { ip: "198.51.100.4" })

      const { totals } = yield* h.overview(production!.id, custom("2026-03-01", "2026-03-01"))
      assert.deepStrictEqual(totals, { visitors: 4, pageviews: 5, sessions: 4, bounceRate: 0.5, visitDuration: 225 })
    }))

  it.effect("an Environment with no Sessions has no bounce rate or visit duration", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* at("2026-03-01T09:00:00Z")
      const { totals } = yield* h.overview(production!.id, { period: "today" })
      assert.deepStrictEqual(totals, { visitors: 0, pageviews: 0, sessions: 0, bounceRate: null, visitDuration: null })
    }))
})

layer(Harness.layer())("Overview date ranges", (it) => {
  it.effect("daily buckets follow the Project's time zone", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({ timeZone: "Europe/Berlin" }) // UTC+1 in January
      yield* at("2026-01-10T22:30:00Z") // 23:30 in Berlin: Jan 10
      yield* h.ingest(production!.key, [pageview()], { ip: "198.51.100.1" })
      yield* at("2026-01-10T23:30:00Z") // 00:30 in Berlin: Jan 11
      yield* h.ingest(production!.key, [pageview()], { ip: "198.51.100.2" })

      const overview = yield* h.overview(production!.id, custom("2026-01-10", "2026-01-11"))
      assert.strictEqual(overview.interval, "day")
      assert.deepStrictEqual(overview.series.map((b) => [b.bucket, b.pageviews]), [["2026-01-10", 1], ["2026-01-11", 1]])

      const jan11 = yield* h.overview(production!.id, custom("2026-01-11", "2026-01-11"))
      assert.strictEqual(jan11.totals.pageviews, 1)
    }))

  it.effect("today is the Project's local day, in hourly buckets", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({ timeZone: "Europe/Berlin" })
      yield* at("2026-01-10T22:30:00Z") // still Jan 10 in Berlin
      yield* h.ingest(production!.key, [pageview()])
      yield* at("2026-01-11T08:15:00Z") // Jan 11, 09:15 in Berlin
      yield* h.ingest(production!.key, [pageview(), pageview()])

      const today = yield* h.overview(production!.id, { period: "today" })
      assert.deepStrictEqual({ from: today.from, to: today.to, interval: today.interval }, {
        from: "2026-01-11",
        to: "2026-01-11",
        interval: "hour"
      })
      assert.strictEqual(today.series.length, 24)
      assert.strictEqual(today.series[0]!.bucket, "2026-01-11T00:00")
      assert.deepStrictEqual(
        today.series.filter((b) => b.pageviews > 0).map((b) => [b.bucket, b.pageviews]),
        [["2026-01-11T09:00", 2]]
      )
      assert.strictEqual(today.totals.pageviews, 2)
    }))

  it.effect("7 and 30 days end today and count every Visitor once across the range", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      for (const date of ["2026-02-01", "2026-02-20", "2026-02-25", "2026-03-01"]) {
        yield* at(`${date}T12:00:00Z`)
        yield* h.ingest(production!.key, [pageview()], { ip: "198.51.100.1" })
        yield* h.ingest(production!.key, [pageview()], { ip: "198.51.100.2" })
      }
      yield* at("2026-03-01T13:00:00Z")

      const week = yield* h.overview(production!.id, { period: "7d" })
      assert.deepStrictEqual([week.from, week.to, week.interval, week.series.length], ["2026-02-23", "2026-03-01", "day", 7])
      assert.strictEqual(week.totals.pageviews, 4)
      assert.strictEqual(week.totals.visitors, 4) // a new cookieless Visitor each day
      assert.strictEqual(week.series.find((b) => b.bucket === "2026-02-25")!.visitors, 2)
      assert.strictEqual(week.series.find((b) => b.bucket === "2026-02-24")!.visitors, 0)

      const month = yield* h.overview(production!.id, { period: "30d" })
      assert.deepStrictEqual([month.from, month.to, month.series.length], ["2026-01-31", "2026-03-01", 30])
      assert.strictEqual(month.totals.pageviews, 8)
      assert.strictEqual(month.totals.sessions, 8)
    }))

  it.effect("a custom range of one day uses hourly buckets", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* at("2026-03-01T15:45:00Z")
      yield* h.ingest(production!.key, [pageview()])
      const overview = yield* h.overview(production!.id, custom("2026-03-01", "2026-03-01"))
      assert.strictEqual(overview.interval, "hour")
      assert.strictEqual(overview.series.find((b) => b.pageviews > 0)!.bucket, "2026-03-01T15:00")
    }))

  it.effect("rejects a custom range without dates or ending before it starts", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      for (const query of ["period=custom", "period=custom&from=2026-03-02&to=2026-03-01", "period=custom&from=03/01/2026&to=2026-03-02"]) {
        const response = yield* Effect.promise(() => h.admin.fetch(`/api/environments/${production!.id}/overview?${query}`))
        assert.strictEqual(response.status, 400, query)
      }
    }))

  it.effect("only Members of the Project can read its overview", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* h.seedMember({ email: "stranger@flock.test", password: "stranger-password" })
      const stranger = yield* h.browser()
      yield* stranger.signIn({ email: "stranger@flock.test", password: "stranger-password" })
      const error = yield* stranger.client.reports.overview({ params: { environmentId: production!.id }, query: { period: "today" } })
        .pipe(Effect.flip)
      assert.strictEqual((error as { _tag: string })._tag, "EnvironmentNotFound")
    }))
})
