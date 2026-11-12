import { assert, layer } from "@effect/vitest"
import { EnvironmentId } from "@flock/shared"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { customEvent, Harness, pageview } from "./harness.ts"

const day = (iso: string) => ({ from: `${iso}T00:00:00Z`, to: `${iso}T23:59:59.999Z` })

layer(Harness.layer())("Pageviews", (it) => {
  it.effect("ingest a Pageview, then count it, isolated per Environment", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const project = yield* h.createProject({ environments: ["production", "dev"] })
      const [production, dev] = project.environments

      yield* TestClock.setTime(Date.parse("2026-03-01T10:00:00Z"))
      const result = yield* h.sdk.ingest.send({ payload: { key: dev!.key, events: [pageview()] } })
      assert.deepStrictEqual(result, { accepted: 1, rejected: [] })
      yield* h.sdk.ingest.send({ payload: { key: production!.key, events: [pageview(), pageview()] } })

      const devCount = yield* h.pageviewCount(dev!.id, day("2026-03-01"))
      const productionCount = yield* h.pageviewCount(production!.id, day("2026-03-01"))
      assert.strictEqual(devCount, 1)
      assert.strictEqual(productionCount, 2)
    }))

  it.effect("counts only Pageviews inside the date range", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({ environments: ["production"] })
      const key = production!.key

      yield* TestClock.setTime(Date.parse("2026-03-01T23:59:00Z"))
      yield* h.sdk.ingest.send({ payload: { key, events: [pageview(), customEvent("login_clicked")] } })
      yield* TestClock.setTime(Date.parse("2026-03-02T00:01:00Z"))
      yield* h.sdk.ingest.send({ payload: { key, events: [pageview()] } })

      assert.strictEqual(yield* h.pageviewCount(production!.id, day("2026-03-01")), 1)
      assert.strictEqual(yield* h.pageviewCount(production!.id, day("2026-03-02")), 1)
      assert.strictEqual(
        yield* h.pageviewCount(production!.id, { from: "2026-03-01T00:00:00Z", to: "2026-03-03T00:00:00Z" }),
        2
      )
    }))

  it.effect("stores Pageviews on days long after the server started", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({ environments: ["production"] })
      for (const date of ["2027-01-15", "2027-01-16", "2028-06-30"]) {
        yield* TestClock.setTime(Date.parse(`${date}T12:00:00Z`))
        yield* h.sdk.ingest.send({ payload: { key: production!.key, events: [pageview()] } })
        assert.strictEqual(yield* h.pageviewCount(production!.id, day(date)), 1)
      }
    }))

  it.effect("rejects a batch whose key matches no Environment", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const response = yield* Effect.promise(() =>
        h.fetch("/api/ingest", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key: "pk_dev_doesnotexist", events: [pageview()] })
        })
      )
      assert.strictEqual(response.status, 403)
      const body = (yield* Effect.promise(() => response.json())) as { _tag: string }
      assert.strictEqual(body._tag, "UnknownKey")
    }))

  it.effect("reports 404 for an unknown Environment", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const error = yield* h.pageviewCount(EnvironmentId.make("env_missing"), day("2026-03-01")).pipe(Effect.flip)
      assert.strictEqual((error as { _tag: string })._tag, "EnvironmentNotFound")
    }))

  it.effect("explains why a malformed batch was refused", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const response = yield* Effect.promise(() =>
        h.fetch("/api/ingest", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key: "pk_dev_x", events: { uuid: "not-a-list", name: "$pageview" } })
        })
      )
      assert.strictEqual(response.status, 400)
      const body = (yield* Effect.promise(() => response.json())) as { errors: ReadonlyArray<{ path: string }> }
      assert.isTrue(body.errors.some((e) => JSON.stringify(e).includes("events")))
    }))
})
