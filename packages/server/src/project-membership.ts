// The rule that a Project always keeps at least one Project owner, for everything that
// changes who belongs to a Project: Project membership changes and removing a Member.
import type { PgClient } from "@effect/sql-pg"
import type { ProjectRole } from "@flock/shared"
import { Effect } from "effect"

export interface Membership {
  readonly projectId: string
  readonly memberId: string
  readonly role: ProjectRole
}

/**
 * The memberships of these Projects as they stand now, locked until the transaction ends, so
 * changes to who owns a Project take turns. Always locked in the same order, so two changes
 * waiting on each other's Projects can't deadlock.
 */
export const lockMemberships = (sql: PgClient.PgClient, projects: ReadonlyArray<string>) =>
  projects.length === 0
    ? Effect.succeed<ReadonlyArray<Membership>>([])
    : sql<Membership>`
        SELECT project_id, member_id, role FROM project_member
        WHERE project_id IN ${sql.in(projects)}
        ORDER BY project_id, member_id
        FOR UPDATE`

/** Those of `projects` that have no owner among these memberships, not counting the Member `leaving`. */
export const ownerless = <P extends string>(memberships: ReadonlyArray<Membership>, projects: ReadonlyArray<P>, leaving?: string) =>
  projects.filter((project) => !memberships.some((m) => m.projectId === project && m.role === "owner" && m.memberId !== leaving))
