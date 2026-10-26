PNPM ?= pnpm
CARGO ?= cargo

.PHONY: help install dev build run check format test test-browser browser-install db-migrate
help:
	@echo "install         Install locked frontend and backend dependencies"
	@echo "dev             Run frontend and backend locally (no Docker)"
	@echo "build           Build frontend and backend"
	@echo "run             Serve the built application on localhost:3001"
	@echo "db-migrate      Apply embedded migrations to FMN_DB_PATH"
	@echo "check           Check Rust formatting/clippy, Svelte/TypeScript, and formatting"
	@echo "format          Format frontend and backend files"
	@echo "test            Run model, autosave, and backend integration tests"
	@echo "browser-install Download Playwright Chromium"
	@echo "test-browser    Run isolated full-stack browser tests"
install:
	$(PNPM) --dir frontend install --frozen-lockfile
	$(CARGO) fetch --locked --manifest-path backend/Cargo.toml
dev:
	CARGO="$(CARGO)" PNPM="$(PNPM)" node scripts/dev.mjs
build:
	$(PNPM) --dir frontend build
	$(CARGO) build --locked --manifest-path backend/Cargo.toml
run:
	$(CARGO) run --locked --manifest-path backend/Cargo.toml
check:
	$(PNPM) --dir frontend check
	$(CARGO) fmt --manifest-path backend/Cargo.toml --check
	$(CARGO) clippy --locked --manifest-path backend/Cargo.toml --all-targets -- -D warnings
format:
	$(PNPM) --dir frontend format
	$(CARGO) fmt --manifest-path backend/Cargo.toml
test:
	$(PNPM) --dir frontend test
	$(CARGO) test --locked --manifest-path backend/Cargo.toml
test-browser:
	$(PNPM) --dir frontend test:browser
browser-install:
	$(PNPM) --dir frontend exec playwright install chromium
db-migrate:
	$(CARGO) run --locked --manifest-path backend/Cargo.toml -- --migrate
