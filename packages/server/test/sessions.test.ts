// Recent sessions and the Session timeline, observed through the reports API.
import { assert, layer } from "@effect/vitest"
import type { IngestEvent } from "@flock/shared"
import { DateTime, Effect } from "effect"
import { TestClock } from "effect/testing"
import { customEvent, Harness, pageview } from "./harness.ts"

const at = (iso: string) => TestClock.setTime(Date.parse(iso))
const day = { period: "custom" as const, from: "2026-03-01", to: "2026-03-01" }
const visit = (url: string, referrer?: string): IngestEvent =>
  pageview(referrer === undefined ? { $url: url } : { $url: url, $referrer: referrer })
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
      // Visitor 2: a single direct Pageview, later.
      yield* at("2026-03-01T10:00:00Z")
      yield* h.ingest(production!.key, [visit("https://example.com/blog")], { ip: "198.51.100.2" })

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

  it.effect("shows the Visitor ID only once the Visitor is identified", () =>
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
      const visitorIds = yield* Effect.forEach(sessions, (s) => h.session(production.id, s.id).pipe(Effect.map((d) => d.visitorId)))
      assert.deepStrictEqual(visitorIds, ["user_123", null])

      yield* h.client.projects.update({ params: { projectId: project.id }, payload: { trackingMode: "cookieless" } })
      const afterSwitch = yield* h.session(production.id, sessions[0]!.id)
      assert.strictEqual(afterSwitch.visitorId, null)
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
