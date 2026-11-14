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
