// Recent sessions and the Session timeline, observed through the reports API.
import { assert, layer } from "@effect/vitest"
import type { IngestEvent } from "@flock/shared"
import { DateTime, Effect } from "effect"
import { TestClock } from "effect/testing"
import { customEvent, Harness, visit } from "./harness.ts"

const at = (iso: string) => TestClock.setTime(Date.parse(iso))
const day = { period: "custom" as const, from: "2026-03-01", to: "2026-03-01" }
const iso = (t: DateTime.Utc) => DateTime.formatIso(t)

layer(Harness.layer({ geoIp: { "198.51.100.1": "DE", "198.51.100.2": "FR" } }))("Recent sessions", (it) => {
  it.effect("lists Sessions most recent activity first, each summarised from its Events", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      // Visitor 1: arrives from Hacker News on /, goes to /pricing, then signs up.
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [visit("https://example.com/", "https://news.ycombinator.com/item")], { ip: "198.51.100.1" })
      yield* at("2026-03-01T09:02:00Z")
      yield* h.ingest(production!.key, [visit("https://example.com/pricing")], { ip: "198.51.100.1" })
      yield* at("2026-03-01T09:03:30Z")
      yield* h.ingest(production!.key, [customEvent("signup_completed", { plan: "pro" })], { ip: "198.51.100.1" })
      // Visitor 2: a single direct Pageview, later, from a link carrying a UTM tag.
      yield* at("2026-03-01T10:00:00Z")
      yield* h.ingest(production!.key, [visit("https://example.com/blog?utm_source=fnf&utm_medium=chat")], { ip: "198.51.100.2" })

      yield* at("2026-03-01T12:00:00Z")
      const { nextCursor, sessions } = yield* h.sessions(production!.id, day)
      assert.strictEqual(nextCursor, null)
      assert.deepStrictEqual(
        sessions.map(({ id: _, startedAt, lastSeenAt, ...rest }) => ({ startedAt: iso(startedAt), lastSeenAt: iso(lastSeenAt), ...rest })),
        [
          {
            startedAt: "2026-03-01T10:00:00.000Z",
            lastSeenAt: "2026-03-01T10:00:00.000Z",
            duration: 0,
            events: 1,
            bounce: true,
            entryPage: "/blog",
            lastPage: "/blog",
            referringDomain: null,
            utmSource: "fnf",
            country: "FR",
            device: null,
            status: "ended"
          },
          {
            startedAt: "2026-03-01T09:00:00.000Z",
            lastSeenAt: "2026-03-01T09:03:30.000Z",
            duration: 210,
            events: 3,
            bounce: false,
            entryPage: "/",
            lastPage: "/pricing",
            referringDomain: "news.ycombinator.com",
            utmSource: null,
            country: "DE",
            device: null,
            status: "ended"
          }
        ]
      )
    }))
})

layer(Harness.layer())("Session status", (it) => {
  it.effect("is active under 5 minutes since the last Event, idle up to 30, then ended", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [visit("https://example.com/")], { ip: "198.51.100.1" })
      yield* at("2026-03-01T09:10:00Z")
      yield* h.ingest(production!.key, [visit("https://example.com/pricing")], { ip: "198.51.100.1" })

      const status = Effect.gen(function*() {
        const { sessions: [summary] } = yield* h.sessions(production!.id, day)
        const detail = yield* h.session(production!.id, summary!.id)
        assert.strictEqual(detail.status, summary!.status)
        return summary!.status
      })
      yield* at("2026-03-01T09:14:59Z")
      assert.strictEqual(yield* status, "active")
      yield* at("2026-03-01T09:15:00Z")
      assert.strictEqual(yield* status, "idle")
      yield* at("2026-03-01T09:40:00Z")
      assert.strictEqual(yield* status, "idle")
      yield* at("2026-03-01T09:40:01Z")
      assert.strictEqual(yield* status, "ended")
    }))
})

layer(Harness.layer())("Recent sessions with a range and Filters", (it) => {
  it.effect("lists a Session when any of its Events in the range matches every Filter", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      // Session A: / then /pricing. Session B: / then /blog. Session C: /pricing, the day before.
      yield* at("2026-02-28T23:00:00Z")
      yield* h.ingest(production!.key, [visit("https://example.com/pricing")], { ip: "198.51.100.3" })
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [visit("https://example.com/")], { ip: "198.51.100.1" })
      yield* h.ingest(production!.key, [visit("https://example.com/")], { ip: "198.51.100.2" })
      yield* at("2026-03-01T09:01:00Z")
      yield* h.ingest(production!.key, [visit("https://example.com/pricing")], { ip: "198.51.100.1" })
      yield* h.ingest(production!.key, [visit("https://example.com/blog")], { ip: "198.51.100.2" })
      yield* at("2026-03-01T12:00:00Z")

      const all = yield* h.sessions(production!.id, day)
      assert.deepStrictEqual(all.sessions.map((s) => s.events), [2, 2])

      const pricing = [{ eventProperty: "$path", op: "is" as const, value: "/pricing" }]
      const filtered = yield* h.sessions(production!.id, { ...day, filters: pricing })
      assert.strictEqual(filtered.sessions.length, 1)
      const [session] = filtered.sessions
      assert.strictEqual(session!.entryPage, "/")

      const detail = yield* h.session(production!.id, session!.id, pricing)
      assert.deepStrictEqual(
        detail.timeline.map((e) => [e.properties.$url, e.matchesFilters]),
        [["https://example.com/", false], ["https://example.com/pricing", true]]
      )
    }))

  it.effect("pages 50 Sessions at a time with a cursor", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      // Sessions /0 to /52, one a minute, except /0 to /5 all at the same moment: the page
      // boundary falls among Sessions with the same last activity.
      for (let i = 0; i < 53; i++) {
        yield* at(`2026-03-01T09:${String(Math.max(i, 5)).padStart(2, "0")}:00Z`)
        yield* h.ingest(production!.key, [visit(`https://example.com/${i}`)], { ip: `198.51.100.${i + 1}` })
      }
      yield* at("2026-03-01T12:00:00Z")

      const first = yield* h.sessions(production!.id, day)
      assert.strictEqual(first.sessions.length, 50)
      assert.isNotNull(first.nextCursor)
      const second = yield* h.sessions(production!.id, day, first.nextCursor!)
      assert.strictEqual(second.nextCursor, null)
      const pages = [...first.sessions, ...second.sessions].map((s) => s.entryPage)
      assert.deepStrictEqual([...pages].sort(), Array.from({ length: 53 }, (_, i) => `/${i}`).sort())
      assert.deepStrictEqual(pages.slice(0, 47), Array.from({ length: 47 }, (_, i) => `/${52 - i}`))
    }))
})

const CHROME_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

layer(Harness.layer({ geoIp: { "198.51.100.1": "DE" } }))("Session timeline", (it) => {
  it.effect("shows where the Session came from and every Event, oldest first", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      const request = { ip: "198.51.100.1", userAgent: CHROME_WINDOWS }
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [
        visit("https://example.com/?utm_source=newsletter&utm_medium=email&utm_campaign=launch", "https://news.ycombinator.com/item")
      ], request)
      yield* at("2026-03-01T09:00:42Z")
      yield* h.ingest(production!.key, [customEvent("signup_clicked", { plan: "pro" })], request)
      yield* at("2026-03-01T09:01:00Z")
      yield* h.ingest(production!.key, [visit("https://example.com/signup")], request)

      yield* at("2026-03-01T09:02:00Z")
      const { sessions: [summary] } = yield* h.sessions(production!.id, day)
      const { timeline, ...header } = yield* h.session(production!.id, summary!.id)
      assert.deepStrictEqual(
        { ...header, startedAt: iso(header.startedAt), lastSeenAt: iso(header.lastSeenAt) },
        {
          id: summary!.id,
          startedAt: "2026-03-01T09:00:00.000Z",
          lastSeenAt: "2026-03-01T09:01:00.000Z",
          duration: 60,
          events: 3,
          bounce: false,
          entryPage: "/",
          lastPage: "/signup",
          referringDomain: "news.ycombinator.com",
          referrer: "https://news.ycombinator.com/item",
          utmSource: "newsletter",
          utmMedium: "email",
          utmCampaign: "launch",
          country: "DE",
          device: "desktop",
          browser: "Chrome",
          os: "Windows",
          visitorId: null,
          visitorIdentified: null,
          earlierSessionId: null,
          laterSessionId: null,
          status: "active",
          truncated: false
        }
      )
      assert.deepStrictEqual(
        timeline.map((e) => ({ name: e.name, at: iso(e.timestamp), matchesFilters: e.matchesFilters })),
        [
          { name: "$pageview", at: "2026-03-01T09:00:00.000Z", matchesFilters: true },
          { name: "signup_clicked", at: "2026-03-01T09:00:42.000Z", matchesFilters: true },
          { name: "$pageview", at: "2026-03-01T09:01:00.000Z", matchesFilters: true }
        ]
      )
      assert.strictEqual(timeline[1]!.properties.plan, "pro")
    }))

  it.effect("a direct Session has no referrer", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [visit("https://example.com/", "https://example.com/other")], { ip: "198.51.100.1" })
      const { sessions: [summary] } = yield* h.sessions(production!.id, day)
      const detail = yield* h.session(production!.id, summary!.id)
      assert.strictEqual(detail.referringDomain, null)
      assert.strictEqual(detail.referrer, null)
    }))

  it.effect("shows the first 1,000 Events of a long Session and says it was cut off", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* at("2026-03-01T09:00:00Z")
      for (let batch = 0; batch < 11; batch++) {
        yield* h.ingest(
          production!.key,
          Array.from({ length: 91 }, (_, i) => ({
            ...customEvent("tick", { n: batch * 91 + i }),
            timestamp: new Date(Date.parse("2026-03-01T09:00:00Z") + (batch * 91 + i) * 1000).toISOString()
          })),
          { ip: "198.51.100.1" }
        )
      }
      yield* at("2026-03-01T10:00:00Z")
      const { sessions: [summary] } = yield* h.sessions(production!.id, day)
      assert.strictEqual(summary!.events, 1001)
      const detail = yield* h.session(production!.id, summary!.id)
      assert.strictEqual(detail.timeline.length, 1000)
      assert.strictEqual(detail.truncated, true)
      assert.strictEqual(detail.timeline[0]!.properties.n, 0)
      assert.strictEqual(detail.timeline[999]!.properties.n, 999)
    }))

  it.effect("an unknown Session, or one from another Environment, is not found", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production, dev] } = yield* h.createProject({ environments: ["dev"] })
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [visit("https://example.com/")], { ip: "198.51.100.1" })
      const { sessions: [summary] } = yield* h.sessions(production!.id, day)

      const unknown = yield* h.session(production!.id, "ses_nope").pipe(Effect.flip)
      assert.strictEqual(unknown._tag, "SessionNotFound")
      const elsewhere = yield* h.session(dev!.id, summary!.id).pipe(Effect.flip)
      assert.strictEqual(elsewhere._tag, "SessionNotFound")
    }))
})

layer(Harness.layer())("Identified Visitors in a Session", (it) => {
  const as = (distinctId: string, event: IngestEvent): IngestEvent => ({ ...event, distinct_id: distinctId })

  it.effect("carries every persistent Visitor's ID and whether they are identified; neither in cookieless mode", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const project = yield* h.createProject({})
      yield* h.client.projects.update({ params: { projectId: project.id }, payload: { trackingMode: "persistent" } })
      const production = project.environments[0]!
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production.key, [as("device-1", visit("https://example.com/"))])
      yield* h.ingest(production.key, [as("device-2", visit("https://example.com/"))])
      yield* at("2026-03-01T09:01:00Z")
      yield* h.ingest(production.key, [as("user_123", customEvent("$identify", { $anon_distinct_id: "device-1" }))])

      const { sessions } = yield* h.sessions(production.id, day)
      const visitors = yield* Effect.forEach(sessions, (s) =>
        h.session(production.id, s.id).pipe(Effect.map((d) => [d.visitorId, d.visitorIdentified])))
      assert.deepStrictEqual(visitors, [["user_123", true], ["device-2", false]])

      yield* h.client.projects.update({ params: { projectId: project.id }, payload: { trackingMode: "cookieless" } })
      const afterSwitch = yield* h.session(production.id, sessions[0]!.id)
      assert.strictEqual(afterSwitch.visitorId, null)
      assert.strictEqual(afterSwitch.visitorIdentified, null)
    }))
})

layer(Harness.layer())("Last page", (it) => {
  it.effect("is the latest Pageview's cleaned path, for a live Session and an ended one", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      // Ended: / then /pricing?plan=pro, then a Custom event (not a Pageview) after it.
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [visit("https://example.com/")], { ip: "198.51.100.1" })
      yield* at("2026-03-01T09:01:00Z")
      yield* h.ingest(production!.key, [visit("https://example.com/pricing?plan=pro#top")], { ip: "198.51.100.1" })
      yield* at("2026-03-01T09:02:00Z")
      yield* h.ingest(production!.key, [customEvent("signup_completed")], { ip: "198.51.100.1" })
      // Live: /blog, then /docs/ a minute ago, still active.
      yield* at("2026-03-01T11:58:00Z")
      yield* h.ingest(production!.key, [visit("https://example.com/blog")], { ip: "198.51.100.2" })
      yield* at("2026-03-01T11:59:00Z")
      yield* h.ingest(production!.key, [visit("https://example.com/docs")], { ip: "198.51.100.2" })
      yield* at("2026-03-01T12:00:00Z")

      const { sessions } = yield* h.sessions(production!.id, day)
      assert.deepStrictEqual(sessions.map((s) => [s.status, s.entryPage, s.lastPage]), [
        ["active", "/blog", "/docs"],
        ["ended", "/", "/pricing"]
      ])
      for (const summary of sessions) {
        const detail = yield* h.session(production!.id, summary.id)
        assert.strictEqual(detail.lastPage, summary.lastPage)
      }
    }))

  it.effect("is empty for a Session without Pageviews", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [customEvent("app_opened")], { ip: "198.51.100.1" })
      yield* at("2026-03-01T09:00:30Z")

      const { sessions: [summary] } = yield* h.sessions(production!.id, day)
      assert.strictEqual(summary!.entryPage, null)
      assert.strictEqual(summary!.lastPage, null)
      const detail = yield* h.session(production!.id, summary!.id)
      assert.strictEqual(detail.lastPage, null)
    }))
})

layer(Harness.layer())("Earlier and Later Session", (it) => {
  const as = (distinctId: string, event: IngestEvent): IngestEvent => ({ ...event, distinct_id: distinctId })

  it.effect("link a persistent Visitor's Sessions in the Environment by start time, also after an Identify; never in cookieless mode", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const project = yield* h.createProject({ environments: ["production", "dev"] })
      yield* h.client.projects.update({ params: { projectId: project.id }, payload: { trackingMode: "persistent" } })
      const [production, dev] = project.environments
      // user_123 on a laptop at 08:00; device-1 at 09:00 and 11:00 (two Sessions); device-2 at 10:00;
      // device-1 in dev at 10:00, which does not count for production.
      yield* at("2026-03-01T08:00:00Z")
      yield* h.ingest(production!.key, [as("user_123", visit("https://example.com/laptop"))])
      yield* at("2026-03-01T09:00:00Z")
      yield* h.ingest(production!.key, [as("device-1", visit("https://example.com/first"))])
      yield* at("2026-03-01T10:00:00Z")
      yield* h.ingest(production!.key, [as("device-2", visit("https://example.com/other"))])
      yield* h.ingest(dev!.key, [as("device-1", visit("https://example.com/dev"))])
      yield* at("2026-03-01T11:00:00Z")
      yield* h.ingest(production!.key, [as("device-1", visit("https://example.com/second"))])
      yield* at("2026-03-01T11:30:00Z")

      const byEntry = Effect.gen(function*() {
        const { sessions } = yield* h.sessions(production!.id, day)
        return new Map(sessions.map((s) => [s.entryPage, s.id]))
      })
      const neighbours = (id: string) =>
        h.session(production!.id, id).pipe(Effect.map((d) => [d.earlierSessionId, d.laterSessionId]))

      let ids = yield* byEntry
      assert.deepStrictEqual(yield* neighbours(ids.get("/first")!), [null, ids.get("/second")!])
      assert.deepStrictEqual(yield* neighbours(ids.get("/second")!), [ids.get("/first")!, null])
      assert.deepStrictEqual(yield* neighbours(ids.get("/other")!), [null, null])
      assert.deepStrictEqual(yield* neighbours(ids.get("/laptop")!), [null, null])

      // device-1 identifies as user_123 at 13:00: its Sessions join user_123's, and the Identify starts one.
      yield* at("2026-03-01T13:00:00Z")
      yield* h.ingest(production!.key, [as("user_123", customEvent("$identify", { $anon_distinct_id: "device-1" }))])
      ids = yield* byEntry
      const chain = [ids.get("/laptop")!, ids.get("/first")!, ids.get("/second")!, ids.get(null)!]
      for (const [i, id] of chain.entries()) {
        assert.deepStrictEqual(yield* neighbours(id), [chain[i - 1] ?? null, chain[i + 1] ?? null])
      }
      assert.deepStrictEqual(yield* neighbours(ids.get("/other")!), [null, null])

      yield* h.client.projects.update({ params: { projectId: project.id }, payload: { trackingMode: "cookieless" } })
      for (const id of chain) assert.deepStrictEqual(yield* neighbours(id), [null, null])
    }))
})

layer(Harness.layer())("A late Event that bridges two Sessions", (it) => {
  const as = (distinctId: string, event: IngestEvent): IngestEvent => ({ ...event, distinct_id: distinctId })
  const stamped = (time: string, event: IngestEvent): IngestEvent => ({ ...event, timestamp: `2026-03-01T${time}:00Z` })
  const request = { ip: "198.51.100.1" }

  /** What the reports say about the day's Sessions, without the Session IDs. */
  const reported = (h: Harness["Service"], environmentId: Parameters<Harness["Service"]["sessions"]>[0]) =>
    Effect.gen(function*() {
      const { sessions } = yield* h.sessions(environmentId, day)
      const details = yield* Effect.forEach(sessions, (s) => h.session(environmentId, s.id))
      const { totals } = yield* h.overview(environmentId, day)
      return {
        sessions: sessions.map(({ id: _, startedAt, lastSeenAt, ...rest }) => ({ startedAt: iso(startedAt), lastSeenAt: iso(lastSeenAt), ...rest })),
        timelines: details.map((d) => d.timeline.map((e) => [iso(e.timestamp), e.properties.$url])),
        linked: details.map((d) => [d.earlierSessionId !== null, d.laterSessionId !== null]),
        totals: { sessions: totals.sessions, bounceRate: totals.bounceRate, visitDuration: totals.visitDuration }
      }
    })

  it.effect("joins them into one Session, as if its Events had arrived in order", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [late] } = yield* h.createProject({})
      const { environments: [inOrder] } = yield* h.createProject({})
      // In order: 10:00, 10:30, 11:00. Late: 10:00 and 11:00 (two Sessions), then the 10:30 one.
      yield* at("2026-03-01T10:00:00Z")
      yield* h.ingest(late!.key, [visit("https://example.com/")], request)
      yield* h.ingest(inOrder!.key, [visit("https://example.com/")], request)
      yield* at("2026-03-01T10:30:00Z")
      yield* h.ingest(inOrder!.key, [visit("https://example.com/pricing")], request)
      yield* at("2026-03-01T11:00:00Z")
      yield* h.ingest(late!.key, [visit("https://example.com/signup")], request)
      yield* h.ingest(inOrder!.key, [visit("https://example.com/signup")], request)
      yield* at("2026-03-01T11:01:00Z")
      assert.deepStrictEqual((yield* reported(h, late!.id)).sessions.map((s) => s.events), [1, 1])
      yield* h.ingest(late!.key, [stamped("10:30", visit("https://example.com/pricing"))], request)

      const joined = yield* reported(h, late!.id)
      assert.deepStrictEqual(joined.sessions.map((s) => [s.startedAt, s.lastSeenAt, s.duration, s.events, s.bounce, s.entryPage, s.lastPage]), [
        ["2026-03-01T10:00:00.000Z", "2026-03-01T11:00:00.000Z", 3600, 3, false, "/", "/signup"]
      ])
      assert.deepStrictEqual(joined.timelines, [[
        ["2026-03-01T10:00:00.000Z", "https://example.com/"],
        ["2026-03-01T10:30:00.000Z", "https://example.com/pricing"],
        ["2026-03-01T11:00:00.000Z", "https://example.com/signup"]
      ]])
      assert.deepStrictEqual(joined.totals, { sessions: 1, bounceRate: 0, visitDuration: 3600 })
      assert.deepStrictEqual(joined, yield* reported(h, inOrder!.id))
    }))

  it.effect("joins them when the Events arrive out of order in one batch", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* at("2026-03-01T11:01:00Z")
      yield* h.ingest(production!.key, [
        stamped("10:00", visit("https://example.com/")),
        stamped("11:00", visit("https://example.com/signup")),
        stamped("10:30", visit("https://example.com/pricing")),
        stamped("10:45", visit("https://example.com/docs"))
      ], request)

      const { sessions, timelines, totals } = yield* reported(h, production!.id)
      assert.deepStrictEqual(sessions.map((s) => [s.events, s.duration]), [[4, 3600]])
      assert.deepStrictEqual(timelines.map((t) => t.map(([, url]) => url)), [[
        "https://example.com/",
        "https://example.com/pricing",
        "https://example.com/docs",
        "https://example.com/signup"
      ]])
      assert.deepStrictEqual(totals, { sessions: 1, bounceRate: 0, visitDuration: 3600 })
    }))

  it.effect("leaves no trace of the Session it absorbed among the Visitor's Earlier and Later Sessions", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const project = yield* h.createProject({})
      yield* h.client.projects.update({ params: { projectId: project.id }, payload: { trackingMode: "persistent" } })
      const production = project.environments[0]!
      // Sessions at 08:00, 10:00 and 11:00; the late 10:30 Event joins the last two.
      for (const time of ["08:00", "10:00", "11:00"]) {
        yield* at(`2026-03-01T${time}:00Z`)
        yield* h.ingest(production.key, [as("device-1", visit(`https://example.com/${time}`))])
      }
      yield* at("2026-03-01T11:01:00Z")
      yield* h.ingest(production.key, [as("device-1", stamped("10:30", visit("https://example.com/late")))])

      const { sessions } = yield* h.sessions(production.id, day)
      assert.deepStrictEqual(sessions.map((s) => [s.entryPage, s.events]), [["/10:00", 3], ["/08:00", 1]])
      const [joined, first] = sessions
      const neighbours = (id: string) =>
        h.session(production.id, id).pipe(Effect.map((d) => [d.earlierSessionId, d.laterSessionId]))
      assert.deepStrictEqual(yield* neighbours(joined!.id), [first!.id, null])
      assert.deepStrictEqual(yield* neighbours(first!.id), [null, joined!.id])
    }))

  it.effect("does not join another Visitor's Sessions, or the same Visitor's in another Environment", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production, dev] } = yield* h.createProject({ environments: ["production", "dev"] })
      // In production, one Visitor at 10:00 and another at 11:00; the first is also in dev at 11:00.
      yield* at("2026-03-01T10:00:00Z")
      yield* h.ingest(production!.key, [visit("https://example.com/")], request)
      yield* at("2026-03-01T11:00:00Z")
      yield* h.ingest(production!.key, [visit("https://example.com/other")], { ip: "198.51.100.2" })
      yield* h.ingest(dev!.key, [visit("https://example.com/dev")], request)
      yield* at("2026-03-01T11:01:00Z")
      yield* h.ingest(production!.key, [stamped("10:30", visit("https://example.com/pricing"))], request)

      const { sessions } = yield* h.sessions(production!.id, day)
      assert.deepStrictEqual(sessions.map((s) => [s.entryPage, s.events]), [["/other", 1], ["/", 2]])
      assert.deepStrictEqual((yield* h.sessions(dev!.id, day)).sessions.map((s) => [s.entryPage, s.events]), [["/dev", 1]])
    }))

  it.effect("that bridges nothing joins the one Session within 30 minutes of it, or starts its own", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* at("2026-03-01T10:00:00Z")
      yield* h.ingest(production!.key, [visit("https://example.com/")], request)
      yield* at("2026-03-01T12:00:00Z")
      yield* h.ingest(production!.key, [visit("https://example.com/back")], request)
      yield* at("2026-03-01T12:01:00Z")
      // 10:20 is near the first Session only; 11:00 is more than 30 minutes from both.
      yield* h.ingest(production!.key, [stamped("10:20", visit("https://example.com/pricing"))], request)
      yield* h.ingest(production!.key, [stamped("11:00", visit("https://example.com/alone"))], request)

      const { sessions, totals } = yield* reported(h, production!.id)
      assert.deepStrictEqual(sessions.map((s) => [s.entryPage, s.events, s.duration]), [
        ["/back", 1, 0],
        ["/alone", 1, 0],
        ["/", 2, 1200]
      ])
      assert.deepStrictEqual(totals, { sessions: 3, bounceRate: 2 / 3, visitDuration: 400 })
    }))
})
