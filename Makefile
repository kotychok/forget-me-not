PNPM ?= pnpm
CARGO ?= cargo

.PHONY: help install dev build run check format test test-browser browser-install db-migrate auth-bootstrap auth-reset test-browser-auth
help:
	@echo "install         Install locked frontend and backend dependencies"
	@echo "dev             Run frontend and backend locally (no Docker)"
	@echo "build           Build frontend and backend"
	@echo "run             Serve the built application on localhost:3001"
	@echo "auth-bootstrap LOGIN=name Create the first local administrator (hidden password prompt)"
	@echo "auth-reset LOGIN=name     Recover the local administrator password and revoke sessions"
	@echo "test-browser-auth         Run isolated authenticated browser tests"
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

# Passwords are read from the terminal, never passed as command arguments.
auth-bootstrap:
	$(CARGO) run --locked --manifest-path backend/Cargo.toml -- --bootstrap-local-admin "$(LOGIN)"
auth-reset:
	$(CARGO) run --locked --manifest-path backend/Cargo.toml -- --reset-admin-password "$(LOGIN)"
test-browser-auth:
	$(PNPM) --dir frontend exec playwright test --config playwright.auth.config.ts
