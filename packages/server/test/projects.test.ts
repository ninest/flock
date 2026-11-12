import { assert, layer } from "@effect/vitest"
import { Effect } from "effect"
import { Harness } from "./harness.ts"

layer(Harness.layer())("Projects", (it) => {
  it.effect("lists seeded Projects with their Environments and keys, production first", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const seeded = yield* h.seedProject({ name: "Blog", timeZone: "Europe/Berlin", environments: ["dev", "production"] })
      const projects = yield* h.client.projects.list()
      const blog = projects.find((p) => p.id === seeded.id)!
      assert.strictEqual(blog.name, "Blog")
      assert.strictEqual(blog.timeZone, "Europe/Berlin")
      assert.deepStrictEqual(blog.environments.map((e) => e.name), ["production", "dev"])
      assert.match(blog.environments[0]!.key, /^pk_production_[A-Za-z0-9]{24}$/)
      assert.match(blog.environments[1]!.key, /^pk_dev_[A-Za-z0-9]{24}$/)
    }))
})
