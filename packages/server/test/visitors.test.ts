// The Visitors list, the Visitor profile and a Visitor's Sessions (persistent Tracking mode), observed through the Visitors API.
import { assert, layer } from "@effect/vitest"
import type { EnvironmentId, IngestEvent, VisitorsQuery } from "@flock/shared"
import { DateTime, Effect, Fiber } from "effect"
import pg from "pg"
import { TestClock } from "effect/testing"
import { customEvent, Harness, pageview } from "./harness.ts"

const at = (iso: string) => TestClock.setTime(Date.parse(iso))
const as = (distinctId: string, event: IngestEvent): IngestEvent => ({ ...event, distinct_id: distinctId })
/** What the browser script sends on `identify(id)` from a device with Visitor ID `deviceId`. */
const identify = (id: string, deviceId: string, name?: unknown) =>
  as(id, customEvent("$identify", { $anon_distinct_id: deviceId, ...(name === undefined ? {} : { $name: name }) }))
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

  it.effect("an identified Visitor is shown by the Display name of their latest Identify, and an Identify without one keeps it", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* persistentProject()
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [identify("user_1", "laptop", "sam"), as("user_1", pageview())])
      assert.strictEqual((yield* profile(production!.id, "user_1")).displayName, "sam")
      // Renamed: the phone's Identify is later, and the Visitor keeps all their history.
      yield* at("2026-03-02T09:00:00Z")
      yield* h.ingest(production!.key, [identify("user_1", "phone", "samuel")], { ip: "203.0.113.9" })
      // A stale tab's Identify, sent late with an earlier timestamp, doesn't undo the rename.
      yield* h.ingest(production!.key, [{ ...identify("user_1", "laptop", "sam"), timestamp: "2026-03-01T20:00:00Z" }])
      // An Identify without a name leaves it alone.
      yield* at("2026-03-02T10:00:00Z")
      yield* h.ingest(production!.key, [identify("user_1", "laptop")])

      const visitor = yield* profile(production!.id, "user_1")
      assert.strictEqual(visitor.displayName, "samuel")
      assert.strictEqual(visitor.events, 5)
      const { sessions: [latest] } = yield* visitorSessions(production!.id, "user_1")
      assert.strictEqual((yield* h.session(production!.id, latest!.id)).visitorDisplayName, "samuel")
      // Anonymous and nameless identified Visitors have none.
      yield* h.ingest(production!.key, [identify("user_2", "tablet"), as("anon", pageview())], { ip: "203.0.113.10" })
      assert.isNull((yield* profile(production!.id, "user_2")).displayName)
      assert.isNull((yield* profile(production!.id, "anon")).displayName)
    }))

  it.effect("cleans the Display name, and never refuses an Identify over it", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* persistentProject()
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [identify("user_1", "laptop", "  Sam Lee  ")])
      yield* h.ingest(production!.key, [identify("user_2", "phone", "x".repeat(250))], { ip: "203.0.113.9" })
      yield* at("2026-03-01T10:00:00Z")
      // Blank or not text: as if no name was sent, so the earlier one stays.
      const result = yield* h.ingest(production!.key, [identify("user_1", "laptop", "   "), identify("user_2", "phone", 42)])
      assert.deepStrictEqual(result.rejected, [])

      assert.strictEqual((yield* profile(production!.id, "user_1")).displayName, "Sam Lee")
      assert.strictEqual((yield* profile(production!.id, "user_2")).displayName, "x".repeat(200))
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

  it.effect("a Visitor stays identified after its only device switches to another account, and is never merged afterwards", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* persistentProject()
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [identify("person-1", "laptop"), as("person-1", pageview())])
      // Someone else signs in on the same laptop: the device switches to person-2.
      yield* at("2026-03-01T10:00:00Z")
      yield* h.ingest(production!.key, [identify("person-2", "laptop"), as("person-2", pageview())])

      const afterSwitch = yield* profile(production!.id, "person-1")
      assert.strictEqual(afterSwitch.identified, true)
      assert.strictEqual(afterSwitch.events, 2)
      assert.strictEqual(afterSwitch.sessions, 1)
      const list = yield* visitors(production!.id, march("01"))
      assert.deepStrictEqual(list.visitors.map((v) => [v.visitorId, v.identified]), [["person-2", true], ["person-1", true]])
      const found = yield* visitors(production!.id, { ...march("01"), search: "person-1" })
      assert.deepStrictEqual(found.visitors.map((v) => v.visitorId), ["person-1"])
      const { sessions: [session] } = yield* visitorSessions(production!.id, "person-1")
      const details = yield* h.session(production!.id, session!.id)
      assert.deepStrictEqual([details.visitorId, details.visitorIdentified], ["person-1", true])

      // An Identify that would move person-1's history into person-2 is ignored.
      yield* at("2026-03-01T11:00:00Z")
      yield* h.ingest(production!.key, [identify("person-2", "person-1"), as("person-1", pageview())])

      const one = yield* profile(production!.id, "person-1")
      const two = yield* profile(production!.id, "person-2")
      assert.strictEqual(one.identified, true)
      assert.strictEqual(two.identified, true)
      assert.strictEqual(one.events, 3)
      assert.strictEqual(two.events, 3)
      assert.strictEqual(one.sessions, 2)
      assert.strictEqual(two.sessions, 2)
    }))

  it.effect("an ID named by a refused Identify is an identified Visitor too, and is never merged afterwards", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* persistentProject()
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [identify("user_1", "laptop"), as("user_1", pageview())])
      // The app calls identify("user_2") on a device whose stored ID is user_1 itself: nothing moves,
      // but the device sends its Events as user_2 from now on.
      yield* h.ingest(production!.key, [identify("user_2", "user_1"), as("user_2", pageview())])
      yield* h.ingest(production!.key, [identify("user_3", "user_2"), as("user_3", pageview())])

      const profiles = yield* Effect.forEach(["user_1", "user_2", "user_3"], (id) => profile(production!.id, id))
      assert.deepStrictEqual(profiles.map((p) => [p.identified, p.events]), [[true, 2], [true, 2], [true, 2]])
    }))

  it.effect("an ID is never merged away by an Identify that arrives while its own first Identify is still being stored", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* persistentProject()
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [as("laptop", pageview())])
      yield* h.ingest(production!.key, [as("account-1", pageview())], { ip: "203.0.113.9" })

      // Holding the laptop's Events on a second connection pauses its Identify part-way, before it commits.
      const connection = new pg.Client({ connectionString: h.databaseUrl })
      yield* Effect.addFinalizer(() => Effect.promise(() => connection.end()))
      yield* Effect.promise(async () => {
        await connection.connect()
        await connection.query("BEGIN")
        await connection.query("SELECT 1 FROM event WHERE visitor_id = 'laptop' FOR UPDATE")
      })
      const settle = Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 300)))
      const first = yield* Effect.forkChild(h.ingest(production!.key, [identify("account-1", "laptop")]))
      yield* settle
      const second = yield* Effect.forkChild(h.ingest(production!.key, [identify("account-2", "account-1")], { ip: "203.0.113.9" }))
      yield* settle
      yield* Effect.promise(() => connection.query("COMMIT"))
      yield* Fiber.join(first)
      yield* Fiber.join(second)
      yield* h.ingest(production!.key, [as("account-1", customEvent("after"))])

      const one = yield* profile(production!.id, "account-1")
      const two = yield* profile(production!.id, "account-2")
      assert.strictEqual(one.identified, true)
      assert.strictEqual(one.events, 4) // both Pageviews, its Identify and the Event after
      assert.strictEqual(two.events, 1) // only its own refused Identify
    }))
})

const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1"

const visitors = (environmentId: EnvironmentId, query: VisitorsQuery) =>
  Effect.gen(function*() {
    const h = yield* Harness
    return yield* h.client.visitors.list({ params: { environmentId }, query })
  })

const march = (from: string, to = from) => ({ period: "custom" as const, from: `2026-03-${from}`, to: `2026-03-${to}` })

layer(Harness.layer({ geoIp: { "198.51.100.1": "DE", "198.51.100.2": "FR" } }))("Visitors list", (it) => {
  it.effect("lists the Visitors active in the range, last seen first, with all-time numbers and their latest Session's audience", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production, dev] } = yield* persistentProject({ environments: ["dev"] })
      // device-1: an old Session from Germany, then one on Mar 2 from France on an iPhone via Hacker News, from a link carrying a UTM tag.
      yield* at("2026-02-20T09:00:00Z")
      yield* h.ingest(production!.key, [as("device-1", pageview()), as("device-1", customEvent("signup"))], { ip: "198.51.100.1", userAgent: CHROME_WINDOWS })
      yield* at("2026-03-02T09:00:00Z")
      yield* h.ingest(production!.key, [as("device-1", pageview({ $url: "https://example.com/?utm_source=fnf", $referrer: "https://news.ycombinator.com/item" }))], { ip: "198.51.100.2", userAgent: SAFARI_IPHONE })
      // device-2: on Mar 2, earlier, and again after the range on Mar 5.
      yield* at("2026-03-02T08:00:00Z")
      yield* h.ingest(production!.key, [as("device-2", pageview())], { ip: "198.51.100.1", userAgent: CHROME_WINDOWS })
      yield* at("2026-03-05T08:00:00Z")
      yield* h.ingest(production!.key, [as("device-2", pageview())], { ip: "198.51.100.1", userAgent: CHROME_WINDOWS })
      // device-3: only before the range. device-4: only on `dev`.
      yield* at("2026-02-25T08:00:00Z")
      yield* h.ingest(production!.key, [as("device-3", pageview())])
      yield* at("2026-03-02T10:00:00Z")
      yield* h.ingest(dev!.key, [as("device-4", pageview())])

      yield* at("2026-03-06T12:00:00Z")
      const { visitors: rows, nextCursor } = yield* visitors(production!.id, march("01", "03"))
      assert.isNull(nextCursor)
      assert.deepStrictEqual(
        rows.map(({ firstSeenAt, lastSeenAt, ...rest }) => ({ firstSeenAt: iso(firstSeenAt), lastSeenAt: iso(lastSeenAt), ...rest })),
        [
          {
            // Last seen after the range: the numbers are all-time, the order is by last seen.
            firstSeenAt: "2026-03-02T08:00:00.000Z",
            lastSeenAt: "2026-03-05T08:00:00.000Z",
            visitorId: "device-2",
            identified: false,
            displayName: null,
            sessions: 2,
            events: 2,
            country: "DE",
            device: "desktop",
            browser: "Chrome",
            referringDomain: null,
            utmSource: null
          },
          {
            firstSeenAt: "2026-02-20T09:00:00.000Z",
            lastSeenAt: "2026-03-02T09:00:00.000Z",
            visitorId: "device-1",
            identified: false,
            displayName: null,
            sessions: 2,
            events: 3,
            country: "FR",
            device: "mobile",
            browser: "Safari",
            referringDomain: "news.ycombinator.com",
            utmSource: "fnf"
          }
        ]
      )
    }))

  it.effect("keeps only Visitors with an Event in the range that matches every Filter", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* persistentProject()
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [as("from-hn", pageview({ $referrer: "https://news.ycombinator.com/" }))])
      yield* h.ingest(production!.key, [as("direct", pageview())])
      // Came from Hacker News, but outside the range.
      yield* at("2026-02-27T09:00:00Z")
      yield* h.ingest(production!.key, [as("hn-earlier", pageview({ $referrer: "https://news.ycombinator.com/" }))])
      yield* at("2026-03-01T10:00:00Z")
      yield* h.ingest(production!.key, [as("hn-earlier", pageview())])

      const filters = [{ eventProperty: "$referring_domain", op: "is" as const, value: "news.ycombinator.com" }]
      const { visitors: rows } = yield* visitors(production!.id, { ...march("01"), filters })
      assert.deepStrictEqual(rows.map((v) => v.visitorId), ["from-hn"])
    }))

  it.effect("pages 50 at a time with a cursor, Visitor ID breaking ties", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* persistentProject()
      yield* at("2026-03-01T09:00:00Z")
      // Two Visitors seen at the same moment, then 50 more a minute apart.
      yield* h.ingest(production!.key, [as("tie-a", pageview()), as("tie-b", pageview())])
      for (let i = 1; i <= 50; i++) {
        yield* at(new Date(Date.parse("2026-03-01T09:00:00Z") + i * 60_000).toISOString())
        yield* h.ingest(production!.key, [as(`device-${String(i).padStart(2, "0")}`, pageview())])
      }

      const first = yield* visitors(production!.id, march("01"))
      assert.strictEqual(first.visitors.length, 50)
      assert.strictEqual(first.visitors[0]!.visitorId, "device-50")
      assert.strictEqual(first.visitors[49]!.visitorId, "device-01")
      assert.isNotNull(first.nextCursor)
      const second = yield* visitors(production!.id, { ...march("01"), cursor: first.nextCursor! })
      assert.deepStrictEqual(second.visitors.map((v) => v.visitorId), ["tie-b", "tie-a"])
      assert.isNull(second.nextCursor)
    }))

  it.effect("searches identified Visitor IDs by prefix", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* persistentProject()
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [identify("user_20418", "laptop"), as("user_20418", pageview())])
      yield* h.ingest(production!.key, [identify("user_7", "phone"), as("user_7", pageview())], { ip: "203.0.113.9" })
      yield* h.ingest(production!.key, [identify("priya@example.com", "tablet"), as("priya@example.com", pageview())], { ip: "203.0.113.10" })
      // An anonymous Visitor whose ID happens to start the same way.
      yield* h.ingest(production!.key, [as("user_anon", pageview())], { ip: "203.0.113.11" })

      const users = yield* visitors(production!.id, { ...march("01"), search: "user_" })
      assert.deepStrictEqual(users.visitors.map((v) => [v.visitorId, v.identified]), [["user_7", true], ["user_20418", true]])
      const one = yield* visitors(production!.id, { ...march("01"), search: "user_2" })
      assert.deepStrictEqual(one.visitors.map((v) => v.visitorId), ["user_20418"])
      const wildcard = yield* visitors(production!.id, { ...march("01"), search: "%" })
      assert.deepStrictEqual(wildcard.visitors, [])
    }))

  it.effect("searches Display names by any part, ignoring case, and lists each Visitor's", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* persistentProject()
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [identify("user_1", "laptop", "Samuel"), as("user_1", pageview())])
      yield* h.ingest(production!.key, [identify("user_2", "phone", "Priya"), as("user_2", pageview())], { ip: "203.0.113.9" })
      yield* h.ingest(production!.key, [identify("user_3", "tablet"), as("user_3", pageview())], { ip: "203.0.113.10" })

      const all = yield* visitors(production!.id, march("01"))
      assert.deepStrictEqual(all.visitors.map((v) => [v.visitorId, v.displayName]), [["user_3", null], ["user_2", "Priya"], ["user_1", "Samuel"]])
      const sam = yield* visitors(production!.id, { ...march("01"), search: "MUE" })
      assert.deepStrictEqual(sam.visitors.map((v) => v.visitorId), ["user_1"])
      // The ID prefix still matches, whatever the name.
      const byId = yield* visitors(production!.id, { ...march("01"), search: "user_" })
      assert.strictEqual(byId.visitors.length, 3)
    }))

  it.effect("is refused for a cookieless Project, and hides other Members' Environments as not found", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [cookieless] } = yield* h.createProject({})
      const error = yield* visitors(cookieless!.id, march("01")).pipe(Effect.flip)
      assert.strictEqual(error._tag, "VisitorsNeedPersistentMode")

      const { environments: [production] } = yield* persistentProject()
      yield* h.seedMember({ email: "list-outsider@example.com", password: "outsider-password" })
      const outsider = yield* h.browser()
      yield* outsider.signIn({ email: "list-outsider@example.com", password: "outsider-password" })
      const hidden = yield* outsider.client.visitors.list({ params: { environmentId: production!.id }, query: march("01") }).pipe(Effect.flip)
      assert.strictEqual(hidden._tag, "EnvironmentNotFound")
    }))
})
