# Flock

Self-hostable, event-based analytics for websites and apps: one Docker image backed by Postgres. See `GLOSSARY.md` for the vocabulary and `docs/adr/` for decisions.

## Repository

A pnpm workspace:

| Package | What it is |
|---|---|
| `packages/server` | Effect HttpApi server on `@effect/sql-pg`. Runs migrations on boot and serves the API, the built dashboard and the script |
| `packages/dashboard` | Vite + React + TanStack Router SPA, using the typed client derived from the shared API |
| `packages/script` | The browser script (plain TypeScript, under 2 KB gzipped), built with esbuild and served by the server at `/flock.js` |
| `packages/shared` | Effect Schemas for Events and the `FlockApi` definition, shared by the server and the dashboard |
| `playground` | A plain HTML/JS site that loads the real browser script from a local server; also the Seam 2 test fixtures |

## Development

Requirements: Node 22+, pnpm, Docker.

```sh
pnpm install
make dev
```

`make dev` starts the shared Postgres (docker compose, container `flock-postgres` on host port 2432) if it isn't already running, then starts the server (2100), the dashboard (2101, proxies `/api` to the server) and the playground (2102). It prints `http://hel:<port>` links. A port that's already taken is replaced by the next free one. For a second copy from another worktree, override the ports and the dev database: `SERVER_PORT=2200 DASHBOARD_PORT=2201 PLAYGROUND_PORT=2202 DEV_DB=flock_other make dev`.

The dashboard needs a signed-in Member. In development, sign up at `http://hel:2101/sign-in` as `admin@flock.test` (the dev `FLOCK_ADMIN_EMAIL`) to create the Instance admin. Other people join with an Invite link from the Instance page (`/instance`), or freely once Open sign-up is turned on there.

In development the server seeds a "Playground" Project with fixed keys, `pk_production_playground` and `pk_dev_playground`.

### Playground

- Every page loads the browser script from the server (`<script defer src="http://hel:2100/flock.js" data-key="pk_dev_playground">`), so opening it sends a `$pageview` to the Playground Project's `dev` Environment. The dashboard's `dev` count goes up within a few seconds. Watch the `/api/ingest` requests in the browser's dev tools.
- `/` has a **Log in** button (`login_clicked`, sent as the page unloads) and a **Complete game** button (`game_completed` with a `score` Event property).
- `/spa` is a fake single-page app: its links change the route with `pushState`, and each route change (and back/forward) sends a `$pageview`.
- `/ingest` is a raw-ingest form. Paste any JSON batch, send it to `POST /api/ingest`, and see the HTTP status and body. Malformed batches come back as a 400 that explains what's wrong.
- `FLOCK_API` and `FLOCK_KEY` override where the playground sends Events and with which key.

API docs are at `http://hel:2100/api/docs`, and the OpenAPI spec at `/api/openapi.json`.

## Tests

```sh
make test          # starts Postgres if needed, then runs pnpm test
pnpm -r typecheck
```

Tests only go through two seams and never look at tables or internals:

1. **The server's HTTP API** (`packages/server/test`). `Harness.layer()` in `test/harness.ts` runs the whole server in-process against a throwaway Postgres database (`flock_test_<random>`, created per `layer(...)` block and dropped afterwards). It provides a typed client signed in as an Instance admin (`h.client`), raw `h.fetch` without cookies, `h.browser()` (a fresh cookie jar with `signUp`/`signIn` and its own typed client), `h.seedMember(...)`, `h.adminCommand([...])` (the admin CLI command, in-process), `Harness.layer({ adminEmail })` for `FLOCK_ADMIN_EMAIL`, `h.seedProject(...)` for fixtures, `TestClock` (from `@effect/vitest`) for time, and `Harness.layer({ geoIp: { "203.0.113.7": "DE" } })` for a fixed GeoIP table. `TEST_DATABASE_ADMIN_URL` overrides the admin connection (default `postgres://postgres:postgres@127.0.0.1:2432/postgres`).
2. **The browser script's outgoing requests** (`packages/script/test`). `openPlayground(browser())` in `test/harness.ts` opens the playground pages in headless Chromium (Playwright), serving them and the freshly built script with request routing (no real servers), and captures every request to `/api/ingest`. Tests assert on those requests and the page only. One-time setup: `pnpm --filter @flock/script exec playwright install chromium --only-shell`. `test/size.test.ts` fails if the gzipped script exceeds 2 KB; `pnpm --filter @flock/script build` checks it too.

The browser script:

```html
<script defer src="https://flock.example.com/flock.js" data-key="pk_production_…"></script>
<script>flock.track("login_clicked", { plan: "pro" })</script>
```

It sends a `$pageview` on load and on `pushState`/`popstate`, gives each Event a UUID, and sends with `sendBeacon` (falling back to `fetch` with `keepalive`) as a `text/plain` JSON body, which needs no CORS preflight. Events go to the origin the script came from, or to `data-api` if set. It writes no cookies or storage.

## Self-hosting

```sh
curl -fsSLO https://raw.githubusercontent.com/ninest/flock/main/deploy/docker-compose.yml
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" > .env
echo "FLOCK_ADMIN_EMAIL=you@example.com" >> .env   # sign up with it to create the Instance admin
docker compose up -d
```

The image is `ghcr.io/ninest/flock` (tags `X.Y.Z`, `X.Y`, `X`, `latest`); run it with a `DATABASE_URL` and it migrates on boot. [docs/self-hosting.md](docs/self-hosting.md) covers environment variables, Railway, upgrading and backups. Contributors: schema changes follow the expand/contract rule in [docs/migrations.md](docs/migrations.md), and releases are cut as in [docs/releasing.md](docs/releasing.md).

## Docker

```sh
docker build -t flock .
docker run -p 2100:2100 -e DATABASE_URL=postgres://user:pass@host:5432/flock -e FLOCK_ADMIN_EMAIL=you@example.com flock
scripts/smoke.sh http://localhost:2100   # health, dashboard, OpenAPI
```

Sign-in settings (`FLOCK_ADMIN_EMAIL`, `FLOCK_PUBLIC_URL`, `BETTER_AUTH_SECRET`, …) are in [docs/self-hosting.md](docs/self-hosting.md#environment-variables).

## Recovering admin access

The `admin` CLI command creates an Instance admin, or promotes an existing Member. It uses the same environment variables as the server:

```sh
pnpm --filter @flock/server cli admin --email you@example.com --password 'new password'   # creates
pnpm --filter @flock/server cli admin --email member@example.com                         # promotes
docker compose exec flock node packages/server/src/cli.ts admin --email you@example.com # in Docker
```

CI (`.github/workflows/image.yml`) builds the image on every push and pull request and boots it against Postgres, through `deploy/docker-compose.yml`, and next to the previous release.
