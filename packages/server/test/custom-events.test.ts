// Custom events: the list, the drill-down over time, property breakdowns and numeric
// statistics, observed through the custom events API.
import { assert, layer } from "@effect/vitest"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import type { EnvironmentId, ReportRangeQuery } from "@flock/shared"
import { customEvent, Harness, pageview } from "./harness.ts"

const at = (iso: string) => TestClock.setTime(Date.parse(iso))
const custom = (from: string, to: string) => ({ period: "custom" as const, from, to })
const day = custom("2026-03-01", "2026-03-01")

type H = Harness["Service"]
const listEvents = (h: H, environmentId: EnvironmentId, range: ReportRangeQuery) =>
  h.client.customEvents.list({ params: { environmentId }, query: range }).pipe(Effect.orDie)

layer(Harness.layer())("Custom event list", (it) => {
  it.effect("lists every Custom event name sent in the range with its count and unique Visitors", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [pageview(), customEvent("signup"), customEvent("game_completed")], { ip: "198.51.100.1" })
      yield* h.ingest(production!.key, [customEvent("game_completed"), customEvent("game_completed")], { ip: "198.51.100.2" })
      yield* at("2026-03-02T09:00:00Z")
      yield* h.ingest(production!.key, [customEvent("outside_range")], { ip: "198.51.100.1" })

      const { events } = yield* listEvents(h, production!.id, day)
      assert.deepStrictEqual(events, [
        { name: "game_completed", count: 3, visitors: 2 },
        { name: "signup", count: 1, visitors: 1 }
      ])
    }))

  it.effect("leaves Built-in events out", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* at("2026-03-01T09:00:00Z")
      // `$pageview` and `$identify` are the Built-in events clients may send; other `$` names are rejected at ingest.
      const identify = { ...customEvent("$identify", { $anon_distinct_id: "device-1" }), distinct_id: "test-user" }
      const result = yield* h.ingest(production!.key, [pageview(), pageview({ $url: "https://example.com/pricing" }), identify])
      assert.strictEqual(result.accepted, 3)
      const { events } = yield* listEvents(h, production!.id, day)
      assert.deepStrictEqual(events, [])
    }))

  it.effect("only Members of the Project can list its Custom events", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* h.seedMember({ email: "stranger@flock.test", password: "stranger-password" })
      const stranger = yield* h.browser()
      yield* stranger.signIn({ email: "stranger@flock.test", password: "stranger-password" })
      const error = yield* stranger.client.customEvents.list({ params: { environmentId: production!.id }, query: { period: "today" } })
        .pipe(Effect.flip)
      assert.strictEqual((error as { _tag: string })._tag, "EnvironmentNotFound")
    }))
})

const detail = (h: H, environmentId: EnvironmentId, name: string, range: ReportRangeQuery) =>
  h.client.customEvents.detail({ params: { environmentId }, query: { ...range, name } }).pipe(Effect.orDie)
const breakdown = (h: H, environmentId: EnvironmentId, name: string, property: string, range: ReportRangeQuery) =>
  h.client.customEvents.breakdown({ params: { environmentId }, query: { ...range, name, property } }).pipe(Effect.orDie)
const stats = (h: H, environmentId: EnvironmentId, name: string, property: string, range: ReportRangeQuery) =>
  h.client.customEvents.stats({ params: { environmentId }, query: { ...range, name, property } }).pipe(Effect.orDie)

const gameCompleted = (properties: Record<string, unknown>) => customEvent("game_completed", properties)

layer(Harness.layer())("Custom event drill-down", (it) => {
  it.effect("shows the count and unique Visitors over time", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [gameCompleted({}), gameCompleted({}), customEvent("signup")], { ip: "198.51.100.1" })
      yield* h.ingest(production!.key, [gameCompleted({})], { ip: "198.51.100.2" })
      yield* at("2026-03-03T09:00:00Z")
      yield* h.ingest(production!.key, [gameCompleted({})], { ip: "198.51.100.1" })

      const report = yield* detail(h, production!.id, "game_completed", custom("2026-03-01", "2026-03-03"))
      assert.strictEqual(report.interval, "day")
      assert.deepStrictEqual(report.totals, { count: 4, visitors: 3 }) // a new cookieless Visitor each day
      assert.deepStrictEqual(report.series, [
        { bucket: "2026-03-01", count: 3, visitors: 2 },
        { bucket: "2026-03-02", count: 0, visitors: 0 },
        { bucket: "2026-03-03", count: 1, visitors: 1 }
      ])
    }))

  it.effect("lists its Event properties with the types they were sent with", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [
        gameCompleted({ score: 34, level: "easy", won: true }),
        gameCompleted({ score: "n/a", level: "hard", won: false }),
        customEvent("signup", { plan: "pro" })
      ])

      const report = yield* detail(h, production!.id, "game_completed", day)
      assert.deepStrictEqual(report.properties, [
        { key: "level", types: ["string"] },
        { key: "score", types: ["number", "string"] },
        { key: "won", types: ["boolean"] }
      ])
    }))

  it.effect("breaks the Custom event down by a string or boolean Event property", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [
        gameCompleted({ level: "easy", won: true }),
        gameCompleted({ level: "hard", won: false }),
        gameCompleted({ level: "easy", won: true }),
        gameCompleted({}),
        customEvent("signup", { level: "hard" })
      ])

      const byLevel = yield* breakdown(h, production!.id, "game_completed", "level", day)
      assert.deepStrictEqual(byLevel.rows, [
        { value: "easy", count: 2 },
        { value: "hard", count: 1 },
        { value: null, count: 1 }
      ])
      const byWon = yield* breakdown(h, production!.id, "game_completed", "won", day)
      assert.deepStrictEqual(byWon.rows, [
        { value: "true", count: 2 },
        { value: "false", count: 1 },
        { value: null, count: 1 }
      ])
    }))

  it.effect("shows average, sum, min, max and median of a numeric Event property over time", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [gameCompleted({ score: 10 }), gameCompleted({ score: 40 }), gameCompleted({ score: 25 })])
      yield* at("2026-03-02T09:00:00Z")
      yield* h.ingest(production!.key, [gameCompleted({ score: 5 }), gameCompleted({ score: 7.5 })])

      const report = yield* stats(h, production!.id, "game_completed", "score", custom("2026-03-01", "2026-03-03"))
      assert.deepStrictEqual(report.totals, { count: 5, average: 17.5, sum: 87.5, min: 5, max: 40, median: 10 })
      assert.deepStrictEqual(report.series, [
        { bucket: "2026-03-01", count: 3, average: 25, sum: 75, min: 10, max: 40, median: 25 },
        { bucket: "2026-03-02", count: 2, average: 6.25, sum: 12.5, min: 5, max: 7.5, median: 6.25 },
        { bucket: "2026-03-03", count: 0, average: null, sum: null, min: null, max: null, median: null }
      ])
    }))

  it.effect("counts only numeric values of a property sent with mixed types", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [
        gameCompleted({ score: 10 }),
        gameCompleted({ score: "20" }),
        gameCompleted({ score: true }),
        gameCompleted({ score: null }),
        gameCompleted({ score: [1, 2] }),
        gameCompleted({}),
        gameCompleted({ score: 30 })
      ])

      const { totals } = yield* stats(h, production!.id, "game_completed", "score", day)
      assert.deepStrictEqual(totals, { count: 2, average: 20, sum: 40, min: 10, max: 30, median: 20 })
    }))

  it.effect("a property with no numeric values has no statistics", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [gameCompleted({ level: "easy" })])
      const { totals } = yield* stats(h, production!.id, "game_completed", "level", day)
      assert.deepStrictEqual(totals, { count: 0, average: null, sum: null, min: null, max: null, median: null })
    }))
})
