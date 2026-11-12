import { Config, Effect, Option, Redacted, Schema } from "effect"
import type { AuthSettings } from "./access.ts"
import { fileURLToPath } from "node:url"

const defaultPublicDir = fileURLToPath(new URL("../../dashboard/dist", import.meta.url))
const defaultGeoIpDatabase = fileURLToPath(new URL("../data/dbip-country-lite.mmdb", import.meta.url))
const defaultScriptFile = fileURLToPath(new URL("../../script/dist/flock.js", import.meta.url))

export const ServerConfig = Config.all({
  port: Config.Port("PORT").pipe(Config.withDefault(2100)),
  databaseUrl: Config.Redacted("DATABASE_URL"),
  /** Directory with the built dashboard (index.html, assets). */
  publicDir: Config.String("FLOCK_PUBLIC_DIR").pipe(Config.withDefault(defaultPublicDir)),
  /** The built browser script (`pnpm --filter @flock/script build`), served at /flock.js. */
  scriptFile: Config.String("FLOCK_SCRIPT_FILE").pipe(Config.withDefault(defaultScriptFile)),
  /**
   * A MaxMind-format GeoIP database. Defaults to the bundled DB-IP IP to Country Lite
   * (`scripts/download-geoip.sh`); point it at a City database to get regions too.
   */
  geoIpDatabase: Config.String("FLOCK_GEOIP_DB").pipe(Config.withDefault(defaultGeoIpDatabase)),
  /** The origin Members open Flock on; defaults to each request's own origin. */
  publicUrl: Config.option(Config.String("FLOCK_PUBLIC_URL")),
  /** Comma-separated extra origins allowed to sign in (e.g. the dev dashboard). */
  trustedOrigins: Config.String("FLOCK_TRUSTED_ORIGINS").pipe(
    Config.map((s) => s.split(",").map((o) => o.trim()).filter((o) => o !== "")),
    Config.withDefault([] as Array<string>)
  ),
  /** Signs Member session cookies: at least 32 random characters. Generated and kept in Postgres when unset. */
  authSecret: Config.option(Config.Redacted("BETTER_AUTH_SECRET")),
  /** Signing up or signing in with this email makes the Member an Instance admin. */
  adminEmail: Config.option(Config.String("FLOCK_ADMIN_EMAIL")),
  /** Members may sign up and sign in with email + password. Turn off to allow OIDC only. */
  passwordSignIn: Config.Boolean("FLOCK_PASSWORD_SIGN_IN").pipe(Config.withDefault(true)),
  /** The OIDC issuer URL, e.g. https://auth.misc.page. Members may sign in with it when set. */
  oidcIssuer: Config.option(Config.String("FLOCK_OIDC_ISSUER")),
  oidcClientId: Config.option(Config.String("FLOCK_OIDC_CLIENT_ID")),
  oidcClientSecret: Config.option(Config.Redacted("FLOCK_OIDC_CLIENT_SECRET")),
  /** The issuer's name on the sign-in page; defaults to its host. */
  oidcName: Config.option(Config.String("FLOCK_OIDC_NAME")),
  /** Treat the issuer's emails as verified for the FLOCK_ADMIN_EMAIL bootstrap. */
  oidcTrustEmails: Config.Boolean("FLOCK_OIDC_TRUST_EMAILS").pipe(Config.withDefault(false)),
  /** Seed the playground Project with fixed keys (development only). */
  seedPlayground: Config.Boolean("FLOCK_SEED_PLAYGROUND").pipe(Config.withDefault(false))
})

export class AuthConfigError extends Schema.TaggedError<AuthConfigError>()("AuthConfigError", {
  message: Schema.String
}) {}

/** The sign-in settings, or an error explaining which variables are missing. */
export const authSettings = (config: Config.Success<typeof ServerConfig>): Effect.Effect<AuthSettings, AuthConfigError> =>
  Effect.gen(function*() {
    const publicUrl = nonEmpty(config.publicUrl)
    const issuer = nonEmpty(config.oidcIssuer)
    const fail = (message: string) => Effect.fail(new AuthConfigError({ message }))
    let oidc: AuthSettings["oidc"] = Option.none()
    if (Option.isSome(issuer)) {
      const clientId = nonEmpty(config.oidcClientId)
      const clientSecret = Option.filter(config.oidcClientSecret, (secret) => Redacted.value(secret).trim() !== "")
      if (Option.isNone(clientId) || Option.isNone(clientSecret)) {
        return yield* fail("FLOCK_OIDC_ISSUER needs FLOCK_OIDC_CLIENT_ID and FLOCK_OIDC_CLIENT_SECRET.")
      }
      if (Option.isNone(publicUrl)) {
        return yield* fail("FLOCK_OIDC_ISSUER needs FLOCK_PUBLIC_URL, which Flock's OIDC callback URL is built from.")
      }
      const url = issuer.value.replace(/\/+$/, "")
      oidc = Option.some({
        issuer: url,
        clientId: clientId.value,
        clientSecret: clientSecret.value,
        name: Option.getOrElse(nonEmpty(config.oidcName), () => new URL(url).host),
        trustEmails: config.oidcTrustEmails
      })
    }
    if (!config.passwordSignIn && Option.isNone(oidc)) {
      return yield* fail("FLOCK_PASSWORD_SIGN_IN=false needs an OIDC issuer (FLOCK_OIDC_ISSUER), or nobody could sign in.")
    }
    return {
      publicUrl,
      trustedOrigins: config.trustedOrigins,
      secret: Option.filter(config.authSecret, (secret) => Redacted.value(secret).trim() !== ""),
      adminEmail: nonEmpty(config.adminEmail),
      passwordSignIn: config.passwordSignIn,
      oidc
    }
  })

/** Docker Compose passes unset variables as empty strings. */
const nonEmpty = (value: Option.Option<string>) => Option.filter(Option.map(value, (s) => s.trim()), (s) => s !== "")
