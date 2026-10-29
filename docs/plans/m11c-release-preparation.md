# M11c — Release preparation

Authorized 2026-10-29 after the user prepared the small DigitalOcean VPS. This stage prepares reviewable release artifacts; it does not deploy to the VPS or publish a package.

Implemented:

- Multi-stage, digest-pinned Docker build with the repository's pnpm version, locked Cargo dependencies, frontend assets, MIT notice and non-root runtime. Source-only build context excludes local dependencies, build output, databases and environment files.
- Explicit production HTTP policy: required canonical HTTPS origin and password mode, container listener, configured-account/assets checks, Secure host-only session cookie, unchanged CSRF/ownership/installation guards and no forwarded-header trust. Native local policy remains the default. SIGTERM supports Docker shutdown.
- Independent application and shared-edge Compose projects. Only Caddy publishes ports; project networks, persistent data/certificate volumes, bounded logs, readiness and finite failure restarts are explicit.
- Pinned GitHub Actions: checks, native tests and both browser suites precede image build and disposable container smoke tests. Version-tag pushes alone publish the exact tested image to GHCR. No automatic SSH deployment, user provisioning, tag push or publication was performed.
- Makefile image/test/operating commands and the step-by-step guide, including temporary sslip.io hosting and version/digest selection, hidden-password bootstrap, updates and off-host recovery requirements.

Verification:

- `make check` and final Clippy/format checks passed; `make build` passed.
- 66 frontend tests and 56 Rust integration tests passed, including four new production tests for canonical origin validation, Host/Origin/forwarded-header rejection, cookie flags, fail-before-database configuration and database readiness failure.
- All 50 editor and 4 authenticated browser scenarios passed with disposable data.
- The Docker image built successfully on local linux/arm64. Source context is approximately 418 KiB; local dependency/build directories are excluded. The final container smoke test passed, including a separate peer-container request, non-root execution, assets, secure login, restart persistence and snapshot verification/restoration. All synthetic containers, volumes and networks were removed.
- Both Compose files parsed successfully, GitHub Actions YAML parsed, and the Caddyfile validated in the official Caddy image. No real certificate request was made.
- CI targets linux/amd64 for the VPS; that CI run and actual GHCR publication are still pending the user's commit/push. The local ARM image is not presented as an already verified amd64 release.

Public HTTPS, actual GHCR publication, VPS resource measurements and off-host restore remain pending deployment checks, so M11c is not complete.
