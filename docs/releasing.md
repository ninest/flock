# Releasing

1. Merge to `main` with CI green.
2. Tag and push: `git tag v1.2.3 && git push origin v1.2.3`. Use semver: a breaking change (including a schema change that breaks the previous release, see [migrations.md](migrations.md)) needs a new major.
3. `.github/workflows/release.yml` builds the image, runs the boot, compose and previous-release checks, then publishes `ghcr.io/ninest/flock` as `1.2.3`, `1.2`, `1` and `latest`. Pre-release tags (`v1.3.0-rc.1`) are published under their own tag only.

## One-time setup (owner, manual)

These need the owner's accounts, so they are not automated.

### GHCR package visibility

The repository is private, so the first published package is private too. For self-hosters to pull it: GitHub → your profile → Packages → `flock` → Package settings → Change visibility → Public. Also check that "Manage Actions access" lists `ninest/flock` with write access (it does by default for packages created by the repository's workflow).

### Railway template

Railway templates are created in the Railway dashboard, not from a file in the repository (`railway.json` config-as-code only applies to services built from a repository, not to image-sourced ones).

1. Create a project with a Postgres service and a service from the image `ghcr.io/ninest/flock:1`, set up as in [self-hosting.md](self-hosting.md#railway): `DATABASE_URL=${{Postgres.DATABASE_URL}}`, healthcheck path `/api/health`, automatic image updates on, a generated domain.
2. Check that it boots and that `https://<domain>/api/health` answers `{"status":"ok"}`.
3. Project settings → Generate template from project (or Workspace → Templates → New template with the same two services). Describe the `DATABASE_URL` variable, then publish.
4. Put the template's deploy link ("Deploy on Railway" button) in `README.md` and `docs/self-hosting.md`.
5. The owner's own Instance: deploy from that template.
