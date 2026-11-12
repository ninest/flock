import { assert, layer } from "@effect/vitest"
import { Effect } from "effect"
import { Harness } from "./harness.ts"

const password = "correct horse battery"

layer(Harness.layer())("Admin CLI command", (it) => {
  it.effect("creates a new Instance admin who can sign in", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const output = yield* h.adminCommand(["--email", "rescue@example.com", "--password", password, "--name", "Rescue"])
      assert.include(output, "Created Instance admin rescue@example.com")

      const browser = yield* h.browser()
      const response = yield* browser.signIn({ email: "rescue@example.com", password })
      assert.strictEqual(response.status, 200)
      const me = yield* browser.client.members.me()
      assert.strictEqual(me.name, "Rescue")
      assert.isTrue(me.isAdmin)
    }))

  it.effect("promotes an existing Member", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      yield* h.seedMember({ email: "member@example.com", password })
      const browser = yield* h.browser()
      yield* browser.signIn({ email: "member@example.com", password })
      assert.isFalse((yield* browser.client.members.me()).isAdmin)

      const output = yield* h.adminCommand(["--email", "Member@Example.com"])
      assert.include(output, "member@example.com is now an Instance admin")
      assert.isTrue((yield* browser.client.members.me()).isAdmin)

      const again = yield* h.adminCommand(["--email", "member@example.com"])
      assert.include(again, "already an Instance admin")
    }))

  it.effect("needs a password to create a new Member", () =>
    Effect.gen(function*() {
      const h = yield* Harness
      const error = yield* h.adminCommand(["--email", "nobody@example.com"]).pipe(Effect.flip)
      assert.include(error.message, "--password")
      const missingEmail = yield* h.adminCommand([]).pipe(Effect.flip)
      assert.include(missingEmail.message, "--email")
    }))
})
