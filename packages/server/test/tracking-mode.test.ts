// Tracking modes and Identify (ADR 0002), observed through the Projects API, ingest and the overview report.
import { assert, layer } from "@effect/vitest"
import type { IngestEvent } from "@flock/shared"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { customEvent, Harness, pageview } from "./harness.ts"

const at = (iso: string) => TestClock.setTime(Date.parse(iso))
const day = (from: string, to = from) => ({ period: "custom" as const, from, to })
const as = (distinctId: string, event: IngestEvent): IngestEvent => ({ ...event, distinct_id: distinctId })
/** What the browser script sends on `identify(id)` from a device with Visitor ID `deviceId`. */
const identify = (id: string, deviceId: string) => as(id, customEvent("$identify", { $anon_distinct_id: deviceId }))

layer(Harness.layer())("Tracking mode setting", (it) => {
  it.effect("a new Project is cookieless, and an owner can switch it to persistent", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const project = yield* h.createProject({})
      assert.strictEqual(project.trackingMode, "cookieless")

      const updated = yield* h.client.projects.update({ params: { projectId: project.id }, payload: { trackingMode: "persistent" } })
      assert.strictEqual(updated.trackingMode, "persistent")
      const reread = yield* h.client.projects.get({ params: { projectId: project.id } })
      assert.strictEqual(reread.trackingMode, "persistent")
    }))

  it.effect("the browser script can read a Project's Tracking mode with the Environment's public key", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const project = yield* h.createProject({ environments: ["dev"] })
      yield* h.client.projects.update({ params: { projectId: project.id }, payload: { trackingMode: "persistent" } })
      const config = yield* Effect.promise(() => h.fetch(`/api/ingest/config?key=${project.environments[1]!.key}`).then((r) => r.json()))
      assert.deepStrictEqual(config, { trackingMode: "persistent" })
      const unknown = yield* Effect.promise(() => h.fetch(`/api/ingest/config?key=pk_nope`))
      assert.strictEqual(unknown.status, 403)
    }))
})

layer(Harness.layer())("Persistent Tracking mode", (it) => {
  const persistentProject = Effect.gen(function*() {
    const h = yield* Harness
    const project = yield* h.createProject({})
    yield* h.client.projects.update({ params: { projectId: project.id }, payload: { trackingMode: "persistent" } })
    return project.environments[0]!
  })

  it.effect("the same device is one Visitor across days, even when its IP changes", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const production = yield* persistentProject
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production.key, [as("device-1", pageview())], { ip: "198.51.100.1" })
      yield* at("2026-03-03T09:00:00Z")
      yield* h.ingest(production.key, [as("device-1", pageview())], { ip: "203.0.113.9" })
      yield* h.ingest(production.key, [as("device-2", pageview())], { ip: "203.0.113.9" })

      const overview = yield* h.overview(production.id, day("2026-03-01", "2026-03-03"))
      assert.strictEqual(overview.totals.visitors, 2)
      assert.deepStrictEqual(overview.series.map((b) => b.visitors), [1, 0, 2])
    }))

  it.effect("after Identify, two devices identified as the same ID count as one Visitor", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const production = yield* persistentProject
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production.key, [as("laptop", pageview()), identify("test-user", "laptop")])
      yield* h.ingest(production.key, [as("test-user", pageview())])
      yield* at("2026-03-01T12:00:00Z")
      yield* h.ingest(production.key, [as("phone", pageview()), identify("test-user", "phone"), as("test-user", pageview())], {
        ip: "203.0.113.9"
      })

      const overview = yield* h.overview(production.id, day("2026-03-01"))
      assert.strictEqual(overview.totals.visitors, 1)
      assert.strictEqual(overview.totals.pageviews, 4)
    }))

  it.effect("Events still sent with an identified device's own ID are attributed to the identified Visitor", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const production = yield* persistentProject
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production.key, [identify("test-user", "laptop")])
      yield* h.ingest(production.key, [as("laptop", pageview())]) // e.g. another tab opened before identify
      yield* h.ingest(production.key, [as("test-user", pageview())], { ip: "203.0.113.9" })

      const overview = yield* h.overview(production.id, day("2026-03-01"))
      assert.strictEqual(overview.totals.visitors, 1)
    }))

  it.effect("Events without a Visitor ID (such as from a backend) fall back to the cookieless Visitor", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const production = yield* persistentProject
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production.key, [pageview(), pageview()], { ip: "198.51.100.1" })
      yield* h.ingest(production.key, [pageview()], { ip: "198.51.100.2" })

      const overview = yield* h.overview(production.id, day("2026-03-01"))
      assert.strictEqual(overview.totals.visitors, 2)
    }))
})

layer(Harness.layer())("Cookieless Tracking mode", (it) => {
  it.effect("ignores client-sent Visitor IDs and Identify", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [as("device-1", pageview()), identify("test-user", "device-1")], { ip: "198.51.100.1" })
      yield* h.ingest(production!.key, [as("test-user", pageview())], { ip: "198.51.100.2" })

      const overview = yield* h.overview(production!.id, day("2026-03-01"))
      assert.strictEqual(overview.totals.visitors, 2)
    }))

  it.effect("switching the Tracking mode starts Visitor counts afresh", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const project = yield* h.createProject({})
      const production = project.environments[0]!
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production.key, [as("device-1", pageview())], { ip: "198.51.100.1" })
      yield* h.client.projects.update({ params: { projectId: project.id }, payload: { trackingMode: "persistent" } })
      yield* at("2026-03-01T10:00:00Z")
      yield* h.ingest(production.key, [as("device-1", pageview())], { ip: "198.51.100.1" })

      // The same device counts once per Tracking mode: its two Visitor IDs can't be compared.
      const overview = yield* h.overview(production.id, day("2026-03-01"))
      assert.strictEqual(overview.totals.visitors, 2)
    }))
})
