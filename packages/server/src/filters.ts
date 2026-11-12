// Property filters: turns the filters every report takes into one SQL condition on an
// Event row (`properties`). Filters combine with AND; each compares the property's value
// as text. `$path` and `$referring_domain` are derived from `$url` and `$referrer` the
// same way the pages and referrers reports derive them, so clicking a row filters by it.
import type { PgClient } from "@effect/sql-pg"
import type { PropertyFilter } from "@flock/shared"
import type { Fragment } from "effect/sql/Statement"

type Sql = PgClient.PgClient

/** The path of a URL property (`/pricing`): no scheme, host, query or fragment; `/` when empty. */
export const pathOf = (sql: Sql) => {
  const url = sql`(properties ->> '$url')`
  return sql`CASE WHEN ${url} ~* '^[a-z][a-z0-9+.-]*://'
    THEN coalesce(nullif(substring(${url} FROM '(?i)^[a-z][a-z0-9+.-]*://[^/?#]*([^?#]*)'), ''), '/')
    ELSE substring(${url} FROM '^[^?#]*') END`
}

/** The host of a URL Event property, lowercased, without port or `www.`; null when it isn't a URL. */
export const hostOf = (sql: Sql, property: "$url" | "$referrer") =>
  sql`regexp_replace(lower(substring(properties ->> ${property} FROM '(?i)^[a-z][a-z0-9+.-]*://(?:[^@/?#]*@)?([^/?#:]+)')), '^www[.]', '')`

/** The referring domain; null for direct traffic (no referrer, or one from the page's own host). */
export const referringDomainOf = (sql: Sql) => {
  const referrer = hostOf(sql, "$referrer")
  return sql`CASE WHEN ${referrer} = ${hostOf(sql, "$url")} THEN NULL ELSE ${referrer} END`
}

const valueOf = (sql: Sql, property: string): Fragment =>
  property === "$path" ? pathOf(sql) : property === "$referring_domain" ? referringDomainOf(sql) : sql`(properties ->> ${property})`

/** One SQL condition that keeps the Events matching every filter (`TRUE` without filters). */
export const matchesFilters = (sql: Sql, filters: ReadonlyArray<PropertyFilter> | undefined): Fragment =>
  (filters ?? []).reduce<Fragment>((condition, filter) => {
    const value = valueOf(sql, filter.property)
    const test = filter.op === "is"
      ? sql`${value} = ${filter.value}`
      : filter.op === "isNot"
      ? sql`${value} IS DISTINCT FROM ${filter.value}`
      : sql`strpos(lower(${value}), lower(${filter.value})) > 0`
    return sql`${condition} AND ${test}`
  }, sql`TRUE`)
