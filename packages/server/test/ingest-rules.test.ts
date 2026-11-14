// Ingest rules: limits and reserved names, dedupe by Event UUID, client timestamps,
// allowed origins per Environment, and bot dropping. Observed only through the HTTP API.
import { assert, describe, it, layer } from "@effect/vitest"
import type { EnvironmentId, IngestResult } from "@flock/shared"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import { isPrivateHost } from "../src/ingest-rules.ts"
import { customEvent, type Harness as HarnessT, Harness, pageview } from "./harness.ts"

type H = HarnessT["Service"]

const allTime = { from: "2020-01-01T00:00:00Z", to: "2030-01-01T00:00:00Z" }

/** POSTs a batch like any HTTP client would, with the given headers (no cookies). */
const send = (h: H, key: string, events: ReadonlyArray<unknown>, headers: Record<string, string> = {}) =>
  Effect.promise(async () => {
    const response = await h.fetch("/api/ingest", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ key, events })
    })
    return { status: response.status, body: (await response.json()) as IngestResult & { _tag?: string } }
  })

const count = (h: H, environmentId: EnvironmentId) => h.pageviewCount(environmentId, allTime)

layer(Harness.layer())("Ingest limits and reserved names", (it) => {
  it.effect("a batch with some invalid Events stores the valid ones and gives a reason for each rejected one", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      const tooLong = { ...pageview(), name: "x".repeat(201) }
      const notAUuid = { ...pageview(), uuid: "not-a-uuid" }
      const ok = [pageview(), pageview()]

      const { body, status } = yield* send(h, production!.key, [ok[0], tooLong, notAUuid, ok[1]])
      assert.strictEqual(status, 200)
      assert.strictEqual(body.accepted, 2)
      assert.deepStrictEqual(body.rejected.map((r) => [r.index, r.uuid]), [[1, tooLong.uuid], [2, "not-a-uuid"]])
      assert.match(body.rejected[0]!.reason, /200/)
      assert.match(body.rejected[1]!.reason, /uuid/i)
      assert.strictEqual(yield* count(h, production!.id), 2)
    }))

  it.effect("enforces each limit: 50 Event properties, 8 KB of JSON, 200-character names", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      const props = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i}`, i]))

      const cases = [
        { event: customEvent("many", props(51)), reason: /50/ },
        { event: customEvent("big", { blob: "x".repeat(8 * 1024) }), reason: /8 KB/ },
        { event: customEvent("n".repeat(201)), reason: /200/ },
        { event: customEvent("long_property", { ["k".repeat(201)]: 1 }), reason: /200/ }
      ]
      const { body } = yield* send(h, production!.key, cases.map((c) => c.event))
      assert.strictEqual(body.accepted, 0)
      assert.strictEqual(body.rejected.length, cases.length)
      cases.forEach((c, i) => assert.match(body.rejected[i]!.reason, c.reason))

      const atLimits = [
        customEvent("many", props(50)),
        customEvent("n".repeat(200), { ["k".repeat(200)]: 1 }),
        customEvent("big", { blob: "x".repeat(7 * 1024) })
      ]
      const fine = yield* send(h, production!.key, atLimits)
      assert.deepStrictEqual(fine.body, { accepted: 3, rejected: [] })
    }))

  it.effect("rejects the reserved $ prefix in Custom event names and in Event property names Flock doesn't define", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      const { body } = yield* send(h, production!.key, [
        customEvent("$login"),
        customEvent("game_completed", { $score: 34 }),
        pageview({ $mine: 1 }),
        pageview({ $referrer: "https://news.example/" }),
        // The browser script adds $url to every Event, Custom events included.
        customEvent("game_completed", { score: 34, $url: "https://example.com/play" })
      ])
      assert.strictEqual(body.accepted, 2)
      assert.deepStrictEqual(body.rejected.map((r) => r.index), [0, 1, 2])
      for (const r of body.rejected) assert.match(r.reason, /\$/)
      assert.strictEqual(yield* count(h, production!.id), 1)
    }))

  it.effect("refuses a request that isn't a batch at all", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const response = yield* Effect.promise(() =>
        h.fetch("/api/ingest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ events: "nope" }) })
      )
      assert.strictEqual(response.status, 400)
    }))
})

layer(Harness.layer())("Ingest dedupe and timestamps", (it) => {
  it.effect("sending the same Event UUID twice stores one Event", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      const event = pageview()
      yield* TestClock.setTime(Date.parse("2026-03-01T10:00:00Z"))
      const first = yield* send(h, production!.key, [event, event])
      assert.deepStrictEqual(first.body, { accepted: 1, rejected: [] })
      // A retry the next day still counts as accepted, but isn't stored again.
      yield* TestClock.setTime(Date.parse("2026-03-02T10:00:00Z"))
      const retry = yield* send(h, production!.key, [event])
      assert.deepStrictEqual(retry.body, { accepted: 1, rejected: [] })
      assert.strictEqual(yield* count(h, production!.id), 1)
    }))

  it.effect("the same UUID in two Environments is two Events", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production, dev] } = yield* h.createProject({ environments: ["dev"] })
      const event = pageview()
      yield* send(h, production!.key, [event])
      yield* send(h, dev!.key, [event])
      assert.strictEqual(yield* count(h, production!.id), 1)
      assert.strictEqual(yield* count(h, dev!.id), 1)
    }))

  it.effect("keeps a client timestamp up to 24h old; uses the receive time for older or future ones", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      const at = (timestamp: string) => ({ ...pageview(), timestamp })
      yield* TestClock.setTime(Date.parse("2026-03-10T12:00:00Z"))
      const { body } = yield* send(h, production!.key, [
        at("2026-03-09T12:00:00Z"), // exactly 24h old: kept (March 9)
        at("2026-03-10T01:00:00Z"), // kept (March 10, early)
        at("2026-03-09T11:59:59Z"), // older than 24h: receive time
        at("2026-03-10T12:00:01Z"), // in the future: receive time
        at("yesterday") // unparseable: receive time
      ])
      assert.strictEqual(body.accepted, 5)
      const range = (from: string, to: string) => h.pageviewCount(production!.id, { from, to })
      assert.strictEqual(yield* range("2026-03-09T12:00:00Z", "2026-03-09T12:00:01Z"), 1)
      assert.strictEqual(yield* range("2026-03-10T01:00:00Z", "2026-03-10T01:00:01Z"), 1)
      assert.strictEqual(yield* range("2026-03-10T12:00:00Z", "2026-03-10T12:00:01Z"), 3)
    }))

  it.effect("a deleted Environment's Events can be sent again with the same UUIDs", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [, dev] } = yield* h.createProject({ environments: ["dev"] })
      const event = pageview()
      yield* send(h, dev!.key, [event])
      yield* h.client.environments.deleteEvents({ params: { environmentId: dev!.id } })
      yield* send(h, dev!.key, [event])
      assert.strictEqual(yield* count(h, dev!.id), 1)
    }))
})

layer(Harness.layer())("Ingest origins", (it) => {
  const fromOrigin = (h: H, key: string, origin: string) => send(h, key, [pageview()], { origin })

  it.effect("production rejects localhost and private-network origins by default, and accepts public ones", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      assert.deepStrictEqual(production!.allowedOrigins, [])
      for (const origin of ["http://localhost:3000", "http://127.0.0.1:8080", "http://192.168.1.20", "http://10.0.0.5", "https://box.tail1234.ts.net", "http://[::1]:3000", "null"]) {
        const { body, status } = yield* fromOrigin(h, production!.key, origin)
        assert.strictEqual(status, 403, origin)
        assert.strictEqual(body._tag, "OriginNotAllowed", origin)
      }
      assert.strictEqual((yield* fromOrigin(h, production!.key, "https://blog.example.com")).status, 200)
      // Requests without an Origin (servers, native apps) aren't browser requests.
      assert.strictEqual((yield* send(h, production!.key, [pageview()])).status, 200)
      assert.strictEqual(yield* count(h, production!.id), 2)
    }))

  it.effect("production judges IPv6 literal origins by address: public ones pass, loopback, link-local and private ones don't", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      for (const origin of ["https://[2606:4700:4700::1111]", "http://[2a00:1450:4001:82a::200e]:8080"]) {
        assert.strictEqual((yield* fromOrigin(h, production!.key, origin)).status, 200, origin)
      }
      const rejected = [
        "http://[::1]:3000", // loopback
        "http://[::]", // unspecified
        "http://[fe80::1ff:fe23:4567:890a]", // link-local
        "http://[febf::1]",
        "http://[fd12:3456:789a::1]", // unique local
        "http://[fc00::1]",
        "http://[::ffff:192.168.1.20]", // IPv4-mapped private and loopback addresses
        "http://[::ffff:127.0.0.1]",
        "http://[::ffff:a00:5]", // ::ffff:10.0.0.5 in hex
        "http://[::ffff:100.100.1.1]" // carrier-grade NAT, Tailscale
      ]
      for (const origin of rejected) {
        const { body, status } = yield* fromOrigin(h, production!.key, origin)
        assert.strictEqual(status, 403, origin)
        assert.strictEqual(body._tag, "OriginNotAllowed", origin)
      }
      // An IPv4-mapped address is as public as the IPv4 address it maps.
      assert.strictEqual((yield* fromOrigin(h, production!.key, "http://[::ffff:8.8.8.8]")).status, 200)
    }))

  it.effect("production rejects IPv6 literal origins that embed a private IPv4 address, and site-local and multicast ones", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      const rejected = [
        "http://[::7f00:1]", // IPv4-compatible ::127.0.0.1
        "http://[::a00:1]", // IPv4-compatible ::10.0.0.1
        "http://[::ffff:0:7f00:1]", // IPv4-translated ::ffff:0:127.0.0.1
        "http://[64:ff9b::a00:1]", // NAT64 of 10.0.0.1
        "http://[64:ff9b:1::a00:1]", // local-use NAT64
        "http://[2002:c0a8:101::1]", // 6to4 of 192.168.1.1
        "http://[fec0::1]", // site-local
        "http://[feff::1]",
        "http://[ff02::1]" // multicast
      ]
      for (const origin of rejected) {
        const { body, status } = yield* fromOrigin(h, production!.key, origin)
        assert.strictEqual(status, 403, origin)
        assert.strictEqual(body._tag, "OriginNotAllowed", origin)
      }
      // An embedded IPv4 address is as public as it is on its own.
      for (const origin of ["http://[64:ff9b::808:808]", "http://[2002:808:808::1]"]) {
        assert.strictEqual((yield* fromOrigin(h, production!.key, origin)).status, 200, origin)
      }
    }))

  it.effect("a new non-production Environment accepts localhost and *.ts.net, and nothing else", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [, dev] } = yield* h.createProject({ environments: ["dev"] })
      assert.deepStrictEqual(dev!.allowedOrigins, ["localhost", "*.ts.net"])
      for (const origin of ["http://localhost:5173", "https://hel.tail1234.ts.net"]) {
        assert.strictEqual((yield* fromOrigin(h, dev!.key, origin)).status, 200, origin)
      }
      for (const origin of ["https://blog.example.com", "https://ts.net.evil.example", "http://192.168.1.20"]) {
        assert.strictEqual((yield* fromOrigin(h, dev!.key, origin)).status, 403, origin)
      }
      assert.strictEqual(yield* count(h, dev!.id), 2)
    }))

  it.effect("a Project owner edits an Environment's allowed origins", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      const updated = yield* h.client.environments.update({
        params: { environmentId: production!.id },
        payload: { allowedOrigins: ["blog.example.com", "*.example.org", "localhost"] }
      })
      assert.deepStrictEqual(updated.allowedOrigins, ["blog.example.com", "*.example.org", "localhost"])

      assert.strictEqual((yield* fromOrigin(h, production!.key, "https://blog.example.com")).status, 200)
      assert.strictEqual((yield* fromOrigin(h, production!.key, "https://www.example.org")).status, 200)
      assert.strictEqual((yield* fromOrigin(h, production!.key, "http://localhost:3000")).status, 200)
      assert.strictEqual((yield* fromOrigin(h, production!.key, "https://other.example.com")).status, 403)

      const reloaded = (yield* h.client.projects.list()).flatMap((p) => p.environments).find((e) => e.id === production!.id)
      assert.deepStrictEqual(reloaded?.allowedOrigins, ["blog.example.com", "*.example.org", "localhost"])
    }))

  it.effect("refuses malformed allowed origins", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      for (const origin of ["https://", "bad host", "a/b"]) {
        const response = yield* Effect.promise(() =>
          h.admin.fetch(`/api/environments/${production!.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ allowedOrigins: [origin] })
          })
        )
        assert.strictEqual(response.status, 400, origin)
      }
    }))
})

layer(Harness.layer())("Ingest bots", (it) => {
  it.effect("drops Events from bots and headless browsers without storing them", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({})
      const agents = [
        "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
        "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
        "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) PhantomJS/2.1.1 Safari/538.1"
      ]
      for (const ua of agents) {
        const { body, status } = yield* send(h, production!.key, [pageview()], { "user-agent": ua })
        assert.strictEqual(status, 200, ua)
        assert.strictEqual(body.accepted, 0, ua)
      }
      assert.strictEqual(yield* count(h, production!.id), 0)

      const person = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15"
      assert.strictEqual((yield* send(h, production!.key, [pageview()], { "user-agent": person })).body.accepted, 1)
      assert.strictEqual(yield* count(h, production!.id), 1)
    }))
})

describe("Private hosts", () => {
  it("treats a bracketed host that isn't an IPv6 address as private instead of throwing", () => {
    for (const host of ["[1:2:3:4:5::6:7:8:9]", "[1:2:3:4:5:6:7:8:9]", "[1::2::3]", "[g::1]", "[]", "[:::]"]) {
      assert.strictEqual(isPrivateHost(host), true, host)
    }
  })
})
