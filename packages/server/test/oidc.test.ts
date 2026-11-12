import { assert, layer } from "@effect/vitest"
import { Effect } from "effect"
import { BASE_URL, Harness } from "./harness.ts"

const get = (h: Harness["Service"], path: string) => Effect.promise(() => h.fetch(path))
const location = (response: Response) => new URL(response.headers.get("location") ?? "", BASE_URL)

layer(Harness.layer({ oidc: {} }))("OIDC sign-in", (it) => {
  it.effect("with an Invite, the code flow signs a new Member in, and they sign in again without one", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { token } = yield* h.client.instance.createInvite({ payload: { note: "Alice" } })
      h.oidc!.setNextUser({ sub: "alice-sub", email: "Alice@Example.com", email_verified: true, name: "Alice" })

      const alice = yield* h.browser()
      const response = yield* alice.oidcSignIn({ invite: token })
      assert.strictEqual(response.status, 302)
      assert.strictEqual(location(response).pathname, "/")
      const me = yield* alice.client.members.me()
      assert.strictEqual(me.email, "alice@example.com")
      assert.strictEqual(me.name, "Alice")
      assert.isFalse(me.isAdmin)
      const [invite] = yield* h.client.instance.invites()
      assert.strictEqual(invite!.usedBy, "alice@example.com")

      const again = yield* h.browser()
      assert.strictEqual(location(yield* again.oidcSignIn()).pathname, "/")
      assert.strictEqual((yield* again.client.members.me()).id, me.id)
    }))

  it.effect("Flock asks the issuer to return to /api/auth/oauth2/callback/misc", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      assert.strictEqual(h.oidc!.lastRedirectUri(), `${BASE_URL}/api/auth/oauth2/callback/misc`)
    }))

  it.effect("a first-time sign-in without an Invite is rejected while Open sign-up is off, saying to ask for one", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      h.oidc!.setNextUser({ sub: "stranger-sub", email: "stranger@example.com", email_verified: true })
      const stranger = yield* h.browser()
      const response = yield* stranger.oidcSignIn()
      const url = location(response)
      assert.strictEqual(url.pathname, "/sign-in")
      assert.strictEqual(url.searchParams.get("error"), "SIGN_UP_CLOSED")
      assert.include(url.searchParams.get("error_description"), "Invite")
      assert.strictEqual((yield* Effect.promise(() => stranger.fetch("/api/me"))).status, 401)
      assert.notInclude((yield* h.client.instance.members()).map((m) => m.email), "stranger@example.com")
    }))

  it.effect("a used Invite is rejected", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { token } = yield* h.client.instance.createInvite({ payload: { note: "Bob" } })
      h.oidc!.setNextUser({ sub: "bob-sub", email: "bob@example.com", email_verified: true })
      yield* (yield* h.browser()).oidcSignIn({ invite: token })

      h.oidc!.setNextUser({ sub: "mallory-sub", email: "mallory@example.com", email_verified: true })
      const response = yield* (yield* h.browser()).oidcSignIn({ invite: token })
      assert.strictEqual(location(response).searchParams.get("error"), "INVITE_INVALID")
    }))

  it.effect("the sign-in options offer the issuer next to the password form", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const response = yield* get(h, "/api/sign-in-options")
      assert.strictEqual(response.status, 200)
      assert.deepStrictEqual(yield* Effect.promise(() => response.json()), { password: true, oidc: { name: "Example ID" } })
    }))
})

layer(Harness.layer({ adminEmail: "owner@example.com", oidc: {} }))("OIDC admin bootstrap", (it) => {
  it.effect("FLOCK_ADMIN_EMAIL with a verified email signs in as the Instance admin, without an Invite", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      h.oidc!.setNextUser({ sub: "owner-sub", email: "owner@example.com", email_verified: true })
      const owner = yield* h.browser()
      assert.strictEqual(location(yield* owner.oidcSignIn()).pathname, "/")
      assert.isTrue((yield* owner.client.members.me()).isAdmin)
    }))
})

layer(Harness.layer({ adminEmail: "owner@example.com", oidc: {} }))("OIDC admin bootstrap with an unverified email", (it) => {
  it.effect("is neither admitted without an Invite nor promoted with one, until the issuer verifies the email", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      h.oidc!.setNextUser({ sub: "claimer-sub", email: "owner@example.com", email_verified: false })
      const rejected = yield* (yield* h.browser()).oidcSignIn()
      assert.strictEqual(location(rejected).searchParams.get("error"), "SIGN_UP_CLOSED")

      const { token } = yield* h.client.instance.createInvite({ payload: { note: "Claimer" } })
      const claimer = yield* h.browser()
      assert.strictEqual(location(yield* claimer.oidcSignIn({ invite: token })).pathname, "/")
      const me = yield* claimer.client.members.me()
      assert.strictEqual(me.email, "owner@example.com")
      assert.isFalse(me.isAdmin)
      const admins = (yield* h.client.instance.members()).filter((m) => m.isAdmin).map((m) => m.email)
      assert.deepStrictEqual(admins, ["harness-admin@flock.test"])

      // Once the issuer reports the email as verified, the next sign-in promotes them.
      h.oidc!.setNextUser({ sub: "claimer-sub", email: "owner@example.com", email_verified: true })
      const verified = yield* h.browser()
      yield* verified.oidcSignIn()
      assert.isTrue((yield* verified.client.members.me()).isAdmin)
    }))
})

layer(Harness.layer({ adminEmail: "owner@example.com", oidc: { trustEmails: true } }))("OIDC admin bootstrap with a trusted issuer", (it) => {
  it.effect("an unverified FLOCK_ADMIN_EMAIL is admitted and promoted", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      h.oidc!.setNextUser({ sub: "owner-sub", email: "owner@example.com", email_verified: false })
      const owner = yield* h.browser()
      assert.strictEqual(location(yield* owner.oidcSignIn()).pathname, "/")
      assert.isTrue((yield* owner.client.members.me()).isAdmin)
    }))
})

layer(Harness.layer({ oidc: {}, passwordSignIn: false }))("Password sign-in turned off", (it) => {
  it.effect("the sign-in options hide the password form", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const response = yield* get(h, "/api/sign-in-options")
      assert.deepStrictEqual(yield* Effect.promise(() => response.json()), { password: false, oidc: { name: "Example ID" } })
    }))

  it.effect("the password endpoints refuse, even for an existing Member", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      yield* h.client.instance.updateSettings({ payload: { openSignUp: true } })
      yield* h.seedMember({ email: "member@example.com", password: "correct horse battery" })

      const browser = yield* h.browser()
      const signUp = yield* browser.signUp({ email: "new@example.com", password: "correct horse battery" })
      assert.isAtLeast(signUp.status, 400)
      const signIn = yield* browser.signIn({ email: "member@example.com", password: "correct horse battery" })
      assert.isAtLeast(signIn.status, 400)
      assert.strictEqual((yield* Effect.promise(() => browser.fetch("/api/me"))).status, 401)
    }))

  it.effect("Members still sign in with the OIDC issuer", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      assert.isTrue((yield* h.client.members.me()).isAdmin)
      h.oidc!.setNextUser({ sub: "carol-sub", email: "carol@example.com", email_verified: true })
      const carol = yield* h.browser()
      assert.strictEqual(location(yield* carol.oidcSignIn()).pathname, "/")
      assert.strictEqual((yield* carol.client.members.me()).email, "carol@example.com")
    }))
})
