// The Projects page's numbers: live Visitors, Visitors over the last 7 local days and the 7
// before, and Visitors per day, for each visible Project's `production` Environment.
import { assert, layer } from "@effect/vitest"
import type { ProjectId } from "@flock/shared"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { customEvent, Harness, pageview } from "./harness.ts"

const at = (iso: string) => TestClock.setTime(Date.parse(iso))

/** Seeds a Member and returns a browser signed in as them. */
const signedIn = (email: string) =>
  Effect.gen(function*() {
    const h = yield* Harness
    const password = `${email}-password`
    yield* h.seedMember({ email, password, name: email.split("@")[0]! })
    const browser = yield* h.browser()
    yield* browser.signIn({ email, password })
    return browser
  })

const numbersOf = (rows: ReadonlyArray<{ readonly projectId: ProjectId; readonly production: unknown }>, id: ProjectId) =>
  rows.find((row) => row.projectId === id)?.production

layer(Harness.layer())("Projects page numbers", (it) => {
  it.effect("counts the production Environment's Visitors: live, the last 7 local days, the 7 before, and per day", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const project = yield* h.createProject({ environments: ["dev"] })
      const [production, dev] = project.environments

      yield* at("2026-03-01T12:00:00Z") // before both periods
      yield* h.ingest(production!.key, [pageview()], { ip: "198.51.100.9" })
      yield* at("2026-03-03T12:00:00Z") // previous period
      yield* h.ingest(production!.key, [pageview()], { ip: "198.51.100.1" })
      yield* h.ingest(production!.key, [pageview()], { ip: "198.51.100.2" })
      yield* at("2026-03-08T23:59:00Z") // last day of the previous period
      yield* h.ingest(production!.key, [customEvent("signup_completed")], { ip: "198.51.100.3" })
      yield* at("2026-03-10T09:00:00Z")
      yield* h.ingest(production!.key, [pageview(), pageview()], { ip: "198.51.100.1" })
      yield* h.ingest(production!.key, [pageview()], { ip: "198.51.100.2" })
      yield* h.ingest(dev!.key, [pageview()], { ip: "198.51.100.7" })
      yield* at("2026-03-15T10:00:00Z")
      yield* h.ingest(production!.key, [pageview()], { ip: "198.51.100.5" })
      yield* at("2026-03-15T11:50:00Z")
      yield* h.ingest(production!.key, [pageview()], { ip: "198.51.100.4" })
      yield* h.ingest(dev!.key, [pageview()], { ip: "198.51.100.8" })
      yield* at("2026-03-15T12:00:00Z")

      const rows = yield* h.client.projects.numbers()
      assert.deepStrictEqual(numbersOf(rows, project.id), {
        environmentId: production!.id,
        live: 1,
        visitors: 4,
        previousVisitors: 3,
        series: [
          { date: "2026-03-09", visitors: 0 },
          { date: "2026-03-10", visitors: 2 },
          { date: "2026-03-11", visitors: 0 },
          { date: "2026-03-12", visitors: 0 },
          { date: "2026-03-13", visitors: 0 },
          { date: "2026-03-14", visitors: 0 },
          { date: "2026-03-15", visitors: 2 }
        ]
      })
    }))

  it.effect("splits the days in the Project's time zone", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const project = yield* h.createProject({ timeZone: "America/New_York" })
      const [production] = project.environments

      yield* at("2026-03-09T03:00:00Z") // 23:00 on 8 March in New York: previous period
      yield* h.ingest(production!.key, [pageview()], { ip: "198.51.100.1" })
      yield* at("2026-03-09T05:00:00Z") // 01:00 on 9 March in New York: the first of the last 7 days
      yield* h.ingest(production!.key, [pageview()], { ip: "198.51.100.2" })
      yield* at("2026-03-16T03:00:00Z") // still 15 March in New York

      const numbers = numbersOf(yield* h.client.projects.numbers(), project.id) as {
        readonly visitors: number
        readonly previousVisitors: number
        readonly series: ReadonlyArray<{ readonly date: string; readonly visitors: number }>
      }
      assert.deepStrictEqual([numbers.visitors, numbers.previousVisitors], [1, 1])
      assert.deepStrictEqual(numbers.series.map((d) => d.date), [
        "2026-03-09", "2026-03-10", "2026-03-11", "2026-03-12", "2026-03-13", "2026-03-14", "2026-03-15"
      ])
      assert.deepStrictEqual(numbers.series[0], { date: "2026-03-09", visitors: 1 })
    }))

  it.effect("covers every Project the Member can see, viewers included, and no others", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const owner = yield* signedIn("olive@example.com")
      const viewer = yield* signedIn("victor@example.com")
      const shared = yield* h.createProject({ name: "Shared", as: owner })
      const own = yield* h.createProject({ name: "Victor's own", as: viewer })
      const hidden = yield* h.createProject({ name: "Not shared", as: owner })
      yield* owner.client.projects.addMember({ params: { projectId: shared.id }, payload: { email: "victor@example.com", role: "viewer" } })

      yield* at("2026-04-01T12:00:00Z")
      yield* h.ingest(shared.environments[0]!.key, [pageview()], { ip: "198.51.100.1" })
      yield* h.ingest(hidden.environments[0]!.key, [pageview()], { ip: "198.51.100.2" })
      yield* at("2026-04-01T12:05:00Z")

      const rows = yield* viewer.client.projects.numbers()
      assert.deepStrictEqual(rows.map((row) => row.projectId), [shared.id, own.id])
      const numbers = numbersOf(rows, shared.id) as { readonly live: number; readonly visitors: number }
      assert.deepStrictEqual([numbers.live, numbers.visitors], [1, 1])
      assert.strictEqual((numbersOf(rows, own.id) as { readonly visitors: number }).visitors, 0)
    }))

  it.effect("gives a Project without a production Environment empty numbers, and ignores its other Environments", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const project = yield* h.createProject({ environments: ["dev"], withoutProduction: true })

      yield* at("2026-05-01T12:00:00Z")
      yield* h.ingest(project.environments[0]!.key, [pageview()], { ip: "198.51.100.1" })

      const rows = yield* h.client.projects.numbers()
      assert.isTrue(rows.some((row) => row.projectId === project.id))
      assert.isNull(numbersOf(rows, project.id))
    }))
})
