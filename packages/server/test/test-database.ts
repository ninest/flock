// A throwaway database on the shared docker-compose Postgres:
// CREATE DATABASE flock_test_<random>, yield its URL, DROP it when the scope closes.
import { PgClient } from "@effect/sql-pg"
import { Context, Effect, Layer, Redacted } from "effect"
import { Reactivity } from "effect/reactivity"

const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL ?? "postgres://postgres:postgres@127.0.0.1:2432/postgres"

export class TestDatabase extends Context.Service<TestDatabase, string>()("test/TestDatabase") {
  static readonly layer = Layer.effect(
    TestDatabase,
    Effect.gen(function*() {
      const name = `flock_test_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`
      const admin = yield* PgClient.makeClient({ url: Redacted.make(ADMIN_URL) })
      yield* admin.unsafe(`CREATE DATABASE "${name}"`)
      yield* Effect.addFinalizer(() => admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).pipe(Effect.ignore))
      const url = new URL(ADMIN_URL)
      url.pathname = `/${name}`
      return url.toString()
    }).pipe(Effect.orDie)
  ).pipe(Layer.provide(Reactivity.layer))
}
