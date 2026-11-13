// Event property filters: turns the filters every report takes into one SQL condition on an
// Event row (`properties`). Filters combine with AND; each compares the property's value
// as text. `$path` and `$referring_domain` are derived from `$url` and `$referrer` the
// same way the pages and referrers reports derive them, so clicking a row filters by it.
import type { PgClient } from "@effect/sql-pg"
import type { EventPropertyFilter } from "@flock/shared"
import type { Fragment } from "effect/sql/Statement"

type Sql = PgClient.PgClient

/** The Event properties column to read: the row's own, or a named lateral's (`fp`, a Session's first Pageview). */
type PropertiesColumn = "properties" | "fp.properties"

/**
 * The path of a URL property (`/pricing`): no scheme, host, query or fragment; `/` when empty.
 */
export const pathOf = (sql: Sql, properties: PropertiesColumn = "properties") => {
  const url = sql`(${sql.unsafe(properties)} ->> '$url')`
  return sql`CASE WHEN ${url} ~* '^[a-z][a-z0-9+.-]*://'
    THEN coalesce(nullif(substring(${url} FROM '(?i)^[a-z][a-z0-9+.-]*://[^/?#]*([^?#]*)'), ''), '/')
    ELSE substring(${url} FROM '^[^?#]*') END`
}

/** The host of a URL Event property, lowercased, without port or `www.`; null when it isn't a URL. */
export const hostOf = (sql: Sql, eventProperty: "$url" | "$referrer", properties: PropertiesColumn = "properties") =>
  sql`regexp_replace(lower(substring(${sql.unsafe(properties)} ->> ${eventProperty} FROM '(?i)^[a-z][a-z0-9+.-]*://(?:[^@/?#]*@)?([^/?#:]+)')), '^www[.]', '')`

/** The referring domain; null for direct traffic (no referrer, or one from the page's own host). */
export const referringDomainOf = (sql: Sql, properties: PropertiesColumn = "properties") => {
  const referrer = hostOf(sql, "$referrer", properties)
  return sql`CASE WHEN ${referrer} = ${hostOf(sql, "$url", properties)} THEN NULL ELSE ${referrer} END`
}

const valueOf = (sql: Sql, eventProperty: string): Fragment =>
  eventProperty === "$path" ? pathOf(sql) : eventProperty === "$referring_domain" ? referringDomainOf(sql) : sql`(properties ->> ${eventProperty})`

/** One SQL condition that keeps the Events matching every filter (`TRUE` without filters). */
export const matchesFilters = (sql: Sql, filters: ReadonlyArray<EventPropertyFilter> | undefined): Fragment =>
  (filters ?? []).reduce<Fragment>((condition, filter) => {
    const value = valueOf(sql, filter.eventProperty)
    const test = filter.op === "is"
      ? sql`${value} = ${filter.value}`
      : filter.op === "isNot"
      ? sql`${value} IS DISTINCT FROM ${filter.value}`
      : sql`strpos(lower(${value}), lower(${filter.value})) > 0`
    return sql`${condition} AND ${test}`
  }, sql`TRUE`)
