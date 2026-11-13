// Project sharing: owners add other Members as owner or viewer. Viewers read
// reports; only owners change settings, keys, Environments or membership.
import { assert, layer } from "@effect/vitest"
import { DateTime, Effect } from "effect"
import { TestClock } from "effect/testing"
import { type Browser, customEvent, Harness, pageview } from "./harness.ts"

const allTime = { from: DateTime.makeUnsafe("2026-01-01T00:00:00Z"), to: DateTime.makeUnsafe("2027-01-01T00:00:00Z") }
const day = { period: "custom" as const, from: "2026-03-01", to: "2026-03-01" }

/** Seeds a Member and returns a browser signed in as them. */
const signedIn = (email: string) =>
  Effect.gen(function*() {
    const h = yield* Harness
    const password = `${email}-password`
    const id = yield* h.seedMember({ email, password, name: email.split("@")[0]! })
    const browser = yield* h.browser()
    yield* browser.signIn({ email, password })
    return { id, browser }
  })

const tags = (effects: ReadonlyArray<Effect.Effect<unknown, { readonly _tag: string }>>) =>
  Effect.forEach(effects, (e) => e.pipe(Effect.flip, Effect.map((error) => error._tag)))

layer(Harness.layer())("Project sharing", (it) => {
  it.effect("an owner adds a Member as viewer, and the Project appears in their list", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const owner = yield* signedIn("olive@example.com")
      const viewer = yield* signedIn("victor@example.com")
      const project = yield* h.createProject({ name: "Shared site", environments: ["dev"], as: owner.browser })

      const added = yield* owner.browser.client.projects.addMember({
        params: { projectId: project.id },
        payload: { email: "Victor@Example.com", role: "viewer" }
      })
      assert.deepStrictEqual(
        { id: added.id, email: added.email, name: added.name, role: added.role },
        { id: viewer.id, email: "victor@example.com", name: "victor", role: "viewer" }
      )

      const listed = yield* viewer.browser.client.projects.list()
      assert.deepStrictEqual(listed.map((p) => [p.name, p.role]), [["Shared site", "viewer"]])
      assert.deepStrictEqual(listed[0]!.environments.map((e) => e.name), ["production", "dev"])

      const members = yield* owner.browser.client.projects.members({ params: { projectId: project.id } })
      assert.deepStrictEqual(members.map((m) => [m.email, m.role]), [["olive@example.com", "owner"], ["victor@example.com", "viewer"]])
    }))

  it.effect("a viewer queries reports but is refused every settings, key, Environment, membership and deletion action", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const owner = yield* signedIn("oscar@example.com")
      const viewer = yield* signedIn("vera@example.com")
      const other = yield* signedIn("otto@example.com")
      const project = yield* h.createProject({ name: "Read-only", environments: ["dev"], as: owner.browser })
      const [production, dev] = project.environments
      const projectId = project.id
      yield* owner.browser.client.projects.addMember({ params: { projectId }, payload: { email: "vera@example.com", role: "viewer" } })
      yield* TestClock.setTime(Date.parse("2026-03-01T10:00:00Z"))
      yield* h.sdk.ingest.send({ payload: { key: dev!.key, events: [pageview(), pageview()] } })

      const api = viewer.browser.client
      for (const env of [production!, dev!]) {
        const count = yield* api.reports.pageviewCount({ params: { environmentId: env.id }, query: allTime })
        assert.strictEqual(count.pageviews, env === dev ? 2 : 0)
      }
      const seen = yield* api.projects.get({ params: { projectId } })
      assert.deepStrictEqual({ ...seen }, { ...project, role: "viewer" })
      assert.strictEqual((yield* api.projects.members({ params: { projectId } })).length, 2)

      const refused = yield* tags([
        api.projects.update({ params: { projectId }, payload: { name: "Mine now" } }),
        api.projects.update({ params: { projectId }, payload: { timeZone: "Asia/Tokyo" } }),
        api.projects.delete({ params: { projectId } }),
        api.projects.addEnvironment({ params: { projectId }, payload: { name: "staging" } }),
        api.environments.rotateKey({ params: { environmentId: production!.id } }),
        api.environments.update({ params: { environmentId: production!.id }, payload: { allowedOrigins: ["*"] } }),
        api.environments.delete({ params: { environmentId: dev!.id } }),
        api.environments.deleteEvents({ params: { environmentId: dev!.id } }),
        api.projects.addMember({ params: { projectId }, payload: { email: "otto@example.com", role: "viewer" } }),
        api.projects.changeMemberRole({ params: { projectId, memberId: viewer.id }, payload: { role: "owner" } }),
        api.projects.changeMemberRole({ params: { projectId, memberId: owner.id }, payload: { role: "viewer" } }),
        api.projects.removeMember({ params: { projectId, memberId: owner.id } })
      ])
      assert.deepStrictEqual(refused, Array(12).fill("ProjectOwnerRequired"))

      // Nothing changed.
      const after = yield* owner.browser.client.projects.get({ params: { projectId } })
      assert.deepStrictEqual(after, project)
      assert.strictEqual((yield* owner.browser.client.reports.pageviewCount({ params: { environmentId: dev!.id }, query: allTime })).pageviews, 2)
      const members = yield* owner.browser.client.projects.members({ params: { projectId } })
      assert.deepStrictEqual(members.map((m) => [m.email, m.role]), [["oscar@example.com", "owner"], ["vera@example.com", "viewer"]])
      assert.deepStrictEqual(yield* other.browser.client.projects.list(), [])
    }))

  it.effect("a viewer reads every report; a Member outside the Project gets none of them", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const owner = yield* signedIn("orla@example.com")
      const viewer = yield* signedIn("vic@example.com")
      const stranger = yield* signedIn("sam@example.com")
      const project = yield* h.createProject({ name: "Reports", as: owner.browser })
      const environmentId = project.environments[0]!.id
      yield* owner.browser.client.projects.addMember({ params: { projectId: project.id }, payload: { email: "vic@example.com", role: "viewer" } })
      yield* TestClock.setTime(Date.parse("2026-03-01T10:00:00Z"))
      yield* h.ingest(project.environments[0]!.key, [pageview(), pageview(), customEvent("game_completed", { score: 42, level: "hard" })], { ip: "198.51.100.7" })

      const reports = (api: Browser["client"]) => [
        api.reports.pageviewCount({ params: { environmentId }, query: allTime }),
        api.reports.overview({ params: { environmentId }, query: { period: "custom", from: "2026-03-01", to: "2026-03-01" } }),
        api.reports.breakdown({ params: { environmentId }, query: { ...allTime, eventProperty: "$pathname" } }),
        api.reports.eventPropertyKeys({ params: { environmentId }, query: allTime }),
        api.customEvents.list({ params: { environmentId }, query: day }),
        api.customEvents.detail({ params: { environmentId }, query: { ...day, name: "game_completed" } }),
        api.customEvents.breakdown({ params: { environmentId }, query: { ...day, name: "game_completed", eventProperty: "level" } }),
        api.customEvents.stats({ params: { environmentId }, query: { ...day, name: "game_completed", eventProperty: "score" } })
      ] as const

      const [count, overview, breakdown, keys, customEvents, detail, byLevel, score] = yield* Effect.all(reports(viewer.browser.client))
      assert.strictEqual(count.pageviews, 2)
      assert.strictEqual(overview.totals.pageviews, 2)
      assert.strictEqual(overview.totals.visitors, 1)
      assert.strictEqual(breakdown.reduce((sum, row) => sum + row.count, 0), 2)
      assert.isTrue(keys.keys.length > 0)
      assert.deepStrictEqual(customEvents.events, [{ name: "game_completed", count: 1, visitors: 1 }])
      assert.strictEqual(detail.totals.count, 1)
      assert.deepStrictEqual(byLevel.rows, [{ value: "hard", count: 1 }])
      assert.strictEqual(score.totals.sum, 42)

      assert.deepStrictEqual(yield* tags(reports(stranger.browser.client)), Array(8).fill("EnvironmentNotFound"))
    }))

  it.effect("owners change roles and remove people; the last owner can't be removed or demoted", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const ann = yield* signedIn("ann@example.com")
      const ben = yield* signedIn("ben@example.com")
      const cat = yield* signedIn("cat@example.com")
      const project = yield* h.createProject({ name: "Team site", as: ann.browser })
      const projectId = project.id
      const roles = Effect.map(
        ann.browser.client.projects.members({ params: { projectId } }),
        (members) => members.map((m) => [m.email, m.role])
      )

      // Alone, Ann can neither leave nor step down.
      assert.deepStrictEqual(
        yield* tags([
          ann.browser.client.projects.changeMemberRole({ params: { projectId, memberId: ann.id }, payload: { role: "viewer" } }),
          ann.browser.client.projects.removeMember({ params: { projectId, memberId: ann.id } })
        ]),
        ["LastProjectOwner", "LastProjectOwner"]
      )

      yield* ann.browser.client.projects.addMember({ params: { projectId }, payload: { email: "ben@example.com", role: "viewer" } })
      yield* ann.browser.client.projects.addMember({ params: { projectId }, payload: { email: "cat@example.com", role: "viewer" } })
      const promoted = yield* ann.browser.client.projects.changeMemberRole({ params: { projectId, memberId: ben.id }, payload: { role: "owner" } })
      assert.strictEqual(promoted.role, "owner")
      assert.strictEqual((yield* ben.browser.client.projects.get({ params: { projectId } })).role, "owner")

      // Ben, now an owner, removes Cat, who loses the Project.
      yield* ben.browser.client.projects.removeMember({ params: { projectId, memberId: cat.id } })
      assert.deepStrictEqual(yield* cat.browser.client.projects.list(), [])
      assert.strictEqual((yield* cat.browser.client.projects.get({ params: { projectId } }).pipe(Effect.flip))._tag, "ProjectNotFound")

      // With another owner, Ann can step down; then Ben is the last owner.
      yield* ann.browser.client.projects.changeMemberRole({ params: { projectId, memberId: ann.id }, payload: { role: "viewer" } })
      assert.deepStrictEqual(yield* roles, [["ben@example.com", "owner"], ["ann@example.com", "viewer"]])
      assert.deepStrictEqual(
        yield* tags([
          ben.browser.client.projects.changeMemberRole({ params: { projectId, memberId: ben.id }, payload: { role: "viewer" } }),
          ben.browser.client.projects.removeMember({ params: { projectId, memberId: ben.id } }),
          ann.browser.client.projects.removeMember({ params: { projectId, memberId: ben.id } })
        ]),
        ["LastProjectOwner", "LastProjectOwner", "ProjectOwnerRequired"]
      )

      // An owner may leave while another owner remains.
      yield* ben.browser.client.projects.changeMemberRole({ params: { projectId, memberId: ann.id }, payload: { role: "owner" } })
      yield* ben.browser.client.projects.removeMember({ params: { projectId, memberId: ben.id } })
      assert.deepStrictEqual(yield* ben.browser.client.projects.list(), [])
      assert.deepStrictEqual(yield* roles, [["ann@example.com", "owner"]])
    }))

  it.effect("two owners demoting each other at once leave one owner", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const dan = yield* signedIn("dan@example.com")
      const eve = yield* signedIn("eve@example.com")
      for (let round = 0; round < 5; round++) {
        const project = yield* h.createProject({ as: dan.browser })
        const projectId = project.id
        yield* dan.browser.client.projects.addMember({ params: { projectId }, payload: { email: "eve@example.com", role: "owner" } })
        const results = yield* Effect.all([
          dan.browser.client.projects.changeMemberRole({ params: { projectId, memberId: eve.id }, payload: { role: "viewer" } }),
          eve.browser.client.projects.changeMemberRole({ params: { projectId, memberId: dan.id }, payload: { role: "viewer" } })
        ].map((e) => Effect.result(e)), { concurrency: "unbounded" })
        assert.strictEqual(results.filter((r) => r._tag === "Success").length, 1)
        // Whoever lost is now a viewer, who may still list the Project's members.
        const members = yield* dan.browser.client.projects.members({ params: { projectId } })
        assert.strictEqual(members.filter((m) => m.role === "owner").length, 1)
      }
    }))

  it.effect("adding refuses an unknown email, an existing member, and changing someone outside the Project", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const fay = yield* signedIn("fay@example.com")
      const gus = yield* signedIn("gus@example.com")
      const project = yield* h.createProject({ as: fay.browser })
      const projectId = project.id
      const api = fay.browser.client.projects
      assert.deepStrictEqual(
        yield* tags([
          api.addMember({ params: { projectId }, payload: { email: "nobody@example.com", role: "viewer" } }),
          api.addMember({ params: { projectId }, payload: { email: "fay@example.com", role: "viewer" } }),
          api.changeMemberRole({ params: { projectId, memberId: gus.id }, payload: { role: "owner" } }),
          api.removeMember({ params: { projectId, memberId: gus.id } })
        ]),
        ["NoMemberWithEmail", "AlreadyProjectMember", "ProjectMemberNotFound", "ProjectMemberNotFound"]
      )
      assert.deepStrictEqual(yield* gus.browser.client.projects.list(), [])
    }))
})
