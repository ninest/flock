import { PgClient } from "@effect/sql-pg"
import type { Redacted } from "effect"

const snakeToCamel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
const camelToSnake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)

/** Postgres client. Columns are snake_case in SQL and camelCase in TypeScript. */
export const PgLive = (url: Redacted.Redacted<string>) =>
  PgClient.layer({
    url,
    maxConnections: 10,
    transformResultNames: snakeToCamel,
    transformQueryNames: camelToSnake
  })
