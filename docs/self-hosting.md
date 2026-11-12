# Self-hosting Flock

Flock is one Docker image, `ghcr.io/ninest/flock`, plus Postgres 16 or newer. The image runs its database migrations on boot, so installing and upgrading both mean "run the image".

## Image tags

Every release `vX.Y.Z` is published as `X.Y.Z`, `X.Y`, `X` and `latest`.

| Tag | Moves to | Use it when |
|---|---|---|
| `1` | every 1.x.y release | **Recommended.** You get fixes and features automatically, and never a breaking change: those only ship in a new major (`2`). |
| `1.4` | every 1.4.y release | You only want patch releases. |
| `1.4.2` | never | You upgrade by hand. |
| `latest` | every release, including new majors | Not recommended for unattended updates. |

## Docker Compose

`deploy/docker-compose.yml` runs Flock (pinned to the `1` tag) and Postgres:

```sh
mkdir flock && cd flock
curl -fsSLO https://raw.githubusercontent.com/ninest/flock/main/deploy/docker-compose.yml
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" > .env
echo "FLOCK_ADMIN_EMAIL=you@example.com" >> .env
docker compose up -d
```

Then open the dashboard and sign up with `FLOCK_ADMIN_EMAIL` to create the Instance admin.

Flock listens on port 2100 (`FLOCK_PORT=8080` in `.env` changes the host port). Put a reverse proxy with TLS (Caddy, Traefik, nginx, or `tailscale serve`) in front of it for anything public.

## Railway

Deploy from the Flock template (image source `ghcr.io/ninest/flock:1` plus a Postgres service), or by hand:

1. Create a Postgres service.
2. Create a service from the Docker image `ghcr.io/ninest/flock:1`.
3. Set its variables `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `FLOCK_ADMIN_EMAIL` (your email) and `FLOCK_PUBLIC_URL` (the generated domain, `https://…`). Railway sets `PORT`, and Flock listens on it.
4. Settings → Deploy → Healthcheck path: `/api/health`.
5. Settings → Source → enable automatic image updates, so Railway redeploys when a new `1.x.y` is published.
6. Settings → Networking → generate a domain.

## Environment variables

| Variable | Required | Default | What it does |
|---|---|---|---|
| `DATABASE_URL` | yes | | Postgres connection string, e.g. `postgres://flock:secret@db:5432/flock`. The database must exist; Flock creates its tables on boot. |
| `PORT` | no | `2100` | Port the server listens on. |
| `FLOCK_ADMIN_EMAIL` | no | | Signing up or signing in with this email makes that Member the Instance admin. This is how the first account is created: set it, open the dashboard and sign up with it. Everyone else needs an Invite link (created on the dashboard's Instance page) unless the Instance admin turns Open sign-up on there. |
| `FLOCK_PUBLIC_URL` | no | the origin of each request | The URL Members open Flock on, e.g. `https://flock.example.com`. Set it when Flock is public. |
| `FLOCK_TRUSTED_ORIGINS` | no | | Comma-separated extra origins allowed to sign in, e.g. a second domain. |
| `BETTER_AUTH_SECRET` | no | generated on first boot and kept in Postgres | Signs Member sessions; at least 32 random characters. Changing it signs every Member out. |
| `FLOCK_GEOIP_DB` | no | the bundled DB-IP IP to Country Lite | A MaxMind-format (`.mmdb`) GeoIP database used to derive each Event's `$country` from the request IP (the IP itself is never stored). Point it at a City database, such as DB-IP IP to City Lite, to get `$region` too. Without a readable file, countries are unknown and ingest carries on. |
| `FLOCK_PUBLIC_DIR` | no | the built dashboard inside the image | Directory served as the dashboard. Only for development. |
| `FLOCK_SEED_PLAYGROUND` | no | `false` | Creates a "Playground" Project with the fixed keys `pk_production_playground` and `pk_dev_playground`, owned by the `FLOCK_ADMIN_EMAIL` Member if they exist at boot. Only for development and CI; never turn it on for a real Instance. |

Contributors: every new environment variable gets a row here.

## Client IP behind a proxy

Flock reads the visitor's IP from the first `X-Forwarded-For` address, falling back to the connection's address, and uses it only to look up the country. Make sure your reverse proxy sets `X-Forwarded-For` (Railway, Caddy, Traefik and `tailscale serve` do by default); otherwise every Event gets your proxy's country.

IP geolocation by [DB-IP](https://db-ip.com), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

## Recovering admin access

If no one can sign in as an Instance admin, run the `admin` command inside the container. It promotes an existing Member, or creates one when given `--password`:

```sh
docker compose exec flock node packages/server/src/cli.ts admin --email you@example.com
docker compose exec flock node packages/server/src/cli.ts admin --email you@example.com --password 'a new password'
```

## Health

`GET /api/health` returns `200 {"status":"ok"}` once the server is up and can reach Postgres. The image has a Docker `HEALTHCHECK` on it, and the compose file waits on Postgres's.

## Upgrading

Migrations run automatically when the new image boots. Each release's migrations stay compatible with the previous release (see [migrations.md](migrations.md)), so a rolling restart, where old and new containers briefly share the database, is safe. Downgrading to an earlier release is not supported: restore a backup instead.

- **Railway:** with automatic image updates on, nothing to do. Otherwise redeploy the service.
- **Docker Compose:** `docker compose pull && docker compose up -d`.
- **Watchtower:** the compose file labels the Flock container for Watchtower and excludes Postgres. Add this service to the same compose file to update Flock automatically:

  ```yaml
    watchtower:
      image: containrrr/watchtower
      restart: unless-stopped
      command: --label-enable --cleanup --interval 3600
      volumes:
        - /var/run/docker.sock:/var/run/docker.sock
  ```

- **Major versions** (`1` → `2`) can contain breaking changes. Read the release notes, take a backup, then change the tag.

## Backups

All state lives in Postgres: Projects, Environments, keys, Members and every Event. Back it up with `pg_dump`.

```sh
# Docker Compose: dump to a compressed file on the host
docker compose exec -T postgres pg_dump -U flock -d flock -Fc > flock-$(date +%F).dump

# Restore into an empty database (stop Flock first)
docker compose stop flock
docker compose exec -T postgres pg_restore -U flock -d flock --clean --if-exists < flock-2026-11-12.dump
docker compose start flock
```

Run the dump from cron (for example daily) and copy the files off the machine. On Railway, use the Postgres service's Backups tab, or run `pg_dump "$DATABASE_URL"` against its public URL from elsewhere.

**Postgres major upgrades** (16 → 17) are not automatic: the compose file pins `postgres:16-alpine`, and Watchtower is told to leave it alone. To upgrade, dump, change the Postgres image, recreate the volume, and restore.
