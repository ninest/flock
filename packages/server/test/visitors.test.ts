// The Visitor profile and a Visitor's Sessions (persistent Tracking mode), observed through the Visitors API.
import { assert, layer } from "@effect/vitest"
import type { EnvironmentId, IngestEvent } from "@flock/shared"
import { DateTime, Effect } from "effect"
import { TestClock } from "effect/testing"
import { customEvent, Harness, pageview } from "./harness.ts"

const at = (iso: string) => TestClock.setTime(Date.parse(iso))
const as = (distinctId: string, event: IngestEvent): IngestEvent => ({ ...event, distinct_id: distinctId })
/** What the browser script sends on `identify(id)` from a device with Visitor ID `deviceId`. */
const identify = (id: string, deviceId: string) => as(id, customEvent("$identify", { $anon_distinct_id: deviceId }))
const iso = (t: DateTime.Utc) => DateTime.formatIso(t)

const persistentProject = (options: { readonly timeZone?: string; readonly environments?: ReadonlyArray<string> } = {}) =>
  Effect.gen(function*() {
    const h = yield* Harness
    const project = yield* h.createProject(options)
    yield* h.client.projects.update({ params: { projectId: project.id }, payload: { trackingMode: "persistent" } })
    return project
  })

const profile = (environmentId: EnvironmentId, visitorId: string) =>
  Effect.gen(function*() {
    const h = yield* Harness
    return yield* h.client.visitors.profile({ params: { environmentId, visitorId } })
  })

const visitorSessions = (environmentId: EnvironmentId, visitorId: string, cursor?: string) =>
  Effect.gen(function*() {
    const h = yield* Harness
    return yield* h.client.visitors.sessions({ params: { environmentId, visitorId }, query: { cursor } })
  })

layer(Harness.layer())("Visitor profile", (it) => {
  it.effect("covers the Visitor's whole history in the Environment, whatever the date range", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production, dev] } = yield* persistentProject({ timeZone: "America/New_York", environments: ["dev"] })
      // Two Sessions a month apart, plus Events of another Visitor and of the same ID on `dev`.
      yield* at("2026-02-01T15:00:00Z")
      yield* h.ingest(production!.key, [as("device-1", pageview({ $url: "https://example.com/" }))])
      yield* at("2026-02-01T15:05:00Z")
      yield* h.ingest(production!.key, [as("device-1", pageview({ $url: "https://example.com/pricing" }))])
      yield* h.ingest(production!.key, [as("device-2", pageview())])
      yield* h.ingest(dev!.key, [as("device-1", customEvent("dev_only"))])
      yield* at("2026-03-01T03:30:00Z") // still Feb 28 in New York
      yield* h.ingest(production!.key, [as("device-1", customEvent("signup_completed")), as("device-1", pageview())])

      yield* at("2026-03-02T12:00:00Z")
      const visitor = yield* profile(production!.id, "device-1")
      assert.strictEqual(visitor.visitorId, "device-1")
      assert.strictEqual(visitor.identified, false)
      assert.strictEqual(iso(visitor.firstSeenAt), "2026-02-01T15:00:00.000Z")
      assert.strictEqual(iso(visitor.lastSeenAt), "2026-03-01T03:30:00.000Z")
      assert.strictEqual(visitor.sessions, 2)
      assert.strictEqual(visitor.events, 4)
      assert.deepStrictEqual(visitor.eventNames, [{ name: "$pageview", count: 3 }, { name: "signup_completed", count: 1 }])

      // Events per local day: 26 weeks ending today in the Project's time zone, empty days included.
      assert.strictEqual(visitor.activity.length, 182)
      assert.deepStrictEqual(visitor.activity.at(-1), { date: "2026-03-02", events: 0 })
      assert.strictEqual(visitor.activity[0]!.date, "2025-09-02")
      assert.deepStrictEqual(visitor.activity.filter((d) => d.events > 0), [
        { date: "2026-02-01", events: 2 },
        { date: "2026-02-28", events: 2 }
      ])
    }))

  it.effect("lists the Visitor's Sessions newest first, paged, in the Session summary shape", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* persistentProject()
      // 52 Sessions, an hour apart; another Visitor's Session in between.
      for (let i = 0; i < 52; i++) {
        yield* at(new Date(Date.parse("2026-03-01T00:00:00Z") + i * 3_600_000).toISOString())
        yield* h.ingest(production!.key, [as("device-1", pageview({ $url: `https://example.com/p${i}` }))])
        if (i === 10) yield* h.ingest(production!.key, [as("device-2", pageview())])
      }

      const first = yield* visitorSessions(production!.id, "device-1")
      assert.strictEqual(first.sessions.length, 50)
      assert.strictEqual(first.sessions[0]!.entryPage, "/p51")
      assert.strictEqual(first.sessions[49]!.entryPage, "/p2")
      assert.isNotNull(first.nextCursor)
      const second = yield* visitorSessions(production!.id, "device-1", first.nextCursor!)
      assert.deepStrictEqual(second.sessions.map((s) => s.entryPage), ["/p1", "/p0"])
      assert.isNull(second.nextCursor)
    }))

  it.effect("returns not found for an unknown Visitor, or one only seen in another Environment", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production, dev] } = yield* persistentProject({ environments: ["dev"] })
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(dev!.key, [as("device-1", pageview())])

      const unknown = yield* profile(production!.id, "device-1").pipe(Effect.flip)
      assert.strictEqual(unknown._tag, "VisitorNotFound")
      const noSessions = yield* visitorSessions(production!.id, "nobody").pipe(Effect.flip)
      assert.strictEqual(noSessions._tag, "VisitorNotFound")
    }))

  it.effect("is refused for a cookieless Project, with an error saying why", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [pageview()], { ip: "198.51.100.1" })
      const { sessions: [session] } = yield* h.sessions(production!.id, { period: "today" })
      assert.isDefined(session)

      const error = yield* profile(production!.id, "anyone").pipe(Effect.flip)
      assert.strictEqual(error._tag, "VisitorsNeedPersistentMode")
      const sessionsError = yield* visitorSessions(production!.id, "anyone").pipe(Effect.flip)
      assert.strictEqual(sessionsError._tag, "VisitorsNeedPersistentMode")
    }))

  it.effect("answers a Project viewer, and hides other Members' Environments as not found", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const project = yield* persistentProject()
      const production = project.environments[0]!
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production.key, [as("device-1", pageview())])
      yield* h.seedMember({ email: "viewer@example.com", password: "viewer-password" })
      yield* h.seedMember({ email: "outsider@example.com", password: "outsider-password" })
      const viewer = yield* h.browser()
      yield* viewer.signIn({ email: "viewer@example.com", password: "viewer-password" })
      const outsider = yield* h.browser()
      yield* outsider.signIn({ email: "outsider@example.com", password: "outsider-password" })
      yield* h.client.projects.addMember({ params: { projectId: project.id }, payload: { email: "viewer@example.com", role: "viewer" } })

      const seen = yield* viewer.client.visitors.profile({ params: { environmentId: production.id, visitorId: "device-1" } })
      assert.strictEqual(seen.events, 1)
      const hidden = yield* outsider.client.visitors.profile({ params: { environmentId: production.id, visitorId: "device-1" } })
        .pipe(Effect.flip)
      assert.strictEqual(hidden._tag, "EnvironmentNotFound")
    }))
})

layer(Harness.layer())("Visitor profile and Identify (ADR 0005)", (it) => {
  it.effect("a person identified on two devices is one Visitor with both devices' history", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* persistentProject()
      // Laptop: browses anonymously, then signs in.
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [as("laptop", pageview())])
      yield* at("2026-03-01T09:05:00Z")
      yield* h.ingest(production!.key, [identify("user_20418", "laptop"), as("user_20418", pageview())])
      // Phone, the next day: browses anonymously, then signs in as the same person.
      yield* at("2026-03-02T19:00:00Z")
      yield* h.ingest(production!.key, [as("phone", pageview())], { ip: "203.0.113.9" })
      yield* at("2026-03-02T19:02:00Z")
      yield* h.ingest(production!.key, [identify("user_20418", "phone"), as("user_20418", customEvent("cta_clicked"))], {
        ip: "203.0.113.9"
      })

      const anna = yield* profile(production!.id, "user_20418")
      assert.strictEqual(anna.identified, true)
      assert.strictEqual(iso(anna.firstSeenAt), "2026-03-01T09:00:00.000Z")
      assert.strictEqual(anna.sessions, 2)
      assert.strictEqual(anna.events, 6)
      assert.deepStrictEqual(anna.eventNames, [
        { name: "$pageview", count: 3 },
        { name: "$identify", count: 2 },
        { name: "cta_clicked", count: 1 }
      ])
      const { sessions } = yield* visitorSessions(production!.id, "user_20418")
      assert.strictEqual(sessions.length, 2)
      // The devices' own IDs are no Visitors any more.
      const laptop = yield* profile(production!.id, "laptop").pipe(Effect.flip)
      assert.strictEqual(laptop._tag, "VisitorNotFound")
    }))

  it.effect("two identified IDs never merge", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* persistentProject()
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [identify("user_1", "laptop"), as("user_1", pageview())])
      yield* h.ingest(production!.key, [identify("user_2", "phone"), as("user_2", pageview())], { ip: "203.0.113.9" })
      // An Identify that would link one identified Visitor to another is ignored.
      yield* at("2026-03-01T10:00:00Z")
      yield* h.ingest(production!.key, [identify("user_2", "user_1"), as("user_1", pageview())])

      const one = yield* profile(production!.id, "user_1")
      const two = yield* profile(production!.id, "user_2")
      assert.strictEqual(one.identified, true)
      assert.strictEqual(two.identified, true)
      assert.strictEqual(one.events, 3)
      assert.strictEqual(two.events, 3)
    }))
})
