# Flock

Self-hostable, event-based analytics for websites and apps: one Docker image backed by Postgres. See `GLOSSARY.md` for the vocabulary and `docs/adr/` for decisions.

## Try it (local testing cheat-sheet)

Run `make dev`, then:

| What | Where |
|---|---|
| Dashboard | http://hel:2101 (sign in at `/sign-in`) |
| Dev admin login | `admin@flock.test` / `flock-dev-password` |
| Playground site | http://hel:2102 (if 2102 is taken, `make dev` prints the port it used instead, e.g. 2103) |
| Server, API docs | http://hel:2100, http://hel:2100/api/docs |
| Playground Project keys | `pk_dev_playground` (used by the playground), `pk_production_playground` |
| Tracking mode and Identify | Playground Project → Project settings → Tracking mode → persistent, reload http://hel:2102 (mode shown on `/`), click **Identify as test-user**; on a second device do the same and the dashboard counts one Visitor |
| Instance admin page (Invites, Open sign-up, Members) | http://hel:2101/instance |
| Filtered view (property filters live in the URL; click any report row or **Add filter**) | `http://hel:2101/projects/<id>?filters=[{"property":"$country","op":"is","value":"DE"}]` |
| OIDC sign-in ("Sign in with …" on `/sign-in`) | Off by default. Export `FLOCK_OIDC_ISSUER`, `FLOCK_OIDC_CLIENT_ID`, `FLOCK_OIDC_CLIENT_SECRET` (and optionally `FLOCK_OIDC_NAME`, `FLOCK_PASSWORD_SIGN_IN=false`) before `make dev`, with `FLOCK_PUBLIC_URL` set to the origin registered at the issuer (`http://localhost:2101` or a `tailscale serve` https URL). See [docs/self-hosting.md](docs/self-hosting.md#oidc-sign-in) |

Playground pages: `/` (Pageview, **Log in**, **Complete game** and **Identify as test-user** buttons, Tracking mode indicator; **Complete game** sends `game_completed` with a random `{ score, level }`, shown under Custom events on the dashboard), `/blog` (linked pages, for top/entry/exit pages), `/sources` (links with `utm_*` tags and simulated referrers), `/spa` (SPA navigation), `/ingest` (raw ingest form). Open the Playground Project in the dashboard and switch to the `dev` Environment to see the Events arrive.

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

The dashboard needs a signed-in Member. `make dev` creates the dev Instance admin first (with the `admin` CLI command), so sign in at `http://hel:2101/sign-in` as `admin@flock.test` with the password `flock-dev-password` (override with `FLOCK_ADMIN_EMAIL` and `FLOCK_DEV_ADMIN_PASSWORD`). Other people join with an Invite link from the Instance page (`/instance`), or freely once Open sign-up is turned on there.

The dashboard lists your Projects. Create one (its time zone defaults to your browser's) to get a `production` Environment and its `pk_production_…` key; add Environments such as `dev`, rotate keys, delete a non-production Environment's Events, and switch Environments on the Project page (default `production`). In development the server also creates a "Playground" Project, owned by the dev Instance admin, with the fixed keys `pk_production_playground` and `pk_dev_playground`.

### Playground

- Every page loads the browser script from the server (`<script defer src="http://hel:2100/flock.js" data-key="pk_dev_playground">`), so opening it sends a `$pageview` to the Playground Project's `dev` Environment. The dashboard's `dev` count goes up within a few seconds. Watch the `/api/ingest` requests in the browser's dev tools.
- `/` has a **Log in** button (`login_clicked`, sent as the page unloads) and a **Complete game** button (`game_completed` with a `score` Event property).
- `/blog` and its posts link to each other and to Pricing, so browsing them fills in top pages, entry pages (a Session's first Pageview) and exit pages (its last).
- `/sources` has campaign links that land on other pages with `utm_*` tags and a simulated referrer (`?simulate_referrer=<url>` works on any page and fakes `document.referrer`). They fill in Referrers and UTM sources, mediums and campaigns, which count a Session by its first Pageview, so use a private window to start a new Visitor. The live counter next to the Environment switcher counts Visitors seen in the last 30 minutes.
- `/spa` is a fake single-page app: its links change the route with `pushState`, and each route change (and back/forward) sends a `$pageview`.
- `/ingest` is a raw-ingest form. Paste any JSON batch, send it to `POST /api/ingest`, and see the HTTP status and body. Malformed batches come back as a 400 that explains what's wrong. The **Send an oversized Event** and **Send a reserved name** buttons send batches that Ingest rejects, and show the reason for each rejected Event.
- The playground's `dev` Environment allows any origin (`*`), so it works from `hel`, localhost or anywhere else.
- `FLOCK_API` and `FLOCK_KEY` override where the playground sends Events and with which key.

API docs are at `http://hel:2100/api/docs`, and the OpenAPI spec at `/api/openapi.json`.

## Tests

```sh
make test          # starts Postgres if needed, then runs pnpm test
pnpm -r typecheck
```

Tests only go through two seams and never look at tables or internals:

1. **The server's HTTP API** (`packages/server/test`). `Harness.layer()` in `test/harness.ts` runs the whole server in-process against a throwaway Postgres database (`flock_test_<random>`, created per `layer(...)` block and dropped afterwards). It provides a typed client signed in as an Instance admin (`h.client`), raw `h.fetch` without cookies, `h.sdk` (a typed client without cookies or an `Origin`, like a server sending Events), `h.browser()` (a fresh cookie jar with `signUp`/`signIn` and its own typed client), `h.seedMember(...)`, `h.adminCommand([...])` (the admin CLI command, in-process), `Harness.layer({ adminEmail, adminPassword })` for `FLOCK_ADMIN_EMAIL` / `FLOCK_ADMIN_PASSWORD`, `h.createProject(...)` (the Projects API) for fixtures, `TestClock` (from `@effect/vitest`) for time, `Harness.layer({ geoIp: { "203.0.113.7": "DE", "198.51.100.23": { country: "US", region: "California" } } })` for a fixed GeoIP table, `h.ingest(key, events, { ip, userAgent })` to send a batch with a client IP (as `X-Forwarded-For`, trusted for one hop unless `Harness.layer({ trustedProxies })` says otherwise) and User-Agent, and `h.breakdown(environmentId, "$country", range)` / `h.propertyKeys(...)` / `h.overview(...)` / `h.top(environmentId, "pages", { period: "7d" })` / `h.live(environmentId)` to read reports back. `TEST_DATABASE_ADMIN_URL` overrides the admin connection (default `postgres://postgres:postgres@127.0.0.1:2432/postgres`).
2. **The browser script's outgoing requests** (`packages/script/test`). `openPlayground(browser())` in `test/harness.ts` opens the playground pages in headless Chromium (Playwright), serving them and the freshly built script with request routing (no real servers), and captures every request to `/api/ingest`. Tests assert on those requests and the page only. One-time setup: `pnpm --filter @flock/script exec playwright install chromium --only-shell`. `test/size.test.ts` fails if the gzipped script exceeds 2 KB; `pnpm --filter @flock/script build` checks it too.

The browser script:

```html
<script defer src="https://flock.example.com/flock.js" data-key="pk_production_…"></script>
<script>flock.track("login_clicked", { plan: "pro" })</script>
```

It sends a `$pageview` on load and on `pushState`/`popstate`, gives each Event a UUID, and sends with `sendBeacon` (falling back to `fetch` with `keepalive`) as a `text/plain` JSON body, which needs no CORS preflight. Events go to the origin the script came from, or to `data-api` if set.

`data-mode` is the Project's Tracking mode (ADR 0002), which the dashboard's snippet fills in. In `cookieless` mode (the default) the script writes no cookies or storage, and `identify` does nothing. In `persistent` mode it first asks `GET /api/ingest/config?key=…` for the Project's current Tracking mode, then stores a random Visitor ID in `localStorage` and sends it as each Event's `distinct_id`. `flock.identify("user-42")` sends a `$identify` Event that links the device to `user-42`, and from then on the device sends Events as `user-42`. The server only trusts `distinct_id` when the Project is persistent, so switching the mode in the dashboard takes effect at once for counting, and Visitor counts start afresh. If the Project is switched back to cookieless while sites still carry a `persistent` snippet, the script sees that on the next page load, deletes its stored IDs and stores nothing more. Update the snippet anyway: a stale persistent snippet waits for that check before sending.

### Ingest rules

`POST /api/ingest` takes `{ key, events: [{ uuid, name, timestamp?, distinct_id?, properties? }] }` and answers `{ accepted, rejected: [{ index, uuid, reason }] }`. Each Event is checked on its own:

- At most 50 Event properties, 8 KB of JSON, and 200 characters per Event name or Event property name.
- `$` is reserved for Flock: only Built-in event names (`$pageview`) and Flock-defined Event properties (`$url`, `$referrer`, and the audience properties, which Flock replaces) may start with it.
- A repeated `uuid` (per Environment) is ignored but still counted as accepted, so retries are safe.
- `timestamp` is kept when it is at most 24 hours old; otherwise (older, in the future, unparseable) the receive time is used.
- Browser requests (with an `Origin` header) must match the Environment's allowed origins, or the whole batch gets a 403 `OriginNotAllowed`. Empty (production's default) means any public origin, rejecting localhost and private networks; new non-production Environments allow `localhost` and `*.ts.net`. Owners edit them in the dashboard.
- Requests from known bots and headless browsers are dropped: a 200 with nothing accepted and nothing stored.

## Self-hosting

```sh
curl -fsSLO https://raw.githubusercontent.com/ninest/flock/main/deploy/docker-compose.yml
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" > .env
echo "FLOCK_ADMIN_EMAIL=you@example.com" >> .env   # boot creates this Instance admin…
echo "FLOCK_ADMIN_PASSWORD=$(openssl rand -base64 18)" >> .env   # …with this password
docker compose up -d
```

The image is `ghcr.io/ninest/flock` (tags `X.Y.Z`, `X.Y`, `X`, `latest`); run it with a `DATABASE_URL` and it migrates on boot. [docs/self-hosting.md](docs/self-hosting.md) covers environment variables, Railway, upgrading and backups. Contributors: schema changes follow the expand/contract rule in [docs/migrations.md](docs/migrations.md), and releases are cut as in [docs/releasing.md](docs/releasing.md).

## Docker

```sh
docker build -t flock .
docker run -p 2100:2100 -e DATABASE_URL=postgres://user:pass@host:5432/flock -e FLOCK_ADMIN_EMAIL=you@example.com -e FLOCK_ADMIN_PASSWORD='a long password' flock
scripts/smoke.sh http://localhost:2100   # health, dashboard, OpenAPI
```

Sign-in settings (`FLOCK_ADMIN_EMAIL`, `FLOCK_ADMIN_PASSWORD`, `FLOCK_PUBLIC_URL`, `BETTER_AUTH_SECRET`, …) are in [docs/self-hosting.md](docs/self-hosting.md#environment-variables).

## Recovering admin access

The `admin` CLI command creates an Instance admin, or promotes an existing Member. It uses the same environment variables as the server:

```sh
pnpm --filter @flock/server cli admin --email you@example.com --password 'new password'   # creates
pnpm --filter @flock/server cli admin --email member@example.com                         # promotes
docker compose exec flock node packages/server/src/cli.ts admin --email you@example.com # in Docker
```

CI (`.github/workflows/image.yml`) builds the image on every push and pull request and boots it against Postgres, through `deploy/docker-compose.yml`, and next to the previous release.
