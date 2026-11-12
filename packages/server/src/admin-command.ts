// `admin` CLI command: creates an Instance admin, or promotes an existing Member,
// for recovering access. Run by src/cli.ts; the Seam 1 harness runs it in-process.
import { Effect, Option, Schema } from "effect"
import { parseArgs } from "node:util"
import { Access } from "./access.ts"
import { BetterAuth } from "./auth.ts"

export class AdminCommandError extends Schema.TaggedError<AdminCommandError>()("AdminCommandError", {
  message: Schema.String
}) {}

export const adminUsage =
  "Usage: admin --email <email> [--password <password>] [--name <name>]\n" +
  "Promotes the Member with this email to Instance admin, or creates them (needs --password)."

/** Runs the command and returns what it prints. */
export const adminCommand = (args: ReadonlyArray<string>) =>
  Effect.gen(function*() {
    const access = yield* Access
    const auth = yield* BetterAuth
    const { values } = yield* Effect.try({
      try: () =>
        parseArgs({
          args: [...args],
          options: { email: { type: "string" }, password: { type: "string" }, name: { type: "string" } }
        }),
      catch: (e) => new AdminCommandError({ message: `${(e as Error).message}\n${adminUsage}` })
    })
    const email = values.email?.trim().toLowerCase()
    if (!email) return yield* new AdminCommandError({ message: `--email is required.\n${adminUsage}` })

    const existing = yield* access.memberByEmail(email).pipe(Effect.orDie)
    if (Option.isSome(existing)) {
      if (existing.value.isAdmin) return `${email} is already an Instance admin.`
      yield* access.grantAdmin(existing.value.id).pipe(Effect.orDie)
      return `${email} is now an Instance admin.`
    }

    if (!values.password) {
      return yield* new AdminCommandError({ message: `No Member has the email ${email}; pass --password to create one.` })
    }
    if (values.password.length < 8) return yield* new AdminCommandError({ message: "The password needs at least 8 characters." })
    const id = yield* auth.createMember({ email, password: values.password, name: values.name ?? email.split("@")[0]! })
    yield* access.grantAdmin(id).pipe(Effect.orDie)
    return `Created Instance admin ${email}.`
  })
