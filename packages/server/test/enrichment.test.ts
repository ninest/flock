import { assert, layer } from "@effect/vitest"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { customEvent, Harness, pageview } from "./harness.ts"

const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1"
const FIREFOX_ANDROID_TABLET = "Mozilla/5.0 (Android 14; Tablet; rv:132.0) Gecko/132.0 Firefox/132.0"

const day = { from: "2026-03-01T00:00:00Z", to: "2026-03-02T00:00:00Z" }

const geoIp = {
  "203.0.113.7": { country: "DE", region: "Berlin" },
  "198.51.100.23": { country: "US", region: "California" },
  "2001:db8::1": { country: "FR" }
}

layer(Harness.layer({ geoIp }))("Enrichment", (it) => {
  it.effect("derives country, region, browser, OS and device for the audience reports", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      const { key, id } = production!
      yield* TestClock.setTime(Date.parse("2026-03-01T10:00:00Z"))

      yield* h.ingest(key, [pageview(), pageview()], { ip: "203.0.113.7", userAgent: CHROME_WINDOWS })
      yield* h.ingest(key, [pageview(), customEvent("signup")], { ip: "198.51.100.23", userAgent: SAFARI_IPHONE })
      yield* h.ingest(key, [pageview()], { ip: "2001:db8::1", userAgent: FIREFOX_ANDROID_TABLET })

      // Audience reports count Pageviews only.
      assert.deepStrictEqual(yield* h.breakdown(id, "$country", day), [
        { value: "DE", count: 2 },
        { value: "FR", count: 1 },
        { value: "US", count: 1 }
      ])
      assert.deepStrictEqual(yield* h.breakdown(id, "$region", day), [
        { value: "Berlin", count: 2 },
        { value: "California", count: 1 },
        { value: null, count: 1 }
      ])
      assert.deepStrictEqual(yield* h.breakdown(id, "$browser", day), [
        { value: "Chrome", count: 2 },
        { value: "Firefox", count: 1 },
        { value: "Safari", count: 1 }
      ])
      assert.deepStrictEqual(yield* h.breakdown(id, "$os", day), [
        { value: "Windows", count: 2 },
        { value: "Android", count: 1 },
        { value: "iOS", count: 1 }
      ])
      assert.deepStrictEqual(yield* h.breakdown(id, "$device", day), [
        { value: "desktop", count: 2 },
        { value: "mobile", count: 1 },
        { value: "tablet", count: 1 }
      ])
    }))

  it.effect("uses the first address in X-Forwarded-For and leaves unknown values empty", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* TestClock.setTime(Date.parse("2026-03-01T10:00:00Z"))

      yield* h.ingest(production!.key, [pageview()], { ip: "203.0.113.7, 10.0.0.1" })
      yield* h.ingest(production!.key, [pageview()], { ip: "192.0.2.99" })
      yield* h.ingest(production!.key, [pageview()], {})

      assert.deepStrictEqual(yield* h.breakdown(production!.id, "$country", day), [
        { value: null, count: 2 },
        { value: "DE", count: 1 }
      ])
      assert.deepStrictEqual(yield* h.breakdown(production!.id, "$browser", day), [{ value: null, count: 3 }])
    }))

  it.effect("ignores audience properties sent by the client", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* TestClock.setTime(Date.parse("2026-03-01T10:00:00Z"))

      yield* h.ingest(
        production!.key,
        [pageview({ $country: "JP", $region: "Tokyo", $browser: "Netscape", $os: "BeOS", $device: "tv" })],
        { ip: "203.0.113.7", userAgent: CHROME_WINDOWS }
      )

      for (const [property, value] of [["$country", "DE"], ["$region", "Berlin"], ["$browser", "Chrome"], ["$os", "Windows"], ["$device", "desktop"]]) {
        assert.deepStrictEqual(yield* h.breakdown(production!.id, property!, day), [{ value: value!, count: 1 }])
      }
    }))

  it.effect("strips query strings from URLs except utm_* parameters", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* TestClock.setTime(Date.parse("2026-03-01T10:00:00Z"))

      yield* h.ingest(production!.key, [
        pageview({
          $url: "https://example.com/reset?token=s3cret&utm_source=newsletter&email=a%40b.c&utm_campaign=fall#step-2",
          $referrer: "https://mail.example.org/inbox?session=abc123&utm_medium=email"
        }),
        pageview({ $url: "https://example.com/pricing?plan=pro", $referrer: "" }),
        pageview({ $url: "not a url?token=s3cret" })
      ], {})

      assert.deepStrictEqual(yield* h.breakdown(production!.id, "$url", day), [
        { value: "https://example.com/pricing", count: 1 },
        { value: "https://example.com/reset?utm_source=newsletter&utm_campaign=fall#step-2", count: 1 },
        { value: "not a url", count: 1 }
      ])
      assert.deepStrictEqual(yield* h.breakdown(production!.id, "$referrer", day), [
        { value: "", count: 1 },
        { value: "https://mail.example.org/inbox?utm_medium=email", count: 1 },
        { value: null, count: 1 }
      ])
    }))

  it.effect("never stores the request IP", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      yield* TestClock.setTime(Date.parse("2026-03-01T10:00:00Z"))
      const ips = ["198.51.100.23", "2001:db8::1", "192.0.2.99"]

      for (const ip of ips) {
        yield* h.ingest(production!.key, [pageview({ plan: "pro" }), customEvent("signup", { step: 2 })], {
          ip,
          userAgent: SAFARI_IPHONE
        })
      }

      const keys = yield* h.propertyKeys(production!.id, day)
      assert.includeMembers([...keys], ["$url", "$country", "$browser", "$os", "$device", "plan", "step"])
      for (const property of keys) {
        for (const event of ["$pageview", "signup"]) {
          const rows = yield* h.breakdown(production!.id, property, day, event)
          for (const ip of ips) {
            assert.notInclude(JSON.stringify(rows), ip, `${property} on ${event} holds ${ip}`)
          }
        }
      }
      assert.notInclude(JSON.stringify(keys), "198.51.100.23")
    }))
})
