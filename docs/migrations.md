# Database migrations (for contributors)

Migrations live in `packages/server/src/migrations/` and run on boot, in one transaction under a table lock, so concurrent boots are safe. They are forward-only: never edit a released migration; add `<next id>_<name>.ts` and register it in `index.ts`.

## The expand/contract rule

**Every migration must keep the previous release working.** Self-hosters on a major tag (`ghcr.io/ninest/flock:1`) are upgraded automatically, and during a rolling deploy the old and new servers share one database. After the new release migrates the schema, the previous release's server must still boot, ingest Events and serve the dashboard against it.

So change the schema in two releases:

1. **Expand** (release N): add, never take away. New tables, new nullable columns or columns with defaults, new indexes. The code writes both the old and the new shape and reads the new one.
2. **Contract** (release N+1 or later): once no supported release reads the old shape, drop it.

| Change | Allowed in one release? |
|---|---|
| Add a table, an index, a nullable column, or a column with a default | Yes |
| Add a `NOT NULL` column without a default | No: the previous release's inserts fail. Add it with a default, or nullable first |
| Rename or drop a column or table the previous release uses | No: add the new one (expand), drop the old one a release later (contract) |
| Change a column's type in place | No: add a new column and backfill |
| Tighten a constraint the previous release can violate | No |
| `CREATE INDEX CONCURRENTLY` and other non-transactional DDL | Never: migrations run in a transaction |

A change that can't be made compatible is breaking, and ships only in a new major version (`2.0.0`), with release notes.

## How CI checks it

The `image` workflow (`.github/workflows/image.yml`, run by CI on every push and pull request, and by every release) finds the latest release tag (on a release, the one before it) and:

1. boots that release's image against a fresh database and smoke-tests it (`scripts/smoke.sh`),
2. boots the new image against the same database, which migrates it, and smoke-tests that,
3. smoke-tests the previous release again, also after a restart, against the migrated schema.

The job fails if any step breaks. Until the first release is tagged, the check is skipped with a notice.
