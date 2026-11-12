import { assert, layer } from "@effect/vitest"
import { Effect } from "effect"
import { Harness } from "./harness.ts"

layer(Harness.layer())("Static files and API docs", (it) => {
  it.effect("serves the dashboard for app routes", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const response = yield* Effect.promise(() => h.fetch("/projects/abc", { headers: { accept: "text/html" } }))
      assert.strictEqual(response.status, 200)
      assert.include(yield* Effect.promise(() => response.text()), `<div id="root">`)
    }))

  it.effect("serves the OpenAPI spec", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const response = yield* Effect.promise(() => h.fetch("/api/openapi.json"))
      assert.strictEqual(response.status, 200)
      const spec = (yield* Effect.promise(() => response.json())) as { paths: object }
      assert.property(spec.paths, "/api/ingest")
    }))

  it.effect("lets any origin send Events (CORS preflight)", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const response = yield* Effect.promise(() =>
        h.fetch("/api/ingest", {
          method: "OPTIONS",
          headers: {
            origin: "http://hel:2102",
            "access-control-request-method": "POST",
            "access-control-request-headers": "content-type"
          }
        })
      )
      assert.isBelow(response.status, 300)
      assert.strictEqual(response.headers.get("access-control-allow-origin"), "*")
    }))
})
