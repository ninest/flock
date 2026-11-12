// Flock CLI. Uses DATABASE_URL and BETTER_AUTH_SECRET like the server, and runs
// pending migrations first.
//   node packages/server/src/cli.ts admin --email you@example.com [--password …]
import { NodeRuntime } from "@effect/platform-node"
import { Console, Effect, Layer } from "effect"
import { Access, AuthConfig } from "./access.ts"
import { adminCommand, adminUsage } from "./admin-command.ts"
import { BetterAuth } from "./auth.ts"
import { authSettings, ServerConfig } from "./config.ts"
import { PgLive } from "./db.ts"
import { MigratorLive } from "./migrations/index.ts"

const [command, ...args] = process.argv.slice(2)

const Deps = Layer.unwrap(Effect.gen(function*() {
  const config = yield* ServerConfig
  return BetterAuth.layer(config.databaseUrl).pipe(
    Layer.provideMerge(Access.layer),
    Layer.provide(Layer.effect(AuthConfig, authSettings(config))),
    Layer.provide(MigratorLive),
    Layer.provide(PgLive(config.databaseUrl))
  )
}))

const program = command === "admin"
  ? adminCommand(args).pipe(
    Effect.flatMap(Console.log),
    Effect.catchTag("AdminCommandError", (e) => Console.error(e.message).pipe(Effect.andThen(Effect.sync(() => (process.exitCode = 1))))),
    Effect.provide(Deps)
  )
  : Console.error(`Commands:\n  ${adminUsage.replaceAll("\n", "\n  ")}`).pipe(Effect.andThen(Effect.sync(() => (process.exitCode = 1))))

program.pipe(NodeRuntime.runMain)
