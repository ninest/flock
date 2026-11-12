import { Config } from "effect"
import { fileURLToPath } from "node:url"

const defaultPublicDir = fileURLToPath(new URL("../../dashboard/dist", import.meta.url))
const defaultScriptFile = fileURLToPath(new URL("../../script/dist/flock.js", import.meta.url))

export const ServerConfig = Config.all({
  port: Config.Port("PORT").pipe(Config.withDefault(2100)),
  databaseUrl: Config.Redacted("DATABASE_URL"),
  /** Directory with the built dashboard (index.html, assets). */
  publicDir: Config.String("FLOCK_PUBLIC_DIR").pipe(Config.withDefault(defaultPublicDir)),
  /** The built browser script (`pnpm --filter @flock/script build`), served at /flock.js. */
  scriptFile: Config.String("FLOCK_SCRIPT_FILE").pipe(Config.withDefault(defaultScriptFile)),
  /** Seed the playground Project with fixed keys (development only). */
  seedPlayground: Config.Boolean("FLOCK_SEED_PLAYGROUND").pipe(Config.withDefault(false))
})
