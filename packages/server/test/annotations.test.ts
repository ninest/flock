// Annotations: owners add and delete short dated notes on a Project; the overview carries the
// ones in its range for the Environment, whatever the Filters.
import { assert, layer } from "@effect/vitest"
import { DateTime, Effect } from "effect"
import { TestClock } from "effect/testing"
import { Harness } from "./harness.ts"

const at = (iso: string) => TestClock.setTime(Date.parse(iso))

/** Seeds a Member and returns their browser, signed in. */
const signedIn = (email: string) =>
  Effect.gen(function*() {
    const h = yield* Harness
    const password = `${email}-password`
    yield* h.seedMember({ email, password })
    const browser = yield* h.browser()
    yield* browser.signIn({ email, password })
    return browser
  })

layer(Harness.layer())("Annotations", (it) => {
  it.effect("an owner adds an Annotation, timed now by default, and it shows on the overview", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const project = yield* h.createProject({ timeZone: "Europe/Berlin" })
      const [production] = project.environments
      yield* at("2026-03-01T10:15:42Z")

      const created = yield* h.client.annotations.create({
        params: { projectId: project.id },
        payload: { label: "Launched on Hacker News", description: "https://news.ycombinator.com/item?id=1" }
      })
      const me = yield* h.client.members.me()
      assert.deepStrictEqual(
        {
          label: created.label,
          description: created.description,
          at: DateTime.formatIso(created.at),
          environments: created.environments,
          createdBy: created.createdBy,
          createdAt: DateTime.formatIso(created.createdAt)
        },
        {
          label: "Launched on Hacker News",
          description: "https://news.ycombinator.com/item?id=1",
          at: "2026-03-01T10:15:00.000Z",
          environments: "all",
          createdBy: { id: me.id, name: me.name, email: me.email },
          createdAt: "2026-03-01T10:15:42.000Z"
        }
      )

      const overview = yield* h.overview(production!.id, { period: "today" })
      assert.deepStrictEqual(overview.annotations, [created])
    }))

  it.effect("a viewer sees Annotations but gets Forbidden for adding or deleting one", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const project = yield* h.createProject({})
      const projectId = project.id
      const viewer = yield* signedIn("vera@example.com")
      yield* h.client.projects.addMember({ params: { projectId }, payload: { email: "vera@example.com", role: "viewer" } })
      yield* at("2026-03-01T10:00:00Z")
      const launch = yield* h.client.annotations.create({ params: { projectId }, payload: { label: "Launch" } })

      const refused = yield* viewer.client.annotations.create({ params: { projectId }, payload: { label: "Mine" } }).pipe(Effect.flip)
      assert.strictEqual(refused._tag, "ProjectOwnerRequired")
      const notDeleted = yield* viewer.client.annotations.delete({ params: { projectId, annotationId: launch.id } }).pipe(Effect.flip)
      assert.strictEqual(notDeleted._tag, "ProjectOwnerRequired")

      const overview = yield* viewer.client.reports.overview({
        params: { environmentId: project.environments[0]!.id },
        query: { period: "today" }
      })
      assert.deepStrictEqual(overview.annotations.map((a) => a.label), ["Launch"])
    }))

  it.effect("an owner deletes an Annotation; deleting it again, or from another Project, is not found", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const project = yield* h.createProject({})
      const other = yield* h.createProject({})
      yield* at("2026-03-01T10:00:00Z")
      const launch = yield* h.client.annotations.create({ params: { projectId: project.id }, payload: { label: "Launch" } })

      const elsewhere = yield* h.client.annotations.delete({ params: { projectId: other.id, annotationId: launch.id } }).pipe(Effect.flip)
      assert.strictEqual(elsewhere._tag, "AnnotationNotFound")
      yield* h.client.annotations.delete({ params: { projectId: project.id, annotationId: launch.id } })
      const again = yield* h.client.annotations.delete({ params: { projectId: project.id, annotationId: launch.id } }).pipe(Effect.flip)
      assert.strictEqual(again._tag, "AnnotationNotFound")

      const overview = yield* h.overview(project.environments[0]!.id, { period: "today" })
      assert.deepStrictEqual(overview.annotations, [])
    }))

  it.effect("the label is required and up to 100 characters; the description up to 1,000; an empty description is none", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const project = yield* h.createProject({})
      const post = (body: unknown) =>
        Effect.promise(() =>
          h.admin.fetch(`/api/projects/${project.id}/annotations`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body)
          }).then((r) => r.status)
        )
      assert.strictEqual(yield* post({}), 400)
      assert.strictEqual(yield* post({ label: "" }), 400)
      assert.strictEqual(yield* post({ label: "x".repeat(101) }), 400)
      assert.strictEqual(yield* post({ label: "Launch", description: "x".repeat(1001) }), 400)
      assert.strictEqual(yield* post({ label: "x".repeat(100), description: "x".repeat(1000) }), 200)

      const plain = yield* h.client.annotations.create({ params: { projectId: project.id }, payload: { label: "Plain", description: "" } })
      assert.isNull(plain.description)
    }))

  it.effect("the overview carries only the Annotations in its local range, whatever the Filters", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const project = yield* h.createProject({ timeZone: "America/New_York" })
      const [production] = project.environments
      const projectId = project.id
      const add = (label: string, iso: string) =>
        h.client.annotations.create({ params: { projectId }, payload: { label, at: DateTime.makeUnsafe(iso) } })
      yield* at("2026-03-10T15:00:00Z")
      // 2026-03-02 local starts at 05:00Z; 2026-03-10 local ends at 2026-03-11T04:00Z (after the DST change).
      yield* add("Before", "2026-03-02T04:59:00Z")
      yield* add("First day", "2026-03-02T05:00:00Z")
      yield* add("Late on the last day", "2026-03-11T03:59:00Z")
      yield* add("After", "2026-03-11T04:00:00Z")
      yield* add("Earlier today", "2026-03-10T14:00:00Z")

      const labels = (query: Parameters<typeof h.overview>[1]) =>
        h.overview(production!.id, query).pipe(Effect.map((o) => o.annotations.map((a) => a.label)))
      const custom = { period: "custom" as const, from: "2026-03-02", to: "2026-03-10" }
      assert.deepStrictEqual(yield* labels(custom), ["First day", "Earlier today", "Late on the last day"])
      assert.deepStrictEqual(yield* labels({ period: "today" }), ["Earlier today", "Late on the last day"])
      assert.deepStrictEqual(
        yield* labels({ ...custom, filters: [{ eventProperty: "$path", op: "is", value: "/nothing-matches" }] }),
        ["First day", "Earlier today", "Late on the last day"]
      )
    }))

  it.effect("an Annotation for all Environments also shows on an Environment added later", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const project = yield* h.createProject({})
      yield* at("2026-03-01T10:00:00Z")
      yield* h.client.annotations.create({ params: { projectId: project.id }, payload: { label: "Launch" } })

      const staging = yield* h.client.projects.addEnvironment({ params: { projectId: project.id }, payload: { name: "staging" } })
      const overview = yield* h.overview(staging.id, { period: "today" })
      assert.deepStrictEqual(overview.annotations.map((a) => a.label), ["Launch"])
    }))

  it.effect("deleting the Project deletes its Annotations", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const project = yield* h.createProject({})
      yield* at("2026-03-01T10:00:00Z")
      const launch = yield* h.client.annotations.create({ params: { projectId: project.id }, payload: { label: "Launch" } })

      yield* h.client.projects.delete({ params: { projectId: project.id } })
      const gone = yield* h.client.annotations.delete({ params: { projectId: project.id, annotationId: launch.id } }).pipe(Effect.flip)
      assert.strictEqual(gone._tag, "ProjectNotFound")
    }))
})

layer(Harness.layer())("Annotations narrowed to Environments", (it) => {
  it.effect("an Annotation narrowed to dev shows only on dev, not on production or an Environment added later", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const project = yield* h.createProject({ environments: ["production", "dev"] })
      const production = project.environments.find((e) => e.name === "production")!
      const dev = project.environments.find((e) => e.name === "dev")!
      yield* at("2026-03-01T10:00:00Z")

      const test = yield* h.client.annotations.create({
        params: { projectId: project.id },
        payload: { label: "Testing the new header", environments: [dev.id] }
      })
      assert.deepStrictEqual(test.environments, [dev.id])

      const staging = yield* h.client.projects.addEnvironment({ params: { projectId: project.id }, payload: { name: "staging" } })
      const labels = (environmentId: typeof dev.id) =>
        h.overview(environmentId, { period: "today" }).pipe(Effect.map((o) => o.annotations.map((a) => a.label)))
      assert.deepStrictEqual(yield* labels(dev.id), ["Testing the new header"])
      assert.deepStrictEqual(yield* labels(production.id), [])
      assert.deepStrictEqual(yield* labels(staging.id), [])
    }))

  it.effect("an empty choice of Environments, or one from another Project, is refused", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const project = yield* h.createProject({ environments: ["production", "dev"] })
      const other = yield* h.createProject({})
      const post = (body: unknown) =>
        Effect.promise(() =>
          h.admin.fetch(`/api/projects/${project.id}/annotations`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body)
          }).then((r) => r.status)
        )
      assert.strictEqual(yield* post({ label: "Nowhere", environments: [] }), 400)
      assert.strictEqual(yield* post({ label: "Somewhere", environments: "some" }), 400)
      const foreign = yield* h.client.annotations.create({
        params: { projectId: project.id },
        payload: { label: "Elsewhere", environments: [other.environments[0]!.id] }
      }).pipe(Effect.flip)
      assert.strictEqual(foreign._tag, "EnvironmentNotFound")
      assert.deepStrictEqual(yield* h.client.annotations.list({ params: { projectId: project.id } }), [])
    }))

  it.effect("an owner edits the label, description, time and Environments; an empty choice is refused", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const project = yield* h.createProject({ environments: ["production", "dev"] })
      const projectId = project.id
      const production = project.environments.find((e) => e.name === "production")!
      const dev = project.environments.find((e) => e.name === "dev")!
      yield* at("2026-03-01T10:00:00Z")
      const launch = yield* h.client.annotations.create({ params: { projectId }, payload: { label: "Lanch", description: "typo" } })
      const annotationId = launch.id

      const narrowed = yield* h.client.annotations.update({
        params: { projectId, annotationId },
        payload: { label: "Launch", description: "", at: DateTime.makeUnsafe("2026-03-01T08:30:59Z"), environments: [dev.id] }
      })
      assert.deepStrictEqual(
        { label: narrowed.label, description: narrowed.description, at: DateTime.formatIso(narrowed.at), environments: narrowed.environments },
        { label: "Launch", description: null, at: "2026-03-01T08:30:00.000Z", environments: [dev.id] }
      )
      const labels = (environmentId: typeof dev.id) =>
        h.overview(environmentId, { period: "today" }).pipe(Effect.map((o) => o.annotations.map((a) => a.label)))
      assert.deepStrictEqual(yield* labels(production.id), [])
      assert.deepStrictEqual(yield* labels(dev.id), ["Launch"])

      const empty = yield* Effect.promise(() =>
        h.admin.fetch(`/api/projects/${projectId}/annotations/${annotationId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ environments: [] })
        }).then((r) => r.status)
      )
      assert.strictEqual(empty, 400)

      // Only the fields given change.
      const widened = yield* h.client.annotations.update({ params: { projectId, annotationId }, payload: { environments: "all" } })
      assert.deepStrictEqual(
        { label: widened.label, at: DateTime.formatIso(widened.at), environments: widened.environments },
        { label: "Launch", at: "2026-03-01T08:30:00.000Z", environments: "all" }
      )
      assert.deepStrictEqual(yield* labels(production.id), ["Launch"])
      const staging = yield* h.client.projects.addEnvironment({ params: { projectId }, payload: { name: "staging" } })
      assert.deepStrictEqual(yield* labels(staging.id), ["Launch"])
    }))

  it.effect("editing an Annotation of another Project is not found", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const project = yield* h.createProject({})
      const other = yield* h.createProject({})
      yield* at("2026-03-01T10:00:00Z")
      const launch = yield* h.client.annotations.create({ params: { projectId: project.id }, payload: { label: "Launch" } })
      const elsewhere = yield* h.client.annotations.update({
        params: { projectId: other.id, annotationId: launch.id },
        payload: { label: "Mine now" }
      }).pipe(Effect.flip)
      assert.strictEqual(elsewhere._tag, "AnnotationNotFound")
    }))

  it.effect("Project settings list every Annotation, newest first; a viewer sees the list but gets Forbidden for editing", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const project = yield* h.createProject({ environments: ["production", "dev"] })
      const projectId = project.id
      const dev = project.environments.find((e) => e.name === "dev")!
      yield* at("2026-03-10T10:00:00Z")
      const add = (label: string, iso: string, environments?: "all" | [typeof dev.id]) =>
        h.client.annotations.create({ params: { projectId }, payload: { label, at: DateTime.makeUnsafe(iso), environments } })
      yield* add("Oldest", "2026-01-01T00:00:00Z")
      yield* add("Newest", "2026-03-09T00:00:00Z", [dev.id])
      yield* add("Middle", "2026-02-01T00:00:00Z")

      const list = yield* h.client.annotations.list({ params: { projectId } })
      assert.deepStrictEqual(list.map((a) => [a.label, a.environments]), [["Newest", [dev.id]], ["Middle", "all"], ["Oldest", "all"]])

      const viewer = yield* signedIn("vic@example.com")
      yield* h.client.projects.addMember({ params: { projectId }, payload: { email: "vic@example.com", role: "viewer" } })
      assert.deepStrictEqual(yield* viewer.client.annotations.list({ params: { projectId } }), list)
      const refused = yield* viewer.client.annotations.update({
        params: { projectId, annotationId: list[0]!.id },
        payload: { label: "Mine" }
      }).pipe(Effect.flip)
      assert.strictEqual(refused._tag, "ProjectOwnerRequired")

      const outsider = yield* signedIn("olga@example.com")
      const hidden = yield* outsider.client.annotations.list({ params: { projectId } }).pipe(Effect.flip)
      assert.strictEqual(hidden._tag, "ProjectNotFound")
    }))

  it.effect("deleting an Environment removes it from every narrowed Annotation and deletes those left with none", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const project = yield* h.createProject({ environments: ["production", "dev", "staging"] })
      const projectId = project.id
      const named = (name: string) => project.environments.find((e) => e.name === name)!.id
      const [production, dev, staging] = [named("production"), named("dev"), named("staging")]
      yield* at("2026-03-01T10:00:00Z")
      const add = (label: string, environments: "all" | [typeof dev, ...Array<typeof dev>]) =>
        h.client.annotations.create({ params: { projectId }, payload: { label, environments } })
      yield* add("Everywhere", "all")
      yield* add("Dev only", [dev])
      yield* add("Dev and staging", [dev, staging])
      yield* add("Production and dev", [production, dev])

      yield* h.client.environments.delete({ params: { environmentId: dev } })

      const list = yield* h.client.annotations.list({ params: { projectId } })
      assert.deepStrictEqual(
        list.map((a): [string, unknown] => [a.label, a.environments]).sort(),
        [["Dev and staging", [staging]], ["Everywhere", "all"], ["Production and dev", [production]]]
      )
    }))

  it.effect("the Custom event detail carries the Annotations of its Environment in range", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const project = yield* h.createProject({ environments: ["production", "dev"] })
      const projectId = project.id
      const production = project.environments.find((e) => e.name === "production")!
      const dev = project.environments.find((e) => e.name === "dev")!
      yield* at("2026-03-10T10:00:00Z")
      const add = (label: string, iso: string, environments?: [typeof dev.id]) =>
        h.client.annotations.create({ params: { projectId }, payload: { label, at: DateTime.makeUnsafe(iso), environments } })
      yield* add("Launch", "2026-03-10T09:00:00Z")
      yield* add("Dev test", "2026-03-10T08:00:00Z", [dev.id])
      yield* add("Last month", "2026-02-01T09:00:00Z")

      const detail = (environmentId: typeof dev.id) =>
        h.client.customEvents.detail({ params: { environmentId }, query: { period: "today", name: "signup" } }).pipe(
          Effect.map((d) => d.annotations.map((a) => a.label))
        )
      assert.deepStrictEqual(yield* detail(production.id), ["Launch"])
      assert.deepStrictEqual(yield* detail(dev.id), ["Dev test", "Launch"])
    }))
})
