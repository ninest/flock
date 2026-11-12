import { assert, layer } from "@effect/vitest"
import { DateTime, Effect } from "effect"
import { TestClock } from "effect/testing"
import { Harness } from "./harness.ts"

const json = <A>(response: Response) => Effect.promise(() => response.json() as Promise<A>)
const password = "correct horse battery"

layer(Harness.layer())("Open sign-up", (it) => {
  it.effect("is off by default, so sign-up without an Invite is rejected", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      assert.deepStrictEqual(yield* h.client.instance.settings(), { openSignUp: false })

      const browser = yield* h.browser()
      const response = yield* browser.signUp({ email: "stranger@example.com", password })
      assert.strictEqual(response.status, 403)
      assert.strictEqual((yield* json<{ code: string }>(response)).code, "SIGN_UP_CLOSED")
    }))

  it.effect("when the Instance admin turns it on, anyone can sign up", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const settings = yield* h.client.instance.updateSettings({ payload: { openSignUp: true } })
      assert.deepStrictEqual(settings, { openSignUp: true })

      const browser = yield* h.browser()
      const response = yield* browser.signUp({ email: "newcomer@example.com", password, name: "Newcomer" })
      assert.strictEqual(response.status, 200)
      const me = yield* browser.client.members.me()
      assert.strictEqual(me.email, "newcomer@example.com")
      assert.isFalse(me.isAdmin)

      // Turned off again, sign-up closes.
      yield* h.client.instance.updateSettings({ payload: { openSignUp: false } })
      const late = yield* (yield* h.browser()).signUp({ email: "late@example.com", password })
      assert.strictEqual(late.status, 403)
    }))
})

layer(Harness.layer())("Invites", (it) => {
  it.effect("an Invite lets one person sign up while Open sign-up is off, and only once", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      yield* TestClock.setTime(Date.parse("2026-03-01T10:00:00Z"))
      const { invite, token } = yield* h.client.instance.createInvite({ payload: { note: "Alice" } })
      assert.strictEqual(invite.note, "Alice")
      assert.isNull(invite.usedAt)

      const alice = yield* h.browser()
      const response = yield* alice.auth("/sign-up/email", { email: "alice@example.com", password, name: "Alice", invite: token })
      assert.strictEqual(response.status, 200)
      const me = yield* alice.client.members.me()
      assert.strictEqual(me.email, "alice@example.com")
      assert.isFalse(me.isAdmin)

      const mallory = yield* h.browser()
      const again = yield* mallory.auth("/sign-up/email", { email: "mallory@example.com", password, name: "Mallory", invite: token })
      assert.strictEqual(again.status, 403)
      assert.strictEqual((yield* json<{ code: string }>(again)).code, "INVITE_INVALID")
      assert.strictEqual((yield* Effect.promise(() => mallory.fetch("/api/me"))).status, 401)

      const [listed] = yield* h.client.instance.invites()
      assert.strictEqual(listed!.id, invite.id)
      assert.strictEqual(listed!.usedBy, "alice@example.com")
      assert.strictEqual(DateTime.formatIso(listed!.createdAt), "2026-03-01T10:00:00.000Z")
      assert.isNotNull(listed!.usedAt)
    }))

  it.effect("a made-up Invite token is rejected", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const browser = yield* h.browser()
      const response = yield* browser.auth("/sign-up/email", { email: "guess@example.com", password, name: "Guess", invite: "inv_guess" })
      assert.strictEqual(response.status, 403)
      assert.strictEqual((yield* json<{ code: string }>(response)).code, "INVITE_INVALID")
    }))

  it.effect("a revoked Invite no longer works", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const { invite, token } = yield* h.client.instance.createInvite({ payload: { note: "Bob" } })
      yield* h.client.instance.revokeInvite({ params: { inviteId: invite.id } })
      assert.notInclude((yield* h.client.instance.invites()).map((i) => i.id), invite.id)

      const bob = yield* h.browser()
      const response = yield* bob.auth("/sign-up/email", { email: "bob@example.com", password, name: "Bob", invite: token })
      assert.strictEqual(response.status, 403)
    }))
})

layer(Harness.layer())("Members", (it) => {
  it.effect("only the Instance admin can change settings, manage Invites or remove Members", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const otherId = yield* h.seedMember({ email: "other@example.com", password })
      yield* h.seedMember({ email: "member@example.com", password })
      const member = yield* h.browser()
      yield* member.signIn({ email: "member@example.com", password })
      const { invite } = yield* h.client.instance.createInvite({ payload: { note: "Carol" } })

      const attempts = {
        settings: member.client.instance.settings(),
        updateSettings: member.client.instance.updateSettings({ payload: { openSignUp: true } }),
        members: member.client.instance.members(),
        removeMember: member.client.instance.removeMember({ params: { memberId: otherId } }),
        invites: member.client.instance.invites(),
        createInvite: member.client.instance.createInvite({ payload: { note: "Mine" } }),
        revokeInvite: member.client.instance.revokeInvite({ params: { inviteId: invite.id } })
      }
      for (const [name, attempt] of Object.entries(attempts)) {
        const error = yield* Effect.flip(attempt as Effect.Effect<unknown, { _tag: string }>)
        assert.strictEqual(error._tag, "Forbidden", name)
      }

      // Nothing changed.
      assert.isFalse((yield* h.client.instance.settings()).openSignUp)
      assert.include((yield* h.client.instance.members()).map((m) => m.email), "other@example.com")
      assert.deepStrictEqual((yield* h.client.instance.invites()).map((i) => i.note), ["Carol"])
    }))

  it.effect("the Instance admin lists Members", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const members = yield* h.client.instance.members()
      const admin = members.find((m) => m.email === "harness-admin@flock.test")
      assert.isTrue(admin?.isAdmin)
      assert.isFalse(members.find((m) => m.email === "member@example.com")?.isAdmin)
    }))

  it.effect("a removed Member can no longer sign in or query anything", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const memberId = yield* h.seedMember({ email: "leaver@example.com", password })
      const leaver = yield* h.browser()
      yield* leaver.signIn({ email: "leaver@example.com", password })
      assert.isArray(yield* leaver.client.projects.list())

      yield* h.client.instance.removeMember({ params: { memberId } })
      assert.notInclude((yield* h.client.instance.members()).map((m) => m.email), "leaver@example.com")

      // The open session stops working…
      for (const path of ["/api/me", "/api/projects"]) {
        assert.strictEqual((yield* Effect.promise(() => leaver.fetch(path))).status, 401, path)
      }
      // …and signing in again fails.
      const again = yield* h.browser()
      assert.strictEqual((yield* again.signIn({ email: "leaver@example.com", password })).status, 401)
      assert.strictEqual((yield* Effect.promise(() => again.fetch("/api/me"))).status, 401)

      const error = yield* Effect.flip(h.client.instance.removeMember({ params: { memberId } }))
      assert.strictEqual(error._tag, "MemberNotFound")
    }))

  it.effect("the Instance admin can't remove themselves", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const me = yield* h.client.members.me()
      const error = yield* Effect.flip(h.client.instance.removeMember({ params: { memberId: me.id } }))
      assert.strictEqual(error._tag, "Forbidden")
      assert.isTrue((yield* h.client.members.me()).isAdmin)
    }))
})
