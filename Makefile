UV_CACHE_DIR := $(CURDIR)/.uv-cache

.PHONY: setup dev lint typecheck test generate-client check-client build smoke-real reconcile-assets e2e

setup:
	command -v pnpm >/dev/null
	command -v uv >/dev/null
	pnpm install --frozen-lockfile
	UV_CACHE_DIR=$(UV_CACHE_DIR) uv sync --directory services/api --all-groups
	$(MAKE) generate-client
	pnpm exec playwright install chromium

dev:
	pnpm dev

lint:
	cd services/api && UV_CACHE_DIR=$(UV_CACHE_DIR) uv run ruff check app tests
	pnpm lint

typecheck:
	cd services/api && UV_CACHE_DIR=$(UV_CACHE_DIR) uv run mypy app
	pnpm typecheck

test:
	cd services/api && UV_CACHE_DIR=$(UV_CACHE_DIR) uv run python -m pytest
	pnpm test:web

generate-client:
	cd services/api && UV_CACHE_DIR=$(UV_CACHE_DIR) uv run python ../../scripts/generate_api_client.py

check-client: generate-client
	git diff --exit-code -- packages/api-client/src/generated.ts

build:
	UV_CACHE_DIR=$(UV_CACHE_DIR) uv build --directory services/api
	pnpm build:web

smoke-real:
	cd services/api && UV_CACHE_DIR=$(UV_CACHE_DIR) uv run --group cloud python -m app.smoke_real

reconcile-assets:
	cd services/api && UV_CACHE_DIR=$(UV_CACHE_DIR) uv run --group cloud python -m app.reconcile_assets

e2e:
	pnpm e2e
