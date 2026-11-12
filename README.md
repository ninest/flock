# Flock

Self-hostable, event-based analytics for websites and apps: one Docker image backed by Postgres. See `GLOSSARY.md` for the vocabulary and `docs/adr/` for decisions.

## Repository

A pnpm workspace:

| Package | What it is |
|---|---|
| `packages/server` | Effect HttpApi server on `@effect/sql-pg`. Runs migrations on boot and serves the API, the built dashboard and the script |
| `packages/dashboard` | Vite + React + TanStack Router SPA, using the typed client derived from the shared API |
| `packages/script` | The browser script (plain TypeScript, under 2 KB gzipped) |
| `packages/shared` | Effect Schemas for Events and the `FlockApi` definition, shared by the server and the dashboard |
| `playground` | A plain HTML/JS site that sends Events to a local server |

## Development

Requirements: Node 22+, pnpm, Docker.

```sh
pnpm install
make dev
```

`make dev` starts the shared Postgres (docker compose, container `flock-postgres` on host port 2432) if it isn't already running, then starts the server (2100), the dashboard (2101, proxies `/api` to the server) and the playground (2102). It prints `http://hel:<port>` links. A port that's already taken is replaced by the next free one. For a second copy from another worktree, override the ports and the dev database: `SERVER_PORT=2200 DASHBOARD_PORT=2201 PLAYGROUND_PORT=2202 DEV_DB=flock_other make dev`.

In development the server seeds a "Playground" Project with fixed keys, `pk_production_playground` and `pk_dev_playground`.

### Playground

- Every playground page (`/`, `/pricing`) sends a `$pageview` to the Playground Project's `dev` Environment when it opens, and shows the response. The dashboard's `dev` count goes up within a few seconds.
- `/ingest` is a raw-ingest form. Paste any JSON batch, send it to `POST /api/ingest`, and see the HTTP status and body. Malformed batches come back as a 400 that explains what's wrong.
- `FLOCK_API` and `FLOCK_KEY` override where the playground sends Events and with which key.

API docs are at `http://hel:2100/api/docs`, and the OpenAPI spec at `/api/openapi.json`.

## Tests

```sh
make test          # starts Postgres if needed, then runs pnpm test
pnpm -r typecheck
```

Tests only go through two seams and never look at tables or internals:

1. **The server's HTTP API** (`packages/server/test`). `Harness.layer()` in `test/harness.ts` runs the whole server in-process against a throwaway Postgres database (`flock_test_<random>`, created per `layer(...)` block and dropped afterwards). It provides a typed client (`h.client`), raw `h.fetch`, `h.seedProject(...)` for fixtures, `TestClock` (from `@effect/vitest`) for time, and `Harness.layer({ geoIp: { "203.0.113.7": "DE" } })` for a fixed GeoIP table. `TEST_DATABASE_ADMIN_URL` overrides the admin connection (default `postgres://postgres:postgres@127.0.0.1:2432/postgres`).
2. **The browser script's outgoing requests** in headless Chromium against playground pages (set up with the script in #5).

## Docker

```sh
docker build -t flock .
docker run -p 2100:2100 -e DATABASE_URL=postgres://user:pass@host:5432/flock flock
```
