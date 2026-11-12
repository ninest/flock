import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { HttpRouter } from "effect/http"
import { createServer } from "node:http"
import { AuthConfig } from "./access.ts"
import { AppLive } from "./app.ts"
import { authSettings, ServerConfig } from "./config.ts"
import { PgLive } from "./db.ts"
import { GeoIp } from "./geoip.ts"
import { AppRoutes } from "./http.ts"
import { MigratorLive } from "./migrations/index.ts"
import { Seed } from "./seed.ts"

const Main = Layer.unwrap(Effect.gen(function*() {
  const config = yield* ServerConfig
  const Server = HttpRouter.serve(AppRoutes(config)).pipe(
    Layer.provide(NodeHttpServer.layer(createServer, { port: config.port }))
  )
  const App = AppLive(config.databaseUrl)
  const AppWithSeed = config.seedPlayground ? Layer.merge(App, Seed.playground.pipe(Layer.provide(App))) : App
  return Server.pipe(
    Layer.provide(AppWithSeed),
    Layer.provide(GeoIp.layerUnknown),
    Layer.provide(Layer.effect(AuthConfig, authSettings(config))),
    Layer.provide(MigratorLive), // migrations finish before anything else is built
    Layer.provide(PgLive(config.databaseUrl))
  )
}))

Layer.launch(Main).pipe(NodeRuntime.runMain)
