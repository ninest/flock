// Development fixtures. Used by `make dev` (FLOCK_SEED_PLAYGROUND) for the playground
// Project, and by the Seam 1 harness to create Members.
import { type MemberId } from "@flock/shared"
import { Context, Effect, Layer, Option } from "effect"
import { Access, AuthConfig } from "./access.ts"
import { BetterAuth } from "./auth.ts"
import { Projects } from "./projects.ts"

/** The playground's fixed keys, so the playground and CI smoke tests can be configured statically. */
export const PLAYGROUND_KEYS = { production: "pk_production_playground", dev: "pk_dev_playground" } as const

export class Seed extends Context.Service<Seed, {
  /** A Member who signs in with email + password (not an Instance admin). */
  readonly member: (seed: { readonly email: string; readonly password: string; readonly name?: string }) => Effect.Effect<MemberId>
}>()("flock/Seed") {
  static readonly layer = Layer.effect(
    Seed,
    Effect.gen(function*() {
      const auth = yield* BetterAuth
      return Seed.of({
        member: ({ email, name, password }) => auth.createMember({ email, password, name: name ?? email.split("@")[0]! })
      })
    })
  )

  /**
   * The playground's Project, created like any other Project but with fixed keys.
   * Its owner is the FLOCK_ADMIN_EMAIL Member, once they exist (`make dev` creates them first).
   */
  static readonly playground = Layer.effectDiscard(
    Effect.gen(function*() {
      const projects = yield* Projects
      const access = yield* Access
      const { adminEmail } = yield* AuthConfig
      const admin = Option.isSome(adminEmail)
        ? Option.map(yield* access.memberByEmail(adminEmail.value).pipe(Effect.orDie), (m) => m.id)
        : Option.none<MemberId>()

      // The playground is served from whatever dev host is at hand (`hel`, localhost…).
      const devOrigins = ["*"]
      const existing = yield* projects.projectWithKey(PLAYGROUND_KEYS.dev)
      if (Option.isSome(existing)) {
        if (Option.isSome(admin)) yield* projects.ensureOwner(existing.value, admin.value)
        yield* projects.setAllowedOriginsByKey(PLAYGROUND_KEYS.dev, devOrigins)
      } else {
        yield* projects.create({
          name: "Playground",
          timeZone: "UTC",
          owner: admin,
          environments: [
            { name: "production", key: PLAYGROUND_KEYS.production },
            { name: "dev", key: PLAYGROUND_KEYS.dev, allowedOrigins: devOrigins }
          ]
        })
      }
      const owner = Option.match(adminEmail, { onNone: () => "no owner", onSome: (e) => Option.isSome(admin) ? `owned by ${e}` : `no owner yet: ${e} doesn't exist` })
      yield* Effect.logInfo(`Playground Project ready (${PLAYGROUND_KEYS.production}, ${PLAYGROUND_KEYS.dev}; ${owner})`)
    })
  )
}
