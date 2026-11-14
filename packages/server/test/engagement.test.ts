// Bounce rate, "Left from here" and time on page in the breakdowns, from hand-built Sessions.
import { assert, layer } from "@effect/vitest"
import type { EventPropertyFilter, IngestEvent } from "@flock/shared"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { customEvent, Harness, pageview } from "./harness.ts"

const at = (iso: string) => TestClock.setTime(Date.parse(iso))
const day = (filters?: ReadonlyArray<EventPropertyFilter>) => ({
  period: "custom" as const,
  from: "2026-03-01",
  to: "2026-03-01",
  ...(filters ? { filters } : {})
})
const visit = (path: string, referrer?: string): IngestEvent =>
  pageview(referrer === undefined ? { $url: `https://example.com${path}` } : { $url: `https://example.com${path}`, $referrer: referrer })

const DE = "203.0.113.7"
const US = "198.51.100.23"
const geoIp = { [DE]: "DE", [US]: "US" }
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1"

layer(Harness.layer({ geoIp }))("Engagement on pages", (it) => {
  it.effect("Pages carry bounce rate by entry, Left from here and time on page", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      const send = (ip: string, ...events: ReadonlyArray<IngestEvent>) => h.ingest(production!.key, events, { ip })
      // Session 1: / -> /pricing (60s later) -> /signup (120s later).
      yield* at("2026-03-01T09:00:00Z")
      yield* send("198.51.100.1", visit("/"))
      yield* at("2026-03-01T09:01:00Z")
      yield* send("198.51.100.1", visit("/pricing"))
      yield* at("2026-03-01T09:03:00Z")
      yield* send("198.51.100.1", visit("/signup"))
      // Session 2: a Bounce on /.
      yield* at("2026-03-01T09:00:00Z")
      yield* send("198.51.100.2", visit("/"))
      // Session 3: /pricing -> / (120s later).
      yield* send("198.51.100.3", visit("/pricing"))
      yield* at("2026-03-01T09:02:00Z")
      yield* send("198.51.100.3", visit("/"))
      // Session 4: a Bounce on /pricing.
      yield* at("2026-03-01T10:00:00Z")
      yield* send("198.51.100.4", visit("/pricing"))
      // Session 5: /pricing then a Custom event: not a Bounce, and /pricing is still its last Pageview.
      yield* at("2026-03-01T11:00:00Z")
      yield* send("198.51.100.5", visit("/pricing"))
      yield* at("2026-03-01T11:05:00Z")
      yield* send("198.51.100.5", customEvent("signup_clicked"))

      assert.deepStrictEqual((yield* h.top(production!.id, "pages", day())).rows, [
        // Entered by Sessions 3, 4, 5 (one Bounce); left from 2 of 4 Pageviews; 120s in Sessions 1 and 3.
        { value: "/pricing", visitors: 4, pageviews: 4, bounceRate: 1 / 3, exitRate: 0.5, timeOnPage: 120 },
        // Entered by Sessions 1, 2 (one Bounce); left from 2 of 3; 60s in Session 1 only.
        { value: "/", visitors: 3, pageviews: 3, bounceRate: 0.5, exitRate: 2 / 3, timeOnPage: 60 },
        // Never an entry, always the last Pageview: nothing counts toward bounce rate or time on page.
        { value: "/signup", visitors: 1, pageviews: 1, bounceRate: null, exitRate: 1, timeOnPage: null }
      ])
    }))

  it.effect("the date range and Filters apply", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      const send = (ip: string, ...events: ReadonlyArray<IngestEvent>) => h.ingest(production!.key, events, { ip })
      // DE: / -> /pricing (30s later). US: a Bounce on /.
      yield* at("2026-03-01T09:00:00Z")
      yield* send(DE, visit("/"))
      yield* send(US, visit("/"))
      yield* at("2026-03-01T09:00:30Z")
      yield* send(DE, visit("/pricing"))
      // The next day, outside the range: another Bounce on / from DE.
      yield* at("2026-03-02T09:00:00Z")
      yield* send(DE, visit("/"))

      assert.deepStrictEqual((yield* h.top(production!.id, "pages", day())).rows, [
        { value: "/", visitors: 2, pageviews: 2, bounceRate: 0.5, exitRate: 0.5, timeOnPage: 30 },
        { value: "/pricing", visitors: 1, pageviews: 1, bounceRate: null, exitRate: 1, timeOnPage: null }
      ])
      const us = day([{ eventProperty: "$country", op: "is", value: "US" }])
      assert.deepStrictEqual((yield* h.top(production!.id, "pages", us)).rows, [
        { value: "/", visitors: 1, pageviews: 1, bounceRate: 1, exitRate: 1, timeOnPage: null }
      ])
    }))

  it.effect("a $path Filter counts a page's Pageviews but reads the rest of their Sessions for its columns", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      const send = (ip: string, ...events: ReadonlyArray<IngestEvent>) => h.ingest(production!.key, events, { ip })
      // Session 1: / -> /pricing (60s later) -> /signup (120s later).
      yield* at("2026-03-01T09:00:00Z")
      yield* send("198.51.100.1", visit("/"))
      yield* at("2026-03-01T09:01:00Z")
      yield* send("198.51.100.1", visit("/pricing"))
      yield* at("2026-03-01T09:03:00Z")
      yield* send("198.51.100.1", visit("/signup"))
      // Session 2: enters on /pricing, then a Custom event: not a Bounce, and left from /pricing.
      yield* at("2026-03-01T10:00:00Z")
      yield* send("198.51.100.2", visit("/pricing"))
      yield* at("2026-03-01T10:05:00Z")
      yield* send("198.51.100.2", customEvent("signup_clicked"))

      // Entered by Session 2 only (no Bounce); left from 1 of 2 Pageviews; 120s in Session 1.
      const pricing = { value: "/pricing", visitors: 2, pageviews: 2, bounceRate: 0, exitRate: 0.5, timeOnPage: 120 }
      const rows = (yield* h.top(production!.id, "pages", day())).rows
      assert.deepStrictEqual(rows.find((row) => row.value === "/pricing"), pricing)
      const onPricing = day([{ eventProperty: "$path", op: "is", value: "/pricing" }])
      assert.deepStrictEqual((yield* h.top(production!.id, "pages", onPricing)).rows, [pricing])
    }))

  it.effect("a Filter chooses Sessions, but whether one is a Bounce reads all its Events", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      const send = (ip: string, ...events: ReadonlyArray<IngestEvent>) => h.ingest(production!.key, events, { ip })
      // On Feb 28 (the previous period) and on Mar 1: / -> /pricing, one Session each; only one
      // of its Events is on /pricing.
      for (const date of ["2026-02-28", "2026-03-01"]) {
        yield* at(`${date}T09:00:00Z`)
        yield* send("198.51.100.1", visit("/"))
        yield* at(`${date}T09:01:00Z`)
        yield* send("198.51.100.1", visit("/pricing"))
      }

      const onPricing = day([{ eventProperty: "$path", op: "is", value: "/pricing" }])
      const overview = yield* h.overview(production!.id, onPricing)
      assert.deepStrictEqual([overview.totals.sessions, overview.totals.bounceRate], [1, 0])
      assert.deepStrictEqual([overview.previous.totals.sessions, overview.previous.totals.bounceRate], [1, 0])
      assert.deepStrictEqual(overview.series.find((b) => b.sessions > 0)?.bounceRate, 0)
      assert.deepStrictEqual((yield* h.top(production!.id, "entryPages", onPricing)).rows, [
        { value: "/pricing", visitors: 1, bounceRate: 0 }
      ])
    }))
})

layer(Harness.layer({ geoIp }))("Engagement on sources and devices", (it) => {
  it.effect("referrer, UTM, entry page and device rows carry the share of their Sessions that are a Bounce", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      const send = (ip: string, userAgent: string | undefined, ...events: ReadonlyArray<IngestEvent>) =>
        h.ingest(production!.key, events, userAgent === undefined ? { ip } : { ip, userAgent })
      const hn = "https://news.ycombinator.com/"
      yield* at("2026-03-01T09:00:00Z")
      // From Hacker News, newsletter-tagged: one Bounce (on a phone), one Session that goes on.
      yield* send("198.51.100.1", SAFARI_IPHONE, visit("/?utm_source=newsletter", hn))
      yield* send("198.51.100.2", undefined, visit("/?utm_source=newsletter", hn))
      // Direct: two Bounces (one on a phone) and one Session that goes on.
      yield* send("198.51.100.3", SAFARI_IPHONE, visit("/pricing"))
      yield* send("198.51.100.4", undefined, visit("/pricing"))
      yield* send("198.51.100.5", undefined, visit("/pricing"))
      yield* at("2026-03-01T09:01:00Z")
      yield* send("198.51.100.2", undefined, visit("/pricing"))
      yield* send("198.51.100.5", undefined, customEvent("signup_clicked"))

      const rows = (report: "referrers" | "utmSources" | "entryPages" | "devices") =>
        h.top(production!.id, report, day()).pipe(Effect.map((top) => top.rows))
      assert.deepStrictEqual(yield* rows("referrers"), [
        { value: null, visitors: 3, bounceRate: 2 / 3 },
        { value: "news.ycombinator.com", visitors: 2, bounceRate: 0.5 }
      ])
      assert.deepStrictEqual(yield* rows("utmSources"), [{ value: "newsletter", visitors: 2, bounceRate: 0.5 }])
      assert.deepStrictEqual(yield* rows("entryPages"), [
        { value: "/pricing", visitors: 3, bounceRate: 2 / 3 },
        { value: "/", visitors: 2, bounceRate: 0.5 }
      ])
      // The harness's default browser has no device; the phones are both Bounces.
      assert.deepStrictEqual(yield* rows("devices"), [
        { value: null, visitors: 3, bounceRate: 1 / 3 },
        { value: "mobile", visitors: 2, bounceRate: 1 }
      ])
    }))
})
