import { assert, layer } from "@effect/vitest"
import { Effect } from "effect"
import { Harness } from "./harness.ts"

layer(Harness.layer())("Health", (it) => {
  it.effect("reports the Instance healthy once it can reach Postgres", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const response = yield* Effect.promise(() => h.fetch("/api/health"))
      assert.strictEqual(response.status, 200)
      assert.deepStrictEqual(yield* Effect.promise(() => response.json()), { status: "ok" })
    }))
})
