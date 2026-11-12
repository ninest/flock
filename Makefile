.PHONY: dev db test typecheck build docker

## Start Postgres, the server, the dashboard and the playground (ports 2100-2102).
dev:
	./scripts/dev.sh

## Start only the shared Postgres (container flock-postgres, host port 2432).
db:
	docker ps --format '{{.Names}}' | grep -qx flock-postgres || docker compose up -d --wait postgres

## Seam 1 tests need Postgres running.
test: db
	pnpm test

typecheck:
	pnpm -r typecheck

build:
	pnpm build

docker:
	docker build -t flock .
