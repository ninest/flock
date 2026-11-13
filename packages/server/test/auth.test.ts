import { assert, layer } from "@effect/vitest"
import { Effect } from "effect"
import { BASE_URL, type Browser, Harness, pageview } from "./harness.ts"

const get = (h: Harness["Service"], path: string) => Effect.promise(() => h.fetch(path))

layer(Harness.layer())("Query API auth", (it) => {
  it.effect("rejects requests without a signed-in Member", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({ environments: ["production"] })
      for (
        const path of [
          "/api/projects",
          `/api/environments/${production!.id}/pageviews?from=2026-03-01T00:00:00Z&to=2026-03-02T00:00:00Z`
        ]
      ) {
        const response = yield* get(h, path)
        assert.strictEqual(response.status, 401, path)
        const body = (yield* Effect.promise(() => response.json())) as { _tag: string }
        assert.strictEqual(body._tag, "Unauthorized")
      }
    }))
})

layer(Harness.layer({ adminEmail: "owner@example.com" }))("Admin bootstrap and sign-up", (it) => {
  it.effect("signing up with FLOCK_ADMIN_EMAIL and a password is refused while sign-up is closed", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const browser = yield* h.browser()
      const response = yield* browser.signUp({ email: "Owner@Example.com", password: "correct horse battery", name: "Owner" })
      assert.strictEqual(response.status, 403)
      const body = (yield* Effect.promise(() => response.json())) as { code: string }
      assert.strictEqual(body.code, "SIGN_UP_CLOSED")
      const me = yield* Effect.promise(() => browser.fetch("/api/me"))
      assert.strictEqual(me.status, 401)
    }))

  it.effect("a password sign-up with FLOCK_ADMIN_EMAIL during Open sign-up is an ordinary Member", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      yield* h.client.instance.updateSettings({ payload: { openSignUp: true } })
      const browser = yield* h.browser()
      const response = yield* browser.signUp({ email: "owner@example.com", password: "correct horse battery", name: "Owner" })
      yield* h.client.instance.updateSettings({ payload: { openSignUp: false } })
      assert.strictEqual(response.status, 200)
      assert.isFalse((yield* browser.client.members.me()).isAdmin)

      yield* browser.auth("/sign-out")
      yield* browser.signIn({ email: "owner@example.com", password: "correct horse battery" })
      assert.isFalse((yield* browser.client.members.me()).isAdmin)
    }))

  it.effect("signing up with any other email is rejected", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const browser = yield* h.browser()
      const response = yield* browser.signUp({ email: "stranger@example.com", password: "correct horse battery" })
      assert.strictEqual(response.status, 403)
      const body = (yield* Effect.promise(() => response.json())) as { code: string; message: string }
      assert.strictEqual(body.code, "SIGN_UP_CLOSED")
      assert.include(body.message, "Invite")

      const me = yield* Effect.promise(() => browser.fetch("/api/me"))
      assert.strictEqual(me.status, 401)
      const signIn = yield* browser.signIn({ email: "stranger@example.com", password: "correct horse battery" })
      assert.strictEqual(signIn.status, 401)
    }))

  it.effect("the ingest API needs only the Environment's key, no session", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { environments: [production] } = yield* h.createProject({ environments: ["production"] })
      const response = yield* Effect.promise(() =>
        h.fetch("/api/ingest", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key: production!.key, events: [pageview()] })
        })
      )
      assert.strictEqual(response.status, 200)
      assert.deepStrictEqual(yield* Effect.promise(() => response.json()), { accepted: 1, rejected: [] })
    }))
})

layer(Harness.layer({ adminEmail: "member@example.com" }))("Admin bootstrap on sign-in", (it) => {
  it.effect("an existing Member signing in with FLOCK_ADMIN_EMAIL and a password is not promoted", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      yield* h.seedMember({ email: "member@example.com", password: "correct horse battery" })

      const member = yield* h.browser()
      const response = yield* member.signIn({ email: "member@example.com", password: "correct horse battery" })
      assert.strictEqual(response.status, 200)
      assert.isFalse((yield* member.client.members.me()).isAdmin)
    }))
})

layer(Harness.layer({ adminEmail: "owner@example.com", adminPassword: "correct horse battery" }))("Admin bootstrap with FLOCK_ADMIN_PASSWORD", (it) => {
  it.effect("boot creates the Instance admin, who signs in with that password", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const browser = yield* h.browser()
      const wrong = yield* browser.signIn({ email: "owner@example.com", password: "wrong password" })
      assert.strictEqual(wrong.status, 401)
      const response = yield* browser.signIn({ email: "Owner@Example.com", password: "correct horse battery" })
      assert.strictEqual(response.status, 200)
      const me = yield* browser.client.members.me()
      assert.strictEqual(me.email, "owner@example.com")
      assert.isTrue(me.isAdmin)
      assert.isArray(yield* browser.client.projects.list())

      yield* browser.auth("/sign-out")
      const after = yield* Effect.promise(() => browser.fetch("/api/me"))
      assert.strictEqual(after.status, 401)
    }))
})

layer(Harness.layer({ adminEmail: "owner@example.com", zeroConfig: true }))("Sign-in without FLOCK_PUBLIC_URL or BETTER_AUTH_SECRET", (it) => {
  const signUp = (browser: Browser, origin: string) =>
    Effect.promise(() =>
      browser.fetch("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ email: "owner@example.com", password: "correct horse battery", name: "Owner" })
      })
    )

  it.effect("accepts sign-up from the Instance's own origin and refuses other origins", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      yield* h.client.instance.updateSettings({ payload: { openSignUp: true } })
      const attacker = yield* h.browser()
      const refused = yield* signUp(attacker, "https://evil.example")
      assert.strictEqual(refused.status, 403)

      const browser = yield* h.browser()
      const response = yield* signUp(browser, BASE_URL)
      assert.strictEqual(response.status, 200)
      assert.strictEqual((yield* browser.client.members.me()).email, "owner@example.com")
    }))
})
