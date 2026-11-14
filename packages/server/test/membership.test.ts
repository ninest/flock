import { assert, layer } from "@effect/vitest"
import { DateTime, Effect, Fiber, Result } from "effect"
import { TestClock } from "effect/testing"
import pg from "pg"
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

/** Seeds a Member and returns a browser signed in as them. */
const signedIn = (email: string) =>
  Effect.gen(function*() {
    const h = yield* Harness
    const id = yield* h.seedMember({ email, password })
    const browser = yield* h.browser()
    yield* browser.signIn({ email, password })
    return { id, browser }
  })

layer(Harness.layer())("Removing a Member who owns Projects", (it) => {
  it.effect("is refused while they are the only owner of a Project, and succeeds once another Member owns it", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const sole = yield* signedIn("sole@example.com")
      yield* signedIn("heir@example.com")
      const project = yield* h.createProject({ name: "Sole site", environments: ["dev"], as: sole.browser })
      const projectId = project.id
      const heir = yield* sole.browser.client.projects.addMember({
        params: { projectId },
        payload: { email: "heir@example.com", role: "viewer" }
      })

      const error = yield* Effect.flip(h.client.instance.removeMember({ params: { memberId: sole.id } }))
      assert.strictEqual(error._tag, "SoleProjectOwner")
      assert.include((error as { message: string }).message, "Sole site")

      // The Member and their memberships are untouched.
      assert.include((yield* h.client.instance.members()).map((m) => m.email), "sole@example.com")
      assert.deepStrictEqual((yield* sole.browser.client.projects.list()).map((p) => p.id), [projectId])
      const roles = (yield* sole.browser.client.projects.members({ params: { projectId } }))
        .map((m) => [m.email, m.role] as const)
      assert.deepStrictEqual(new Map(roles), new Map([["sole@example.com", "owner"], ["heir@example.com", "viewer"]]))

      // Ownership is transferred through the Project membership controls, then the removal goes through.
      yield* sole.browser.client.projects.changeMemberRole({ params: { projectId, memberId: heir.id }, payload: { role: "owner" } })
      yield* h.client.instance.removeMember({ params: { memberId: sole.id } })
      assert.notInclude((yield* h.client.instance.members()).map((m) => m.email), "sole@example.com")
    }))

  it.effect("a Member who co-owns a Project, or only views one, can be removed", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const first = yield* signedIn("first@example.com")
      const coOwner = yield* signedIn("coowner@example.com")
      const viewer = yield* signedIn("viewer@example.com")
      const project = yield* h.createProject({ name: "Shared site", environments: ["dev"], as: first.browser })
      const projectId = project.id
      yield* first.browser.client.projects.addMember({ params: { projectId }, payload: { email: "coowner@example.com", role: "owner" } })
      yield* first.browser.client.projects.addMember({ params: { projectId }, payload: { email: "viewer@example.com", role: "viewer" } })

      yield* h.client.instance.removeMember({ params: { memberId: coOwner.id } })
      yield* h.client.instance.removeMember({ params: { memberId: viewer.id } })
      const left = (yield* first.browser.client.projects.members({ params: { projectId } })).map((m) => m.email)
      assert.deepStrictEqual(left, ["first@example.com"])
    }))

  /**
   * Pauses a request that is about to change or delete this Member's row, by holding the lock a new
   * Project membership of theirs would take, on a second connection, until `release` is called.
   */
  const holdMember = (memberId: string) =>
    Effect.gen(function*() {
      const h = yield* Harness
      const connection = new pg.Client({ connectionString: h.databaseUrl })
      yield* Effect.promise(async () => {
        await connection.connect()
        await connection.query("BEGIN")
        await connection.query(`SELECT 1 FROM member WHERE id = $1 FOR KEY SHARE`, [memberId])
      })
      yield* Effect.addFinalizer(() => Effect.promise(() => connection.end()))
      return { release: Effect.promise(() => connection.query("COMMIT")) }
    })
  /** Real time for a paused request to reach the lock it waits on (requests run on the TestClock). */
  const settle = Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 300)))

  it.effect("is refused when they become the only owner of a Project while the removal is under way", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const founder = yield* signedIn("founder@example.com")
      const leaving = yield* signedIn("leaving@example.com")
      const { id: projectId } = yield* h.createProject({ name: "Handed over", environments: ["dev"], as: founder.browser })
      yield* founder.browser.client.projects.addMember({ params: { projectId }, payload: { email: "leaving@example.com", role: "viewer" } })

      const hold = yield* holdMember(leaving.id)
      const removal = yield* Effect.forkChild(Effect.result(h.client.instance.removeMember({ params: { memberId: leaving.id } })))
      yield* settle
      // The founder hands the Project over and steps down while the removal waits.
      yield* founder.browser.client.projects.changeMemberRole({ params: { projectId, memberId: leaving.id }, payload: { role: "owner" } })
      yield* founder.browser.client.projects.changeMemberRole({ params: { projectId, memberId: founder.id }, payload: { role: "viewer" } })
      yield* hold.release

      const result = yield* Fiber.join(removal)
      assert.isTrue(Result.isFailure(result), "the removal went through")
      assert.strictEqual(Result.isFailure(result) && result.failure._tag, "SoleProjectOwner")
      const roles = (yield* founder.browser.client.projects.members({ params: { projectId } })).map((m) => [m.email, m.role] as const)
      assert.deepStrictEqual(new Map(roles), new Map([["leaving@example.com", "owner"], ["founder@example.com", "viewer"]]))
    }))
})
