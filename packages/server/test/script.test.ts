import { assert, layer } from "@effect/vitest"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { readFileSync } from "node:fs"
import { Harness, pageview, scriptFile } from "./harness.ts"

layer(Harness.layer())("Browser script", (it) => {
  it.effect("serves the built script at /flock.js", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const response = yield* Effect.promise(() => h.fetch("/flock.js"))
      assert.strictEqual(response.status, 200)
      assert.match(response.headers.get("content-type") ?? "", /javascript/)
      assert.strictEqual(yield* Effect.promise(() => response.text()), readFileSync(scriptFile, "utf8"))
    }))

  it.effect("accepts a batch sent as text/plain, the way sendBeacon sends it", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({ environments: ["production"] })
      yield* TestClock.setTime(Date.parse("2026-03-01T10:00:00Z"))
      const response = yield* Effect.promise(() =>
        h.fetch("/api/ingest", {
          method: "POST",
          headers: { "content-type": "text/plain;charset=UTF-8", origin: "http://hel:2102" },
          body: JSON.stringify({ key: production!.key, events: [pageview()] })
        })
      )
      assert.strictEqual(response.status, 200)
      assert.deepStrictEqual(yield* Effect.promise(() => response.json()), { accepted: 1, rejected: [] })
      assert.strictEqual(response.headers.get("access-control-allow-origin"), "*")
      const count = yield* h.pageviewCount(production!.id, { from: "2026-03-01T00:00:00Z", to: "2026-03-02T00:00:00Z" })
      assert.strictEqual(count, 1)
    }))
})
