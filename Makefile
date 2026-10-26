PNPM ?= pnpm

.PHONY: help install dev build run check format test test-browser browser-install
help:
	@echo "install       Install locked frontend dependencies"
	@echo "dev           Run the local editor (no Docker)"
	@echo "build         Build the frontend"
	@echo "run           Preview the built frontend"
	@echo "check         Check TypeScript, Svelte, and formatting"
	@echo "format        Format frontend files"
	@echo "test          Run editor model and history tests"
	@echo "browser-install Download Playwright Chromium for browser tests"
	@echo "test-browser  Run browser interaction tests (Playwright Chromium required)"
install:
	$(PNPM) --dir frontend install --frozen-lockfile
dev:
	$(PNPM) --dir frontend dev
build:
	$(PNPM) --dir frontend build
run:
	$(PNPM) --dir frontend preview
check:
	$(PNPM) --dir frontend check
format:
	$(PNPM) --dir frontend format
test:
	$(PNPM) --dir frontend test
test-browser:
	$(PNPM) --dir frontend test:browser

browser-install:
	$(PNPM) --dir frontend exec playwright install chromium
