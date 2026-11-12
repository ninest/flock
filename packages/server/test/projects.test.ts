import { assert, layer } from "@effect/vitest"
import { DateTime, Effect } from "effect"
import { TestClock } from "effect/testing"
import { type Browser, Harness, pageview } from "./harness.ts"

layer(Harness.layer())("Projects", (it) => {
  it.effect("creating a Project creates its production Environment and key, and the creator sees it", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const created = yield* h.client.projects.create({ payload: { name: "Blog", timeZone: "Europe/Berlin" } })
      assert.strictEqual(created.name, "Blog")
      assert.strictEqual(created.timeZone, "Europe/Berlin")
      assert.strictEqual(created.role, "owner")
      assert.deepStrictEqual(created.environments.map((e) => e.name), ["production"])
      assert.match(created.environments[0]!.key, /^pk_production_[A-Za-z0-9]{24}$/)

      const listed = (yield* h.client.projects.list()).find((p) => p.id === created.id)
      assert.deepStrictEqual(listed, created)
      assert.deepStrictEqual(yield* h.client.projects.get({ params: { projectId: created.id } }), created)
    }))
})

const allTime = { from: "2026-01-01T00:00:00Z", to: "2027-01-01T00:00:00Z" }

const status = (path: string, init: RequestInit & { as: Browser }) =>
  Effect.promise(() => init.as.fetch(path, init)).pipe(Effect.map((r) => r.status))

layer(Harness.layer())("Environments", (it) => {
  it.effect("adding an Environment named dev yields a pk_dev_ key, listed after production", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const project = yield* h.client.projects.create({ payload: { name: "App", timeZone: "UTC" } })
      const dev = yield* h.client.projects.addEnvironment({ params: { projectId: project.id }, payload: { name: "dev" } })
      assert.strictEqual(dev.name, "dev")
      assert.match(dev.key, /^pk_dev_[A-Za-z0-9]{24}$/)
      yield* h.client.projects.addEnvironment({ params: { projectId: project.id }, payload: { name: "staging" } })

      const reloaded = yield* h.client.projects.get({ params: { projectId: project.id } })
      assert.deepStrictEqual(reloaded.environments.map((e) => e.name), ["production", "dev", "staging"])
    }))

  it.effect("refuses a duplicate or malformed Environment name", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const project = yield* h.createProject({ environments: ["dev"] })
      const taken = yield* h.client.projects.addEnvironment({ params: { projectId: project.id }, payload: { name: "dev" } }).pipe(Effect.flip)
      assert.strictEqual(taken._tag, "EnvironmentNameTaken")

      for (const name of ["Dev", "my_env", "", "1st"]) {
        const response = yield* Effect.promise(() =>
          h.admin.fetch(`/api/projects/${project.id}/environments`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name })
          })
        )
        assert.strictEqual(response.status, 400, name)
      }
    }))

  it.effect("production can't be deleted; another Environment can, with its key", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production, dev] } = yield* h.createProject({ environments: ["dev"] })

      const refused = yield* h.client.environments.delete({ params: { environmentId: production!.id } }).pipe(Effect.flip)
      assert.strictEqual(refused._tag, "ProductionProtected")

      yield* h.client.environments.delete({ params: { environmentId: dev!.id } })
      const result = yield* h.client.ingest.send({ payload: { key: dev!.key, events: [pageview()] } }).pipe(Effect.flip)
      assert.strictEqual(result._tag, "UnknownKey")
      const project = (yield* h.client.projects.list()).find((p) => p.environments.some((e) => e.id === production!.id))!
      assert.deepStrictEqual(project.environments.map((e) => e.name), ["production"])
    }))

  it.effect("rotating a key makes the old key stop being accepted at ingest", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* TestClock.setTime(Date.parse("2026-03-01T10:00:00Z"))

      const rotated = yield* h.client.environments.rotateKey({ params: { environmentId: production!.id } })
      assert.strictEqual(rotated.id, production!.id)
      assert.match(rotated.key, /^pk_production_[A-Za-z0-9]{24}$/)
      assert.notStrictEqual(rotated.key, production!.key)

      const old = yield* h.client.ingest.send({ payload: { key: production!.key, events: [pageview()] } }).pipe(Effect.flip)
      assert.strictEqual(old._tag, "UnknownKey")
      assert.deepStrictEqual(
        yield* h.client.ingest.send({ payload: { key: rotated.key, events: [pageview()] } }),
        { accepted: 1, rejected: [] }
      )
      assert.strictEqual(yield* h.pageviewCount(production!.id, allTime), 1)
    }))

  it.effect("Delete all Events empties a non-production Environment and leaves the others untouched", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production, dev, staging] } = yield* h.createProject({ environments: ["dev", "staging"] })
      const other = yield* h.createProject({ environments: ["dev"] })
      yield* TestClock.setTime(Date.parse("2026-03-01T10:00:00Z"))
      for (const env of [production!, dev!, staging!, other.environments[1]!]) {
        yield* h.client.ingest.send({ payload: { key: env.key, events: [pageview(), pageview()] } })
      }

      yield* h.client.environments.deleteEvents({ params: { environmentId: dev!.id } })

      assert.strictEqual(yield* h.pageviewCount(dev!.id, allTime), 0)
      assert.strictEqual(yield* h.pageviewCount(production!.id, allTime), 2)
      assert.strictEqual(yield* h.pageviewCount(staging!.id, allTime), 2)
      assert.strictEqual(yield* h.pageviewCount(other.environments[1]!.id, allTime), 2)
      // The Environment and its key keep working.
      yield* h.client.ingest.send({ payload: { key: dev!.key, events: [pageview()] } })
      assert.strictEqual(yield* h.pageviewCount(dev!.id, allTime), 1)
    }))

  it.effect("Delete all Events is unavailable for production", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* TestClock.setTime(Date.parse("2026-03-01T10:00:00Z"))
      yield* h.client.ingest.send({ payload: { key: production!.key, events: [pageview()] } })

      const refused = yield* h.client.environments.deleteEvents({ params: { environmentId: production!.id } }).pipe(Effect.flip)
      assert.strictEqual(refused._tag, "ProductionProtected")
      assert.strictEqual(yield* h.pageviewCount(production!.id, allTime), 1)
    }))
})

layer(Harness.layer())("Project settings and deletion", (it) => {
  it.effect("the time zone can be set, and must be a real time zone", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const project = yield* h.createProject({ name: "Shop", timeZone: "UTC" })
      const updated = yield* h.client.projects.update({ params: { projectId: project.id }, payload: { timeZone: "America/New_York" } })
      assert.strictEqual(updated.timeZone, "America/New_York")
      assert.strictEqual(updated.name, "Shop")
      assert.strictEqual((yield* h.client.projects.get({ params: { projectId: project.id } })).timeZone, "America/New_York")

      const renamed = yield* h.client.projects.update({ params: { projectId: project.id }, payload: { name: "Store" } })
      assert.strictEqual(renamed.name, "Store")
      assert.strictEqual(renamed.timeZone, "America/New_York")

      for (const body of [{ timeZone: "Mars/Olympus_Mons" }, { name: "" }]) {
        const response = yield* Effect.promise(() =>
          h.admin.fetch(`/api/projects/${project.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body)
          })
        )
        assert.strictEqual(response.status, 400, JSON.stringify(body))
      }
      const created = yield* Effect.promise(() =>
        h.admin.fetch("/api/projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Bad", timeZone: "Not/AZone" })
        })
      )
      assert.strictEqual(created.status, 400)
    }))

  it.effect("deleting a Project removes its Environments and Events", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const project = yield* h.createProject({ environments: ["dev"] })
      const kept = yield* h.createProject({})
      yield* TestClock.setTime(Date.parse("2026-03-01T10:00:00Z"))
      for (const env of [...project.environments, ...kept.environments]) {
        yield* h.client.ingest.send({ payload: { key: env.key, events: [pageview()] } })
      }

      yield* h.client.projects.delete({ params: { projectId: project.id } })

      const gone = yield* h.client.projects.get({ params: { projectId: project.id } }).pipe(Effect.flip)
      assert.strictEqual(gone._tag, "ProjectNotFound")
      assert.isFalse((yield* h.client.projects.list()).some((p) => p.id === project.id))
      for (const env of project.environments) {
        const ingest = yield* h.client.ingest.send({ payload: { key: env.key, events: [pageview()] } }).pipe(Effect.flip)
        assert.strictEqual(ingest._tag, "UnknownKey")
        const report = yield* h.pageviewCount(env.id, allTime).pipe(Effect.flip)
        assert.strictEqual((report as { _tag: string })._tag, "EnvironmentNotFound")
      }
      assert.strictEqual(yield* h.pageviewCount(kept.environments[0]!.id, allTime), 1)
    }))
})

layer(Harness.layer())("Project access", (it) => {
  it.effect("a Member can't see, query or change another Member's Project", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      yield* h.seedMember({ email: "alice@example.com", password: "alice-password" })
      yield* h.seedMember({ email: "bob@example.com", password: "bob-password" })
      const alice = yield* h.browser()
      yield* alice.signIn({ email: "alice@example.com", password: "alice-password" })
      const bob = yield* h.browser()
      yield* bob.signIn({ email: "bob@example.com", password: "bob-password" })

      const project = yield* h.createProject({ name: "Alice's site", environments: ["dev"], as: alice })
      const [production, dev] = project.environments
      yield* TestClock.setTime(Date.parse("2026-03-01T10:00:00Z"))
      yield* bob.client.ingest.send({ payload: { key: production!.key, events: [pageview()] } })

      assert.deepStrictEqual((yield* alice.client.projects.list()).map((p) => p.name), ["Alice's site"])
      assert.deepStrictEqual(yield* bob.client.projects.list(), [])

      const projectId = project.id
      const environmentId = production!.id
      const notFound = [
        yield* bob.client.projects.get({ params: { projectId } }).pipe(Effect.flip),
        yield* bob.client.projects.update({ params: { projectId }, payload: { name: "Mine" } }).pipe(Effect.flip),
        yield* bob.client.projects.addEnvironment({ params: { projectId }, payload: { name: "bob" } }).pipe(Effect.flip),
        yield* bob.client.projects.delete({ params: { projectId } }).pipe(Effect.flip),
        yield* bob.client.environments.rotateKey({ params: { environmentId } }).pipe(Effect.flip),
        yield* bob.client.environments.delete({ params: { environmentId: dev!.id } }).pipe(Effect.flip),
        yield* bob.client.environments.deleteEvents({ params: { environmentId: dev!.id } }).pipe(Effect.flip),
        yield* bob.client.reports.pageviewCount({
          params: { environmentId },
          query: { from: DateTime.makeUnsafe(allTime.from), to: DateTime.makeUnsafe(allTime.to) }
        }).pipe(Effect.flip)
      ].map((e) => e._tag)
      assert.deepStrictEqual(notFound, [
        "ProjectNotFound",
        "ProjectNotFound",
        "ProjectNotFound",
        "ProjectNotFound",
        "EnvironmentNotFound",
        "EnvironmentNotFound",
        "EnvironmentNotFound",
        "EnvironmentNotFound"
      ])

      // Nothing changed for Alice.
      const after = yield* alice.client.projects.get({ params: { projectId } })
      assert.deepStrictEqual(after, project)
      const count = yield* alice.client.reports.pageviewCount({
        params: { environmentId },
        query: { from: DateTime.makeUnsafe(allTime.from), to: DateTime.makeUnsafe(allTime.to) }
      })
      assert.strictEqual(count.pageviews, 1)
      // The Instance admin is no exception.
      assert.isFalse((yield* h.client.projects.list()).some((p) => p.id === projectId))
    }))

  it.effect("the Projects and Environments API needs a signed-in Member", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      const anonymous = yield* h.browser()
      for (
        const [method, path] of [
          ["POST", "/api/projects"],
          ["POST", `/api/environments/${production!.id}/rotate-key`],
          ["DELETE", `/api/environments/${production!.id}/events`]
        ] as const
      ) {
        assert.strictEqual(
          yield* status(path, { method, headers: { "content-type": "application/json" }, body: method === "POST" ? "{}" : null, as: anonymous }),
          401,
          path
        )
      }
    }))
})
