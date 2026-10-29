# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS frontend
WORKDIR /build/frontend
RUN npm install --global pnpm@11.25.0
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

FROM rust:1.99-bookworm@sha256:9181b56c2a21ab1d5e73cffe04fc762426d30aa7fac3c91141dd033f49a7fc8b AS backend
WORKDIR /build/backend
COPY backend/ ./
RUN cargo build --release --locked

FROM debian:bookworm-slim@sha256:99c0b25c46d0214d5a2091092e7908907dcaecd6a962cde0ac700acee222b6f3 AS runtime
RUN apt-get update && apt-get install --yes --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 fmn && useradd --uid 10001 --gid fmn --no-create-home fmn \
    && mkdir -p /data /backups && chown fmn:fmn /data /backups
WORKDIR /app
COPY --from=backend /build/backend/target/release/forget-me-not /usr/local/bin/forget-me-not
COPY --from=frontend /build/frontend/dist ./frontend/dist
ENV FMN_DB_PATH=/data/forget-me-not.sqlite FMN_ASSETS_PATH=/app/frontend/dist FMN_ENV=production
COPY LICENSE /usr/share/doc/forget-me-not/LICENSE
USER 10001:10001
EXPOSE 3001
ENTRYPOINT ["forget-me-not"]
