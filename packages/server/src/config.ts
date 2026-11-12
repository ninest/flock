import { Config, Option } from "effect"
import type { AuthSettings } from "./access.ts"
import { fileURLToPath } from "node:url"

const defaultPublicDir = fileURLToPath(new URL("../../dashboard/dist", import.meta.url))

export const ServerConfig = Config.all({
  port: Config.Port("PORT").pipe(Config.withDefault(2100)),
  databaseUrl: Config.Redacted("DATABASE_URL"),
  /** Directory with the built dashboard (index.html, assets). */
  publicDir: Config.String("FLOCK_PUBLIC_DIR").pipe(Config.withDefault(defaultPublicDir)),
  /** The origin Members open Flock on; defaults to http://localhost:<PORT>. */
  publicUrl: Config.option(Config.String("FLOCK_PUBLIC_URL")),
  /** Comma-separated extra origins allowed to sign in (e.g. the dev dashboard). */
  trustedOrigins: Config.String("FLOCK_TRUSTED_ORIGINS").pipe(
    Config.map((s) => s.split(",").map((o) => o.trim()).filter((o) => o !== "")),
    Config.withDefault([] as Array<string>)
  ),
  /** Signs Member session cookies: at least 32 random characters. */
  authSecret: Config.Redacted("BETTER_AUTH_SECRET"),
  /** Signing up or signing in with this email makes the Member an Instance admin. */
  adminEmail: Config.option(Config.String("FLOCK_ADMIN_EMAIL")),
  /** Seed the playground Project with fixed keys (development only). */
  seedPlayground: Config.Boolean("FLOCK_SEED_PLAYGROUND").pipe(Config.withDefault(false))
})

export const authSettings = (config: Config.Success<typeof ServerConfig>): AuthSettings => ({
  publicUrl: Option.getOrElse(config.publicUrl, () => `http://localhost:${config.port}`),
  trustedOrigins: config.trustedOrigins,
  secret: config.authSecret,
  adminEmail: config.adminEmail
})
