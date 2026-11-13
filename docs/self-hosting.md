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
echo "FLOCK_ADMIN_PASSWORD=$(openssl rand -base64 18)" >> .env
docker compose up -d
```

On boot, Flock creates the Instance admin with that email and password. Open the dashboard and sign in with them.

Flock listens on port 2100 (`FLOCK_PORT=8080` in `.env` changes the host port). Put a reverse proxy with TLS (Caddy, Traefik, nginx, or `tailscale serve`) in front of it for anything public, and add `FLOCK_TRUSTED_PROXIES=1` to `.env` so Flock sees visitors' IPs (see [Client IP behind a proxy](#client-ip-behind-a-proxy)).

## Railway

Deploy from the Flock template (image source `ghcr.io/ninest/flock:1` plus a Postgres service), or by hand:

1. Create a Postgres service.
2. Create a service from the Docker image `ghcr.io/ninest/flock:1`.
3. Set its variables `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `FLOCK_ADMIN_EMAIL` (your email), `FLOCK_ADMIN_PASSWORD` (a long random password), `FLOCK_PUBLIC_URL` (the generated domain, `https://…`) and `FLOCK_TRUSTED_PROXIES=1` (see [Client IP behind a proxy](#client-ip-behind-a-proxy)). Railway sets `PORT`, and Flock listens on it.
4. Settings → Deploy → Healthcheck path: `/api/health`.
5. Settings → Source → enable automatic image updates, so Railway redeploys when a new `1.x.y` is published.
6. Settings → Networking → generate a domain.

## Environment variables

| Variable | Required | Default | What it does |
|---|---|---|---|
| `DATABASE_URL` | yes | | Postgres connection string, e.g. `postgres://flock:secret@db:5432/flock`. The database must exist; Flock creates its tables on boot. |
| `PORT` | no | `2100` | Port the server listens on. |
| `FLOCK_ADMIN_EMAIL` | no | | The Instance admin's email. This is how the first account is created, in one of two ways. With `FLOCK_ADMIN_PASSWORD`, boot creates that Member (or promotes an existing one). With OIDC, signing in with this email makes the Member the Instance admin, but only when the issuer says the email is verified (`email_verified`), unless `FLOCK_OIDC_TRUST_EMAILS=true`. A password sign-up with this email never makes an admin, because Flock can't check that you own the email. Everyone else needs an Invite link (created on the dashboard's Instance page) unless the Instance admin turns Open sign-up on there. |
| `FLOCK_ADMIN_PASSWORD` | no | | With `FLOCK_ADMIN_EMAIL`: on every boot, Flock makes sure that Instance admin exists. It creates the Member with this password if they don't exist yet, and promotes them if they do. It never changes an existing Member's password, so you can change yours in Flock and leave this set (or remove it after the first boot). At least 8 characters. |
| `FLOCK_PUBLIC_URL` | no | the origin of each request | The URL Members open Flock on, e.g. `https://flock.example.com`. Set it when Flock is public. |
| `FLOCK_TRUSTED_ORIGINS` | no | | Comma-separated extra origins allowed to sign in, e.g. a second domain. |
| `BETTER_AUTH_SECRET` | no | generated on first boot and kept in Postgres | Signs Member sessions; at least 32 random characters. Changing it signs every Member out. |
| `FLOCK_GEOIP_DB` | no | the bundled DB-IP IP to Country Lite | A MaxMind-format (`.mmdb`) GeoIP database used to derive each Event's `$country` from the request IP (the IP itself is never stored). Point it at a City database, such as DB-IP IP to City Lite, to get `$region` too. Without a readable file, countries are unknown and ingest carries on. |
| `FLOCK_TRUSTED_PROXIES` | no | | How many proxies in front of Flock append to `X-Forwarded-For` (e.g. `1`), or their comma-separated CIDR ranges. Unset, the header is ignored. Set it behind a reverse proxy or on Railway; see [Client IP behind a proxy](#client-ip-behind-a-proxy). |
| `FLOCK_PASSWORD_SIGN_IN` | no | `true` | Set to `false` to turn email + password sign-up and sign-in off, leaving OIDC as the only way in. Needs `FLOCK_OIDC_ISSUER`. |
| `FLOCK_OIDC_ISSUER` | no | | An OIDC issuer URL, e.g. `https://auth.misc.page`. When set, the sign-in page offers it. Needs the two variables below and `FLOCK_PUBLIC_URL`. See [OIDC sign-in](#oidc-sign-in). |
| `FLOCK_OIDC_CLIENT_ID` | with an issuer | | The client ID Flock is registered under at the issuer. |
| `FLOCK_OIDC_CLIENT_SECRET` | with an issuer | | The client secret (Flock is a confidential client). |
| `FLOCK_OIDC_NAME` | no | the issuer's host | The name on the sign-in button ("Sign in with …"). |
| `FLOCK_OIDC_TRUST_EMAILS` | no | `false` | Treat every email the issuer returns as verified for the `FLOCK_ADMIN_EMAIL` bootstrap. Only turn it on if the issuer never hands out emails its users haven't proven they own. |
| `FLOCK_PUBLIC_DIR` | no | the built dashboard inside the image | Directory served as the dashboard. Only for development. |
| `FLOCK_SEED_PLAYGROUND` | no | `false` | Creates a "Playground" Project with the fixed keys `pk_production_playground` and `pk_dev_playground`, owned by the `FLOCK_ADMIN_EMAIL` Member if they exist at boot. Only for development and CI; never turn it on for a real Instance. |

Contributors: every new environment variable gets a row here.

## Client IP behind a proxy

Flock uses the visitor's IP for two things: looking up `$country` (and `$region`), and, in cookieless Tracking mode, hashing it with the User-Agent and a daily salt into the Visitor ID. The IP itself is never stored.

Behind a reverse proxy, the connection comes from the proxy, and the visitor's IP is in `X-Forwarded-For`. Any client can put whatever it likes in that header, so Flock only reads it as far as `FLOCK_TRUSTED_PROXIES` says your proxies vouch for it:

| `FLOCK_TRUSTED_PROXIES` | Client IP |
|---|---|
| unset (default) | The connection's address. `X-Forwarded-For` is ignored. Right when Flock is reachable directly. |
| a hop count, e.g. `1` | The address that many entries from the right of `X-Forwarded-For`. Use the number of proxies in front of Flock that each append the address they saw: `1` behind a single Caddy, Traefik, nginx or `tailscale serve`. |
| CIDRs, e.g. `10.0.0.0/8, fd00::/8` | The right-most address in `X-Forwarded-For` (after the connection's address) that isn't in these ranges. Use it when you know your proxies' addresses rather than how many there are. |

Without it, every Event behind a proxy gets the proxy's country, and in cookieless mode all visitors with the same browser look like one Visitor. With a hop count that's too high, a client can choose its own IP; too low, and you get your proxy's IP.

- **Docker Compose** with a reverse proxy on the host: `FLOCK_TRUSTED_PROXIES=1` in `.env`.
- **Railway:** set `FLOCK_TRUSTED_PROXIES=1`. Railway's edge proxy appends the address it sees to `X-Forwarded-For`, so the right-most entry is the client. Railway doesn't document this contract firmly, so check it after deploying: send an Event with a made-up `X-Forwarded-For: 1.2.3.4` and confirm its country is yours, not 1.2.3.4's.

IP geolocation by [DB-IP](https://db-ip.com), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

## OIDC sign-in

Members can sign in with any OpenID Connect issuer. Register Flock with the issuer as a confidential client using the authorization code flow, with the redirect URI

```
<FLOCK_PUBLIC_URL>/api/auth/oauth2/callback/misc
```

and scopes `openid email profile`. Then set `FLOCK_PUBLIC_URL`, `FLOCK_OIDC_ISSUER`, `FLOCK_OIDC_CLIENT_ID` and `FLOCK_OIDC_CLIENT_SECRET`. The usual sign-up rules apply: a first-time OIDC sign-in needs an Invite link (or Open sign-up), and is otherwise sent back to the sign-in page with a message saying to ask for one. An Invite link carries its Invite through the issuer, so "Sign in with …" on an Invite link joins the Instance. An OIDC sign-in can't take over an existing email + password Member with the same email.

### auth-misc (the owner's Instance)

[auth.misc.page](https://auth.misc.page) is the owner's issuer. Add two entries to its app registry:

| Client ID | Type | Redirect URI |
|---|---|---|
| `flock` | confidential | `https://<flock's public host>/api/auth/oauth2/callback/misc` |
| `flock-dev` | confidential | `http://localhost:2101/api/auth/oauth2/callback/misc`, or `https://<machine>.<tailnet>.ts.net/api/auth/oauth2/callback/misc` |

auth-misc only allows `http` for `localhost`, so a dev Instance opened from another device has to be served over https, e.g. with `tailscale serve --bg 2101`, which proxies `https://<machine>.<tailnet>.ts.net` to the dev dashboard. Set `FLOCK_PUBLIC_URL` to exactly the origin registered for the client (`http://localhost:2101` or the `ts.net` URL), and pass the client secret auth-misc shows as `FLOCK_OIDC_CLIENT_SECRET`:

```sh
FLOCK_OIDC_ISSUER=https://auth.misc.page
FLOCK_OIDC_CLIENT_ID=flock            # flock-dev for development
FLOCK_OIDC_CLIENT_SECRET=…
FLOCK_OIDC_NAME=auth.misc.page
FLOCK_PUBLIC_URL=https://flock.example.com
```

If auth-misc returns `email_verified: true` for your account, `FLOCK_ADMIN_EMAIL` works without `FLOCK_OIDC_TRUST_EMAILS`; check the id token before turning trust on.

## Recovering admin access

If no one can sign in as an Instance admin, run the `admin` command inside the container (the other way in, besides `FLOCK_ADMIN_PASSWORD`). It promotes an existing Member, or creates one when given `--password`:

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
