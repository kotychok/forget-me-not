# VPS deployment guide

Updated: 2026-10-29. Agreed direction: DigitalOcean, 1 vCPU / 1 GiB RAM / 25 GiB disk; no Coolify on this VPS; GitHub Actions builds images, GHCR stores them, and Caddy provides shared HTTPS for several small projects. Initial deployments are manual over SSH.

**Status: M11c release preparation implemented locally; public deployment is not yet verified.** Dockerfile, production Compose examples, a pinned Actions workflow and container smoke tests are provided. No image has been published and no server has been changed by this work.

## 1. Review the release setup in the repository

- `Dockerfile` builds frontend assets and a locked Rust release binary in separate stages. The runtime contains the binary, assets, certificate roots and curl for health checks; it runs as UID/GID 10001. `.dockerignore` allowlists build sources and excludes databases, credentials and personal files.
- `FMN_ENV=production` requires `FMN_AUTH_MODE=password` and one `FMN_PUBLIC_ORIGIN=https://hostname` (lowercase DNS name, no port/path/trailing slash). It binds to 0.0.0.0 inside the container, requires built assets and configured accounts, and uses a host-only Secure/HttpOnly `__Host-fmn.sid` cookie. Host and Origin are checked against the configured address. Forwarded headers never choose trusted origin or identity. Native local mode remains loopback-only with its existing cookie.
- `deploy/compose.yaml` persists data and backups, publishes no application ports, bounds logs, probes database readiness and handles SIGTERM gracefully. Failed startup exits visibly; retries are limited to three. An unhealthy running process is reported, not automatically repaired.
- `.github/workflows/ci.yaml` runs checks, unit/integration tests and both disposable browser suites. A dependent job builds linux/amd64 and smoke-tests the image. Only a version-tag push publishes that exact tested image to GHCR, without rebuilding it. Pull requests and main-branch pushes do not publish. The job summary records the immutable image digest.
- Actions and base images are pinned by commit/digest; pnpm is pinned to 11.25.0 and the Rust build uses 1.99. Review/update these pins periodically. The workflow uses `GITHUB_TOKEN` with package write permission only in the image job; no registry PAT is needed for CI. Checkout credentials are not persisted.

Local commands (Docker required only for the last two):

```sh
make check
make test
make build
make image-build IMAGE=forget-me-not:local
make test-container IMAGE=forget-me-not:local
```

The container test creates randomly named synthetic networks/volumes/containers and removes them afterward. It checks non-root execution, production guards, built assets, secure login, restart persistence and backup/restore. It never accesses the normal development database.

## 2. Create the VPS and establish SSH access

Choose an Ubuntu 24.04 LTS x86-64 VPS and add your SSH public key during provisioning. Keep the private key on your own computer. Record the server IP, region and recovery access outside the repository.

From your computer (replace SERVER_IP):

```sh
ssh root@SERVER_IP
```

On a fresh server, update the OS and create a daily administration account:

```sh
apt update
apt upgrade
adduser deploy
usermod -aG sudo deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
install -m 600 -o deploy -g deploy /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
```

Open a second terminal and verify `ssh deploy@SERVER_IP` and `sudo -v` before closing the original session or tightening SSH settings. Use key-based SSH; retain provider console/recovery access.

Configure the DigitalOcean cloud firewall for inbound TCP 80/443 from the Internet and SSH TCP 22 from your administration IP where practical. If IPv6 is enabled, configure its rules too. Do not open application/database ports. Keep required outbound connectivity for DNS, package updates, GHCR and certificate issuance.

## 3. Install Docker Engine and Compose

Follow the current [official Ubuntu installation instructions](https://docs.docker.com/engine/install/ubuntu/) using Docker's apt repository. Install Engine, Buildx and the Compose plugin. Do not install a separate legacy docker-compose binary.

Verify on the VPS:

```sh
sudo docker version
sudo docker compose version
sudo docker run --rm hello-world
sudo systemctl enable --now docker
```

This guide uses sudo for Docker; membership of the docker group grants root-level control. Docker-published ports can bypass UFW rules: publish only Caddy's ports and also enforce the cloud firewall.

Create the deployment directories and a dedicated proxy network for this application:

```sh
sudo install -d -m 750 -o deploy -g deploy /opt/pets/edge /opt/pets/forget-me-not
sudo docker network create fmn-edge
```

For each additional project, create a separate network and attach Caddy to it. Do not place every application on a single shared network. The proxy can reach each app; unrelated apps do not gain direct connectivity through the proxy networks.

## 4. Configure DNS

Choose a real hostname, for example lists.example.com. Add an A record pointing to the VPS IPv4 address. Add an AAAA record only when IPv6 is configured and reachable. Other projects get separate hostnames pointing to the same VPS.

Check DNS from your computer:

```sh
dig +short lists.example.com A
dig +short lists.example.com AAAA
```

Replace example hostnames everywhere below. Keep DNS pointing directly to the VPS for the initial setup.

Without your own domain, a temporary address such as `fmn.138.68.187.159.sslip.io` resolves to the embedded VPS IP automatically. Check it with `dig +short fmn.138.68.187.159.sslip.io A`. Use that hostname consistently in both environment files. This is a third-party DNS dependency; certificate issuance still requires reachable ports 80/443. DigitalOcean Droplets do not receive App Platform's `ondigitalocean.app` starter domains. See [sslip.io](https://sslip.io/) and [App Platform domains](https://docs.digitalocean.com/products/app-platform/how-to/manage-domains/). Changing hostnames later also changes the browser origin and its local draft storage; save or export pending edits first.


## 5. Publish and select the application image

After the step 1 setup is reviewed and committed, the user creates/pushes a version tag to trigger the release workflow. Confirm its checks and publishing job succeeded. The resulting name is:

```text
ghcr.io/GITHUB_OWNER/forget-me-not:v0.2.0
```

Use a lowercase owner/image path. In GitHub Packages, explicitly check package visibility: a newly published package is private by default. A public image can be pulled anonymously; source repository visibility and package visibility are separate settings.

For a private image, use a dedicated PAT (classic) with read:packages and access to that package. On the VPS, run `sudo docker login ghcr.io --username YOUR_GITHUB_LOGIN` and enter the token at the password prompt. Do not put it into a command argument, Compose, Git or shell history. This login stores credentials for root; protect the Docker config. CI publishing uses GITHUB_TOKEN instead of this server token.

Inspect the published image digest and record the exact version, source commit and digest for the release. Use `ghcr.io/owner/forget-me-not@sha256:...` in the application deployment configuration, rather than a moving latest tag.

## 6. Install the application Compose configuration

From your computer, copy `deploy/compose.yaml` and `deploy/.env.example` into `/opt/pets/forget-me-not/` on the VPS. Copy `deploy/edge/compose.yaml`, `deploy/edge/Caddyfile` and `deploy/edge/.env.example` into `/opt/pets/edge/`. For the current server, SSH uses `deploy@138.68.187.159`; do not put SSH private keys into these files or images.

On the VPS:

```sh
cd /opt/pets/forget-me-not
cp .env.example .env
chmod 600 .env
```

Edit .env: set FMN_IMAGE to the published `ghcr.io/kotychok/forget-me-not@sha256:...` and FMN_HOST to the chosen hostname, without https://. The temporary sslip.io hostname is prefilled. FMN_DB_FILE selects a filename inside /data; retain its default for a new installation. Keep .env outside Git.

```sh
sudo docker compose config --quiet
sudo docker compose pull
```

For a **new empty installation**, bootstrap your administrator with a hidden interactive password prompt:

```sh
sudo docker compose run --rm app --bootstrap-local-admin YOUR_LOGIN
sudo docker compose up -d --wait
sudo docker compose logs --tail=100 app
```

Replace YOUR_LOGIN; the password is never a command argument. For an existing installation, use its verified backup/restore workflow instead of creating a replacement owner. Named volumes are initialized with the image's non-root /data and /backups ownership; an imported bind mount needs matching UID/GID 10001 explicitly.

The service has no published host port. Caddy reaches alias forget-me-not on fmn-edge at internal port 3001. The built frontend is served by Rust; no Vite, Node runtime, compiler or external database service runs on the VPS. Use only one replica with this SQLite data volume.

From a repository checkout, `make deploy-config`, `make deploy-pull`, `make deploy-up` and `make deploy-logs` use deploy/.env; these commands do not connect to a remote machine automatically.

## 7. Start the shared Caddy proxy

Use the provided `deploy/edge/compose.yaml` and `Caddyfile` copied in step 6. In /opt/pets/edge:

```sh
cp .env.example .env
chmod 600 .env
sudo docker pull caddy:2
sudo docker image inspect caddy:2 --format '{{index .RepoDigests 0}}'
```

The edge .env.example includes the Caddy digest validated during preparation. Review it or set CADDY_IMAGE in .env to the resulting reviewed `caddy@sha256:...` digest and set FMN_HOST to exactly the same hostname as the application .env. The Caddyfile reads that variable and proxies to forget-me-not:3001. Only Caddy publishes TCP 80/443; its certificate/config volumes are persistent.

Once the application is running on its network, validate and start the proxy:

```sh
cd /opt/pets/edge
sudo docker compose config --quiet
sudo docker compose run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo docker compose up -d
sudo docker compose logs --tail=100 caddy
```

Caddy obtains/renews certificates and redirects HTTP to HTTPS when DNS and ports are correct. Persist its /data volume across container replacements. This example uses TCP HTTPS; HTTP/3 UDP exposure is optional, not required.

To add another project, create its own proxy network, attach Caddy and the target service to it, and add a hostname block pointing to that service's unique alias and internal port. Internal port 3001 may be reused in different containers. Recreate the Caddy service when changing its network attachments; for Caddyfile-only changes, validate then reload with `sudo docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile`.

## 8. Verify the first installation

Open the real HTTPS hostname and check:

- Valid certificate, HTTP redirect and successful login. The session cookie is Secure/HttpOnly and restricted to this hostname; local auth bypass is unavailable.
- Create/edit/reload a synthetic list, sign out/in, and verify persistence after an application container restart.
- A second synthetic account cannot access the first account's lists; administration, activation links and session revocation work over the public origin.
- Unapproved Host/Origin requests and forged proxy headers cannot bypass request checks. Port 3001 is unreachable directly from the Internet.
- Stop/start both Compose projects and verify data and certificate persistence. Complete the off-host backup/restore drill before storing the only copy of important data.

Record the image digest, migration state and observed checks. Deployment is not verified just because the landing page loads.

## 9. Back up, update and recover

Use the application's consistent SQLite snapshot commands, not a raw copy of a live WAL database. See [backup and restore](backup-restore.md). The runtime entrypoint exposes those existing CLI commands without Cargo. Store encrypted copies off this VPS, retain multiple generations, and test retrieval/restore to a fresh destination. Decide the schedule, destination, retention and key storage before release; these are not automated by this guide.

On the VPS, from /opt/pets/forget-me-not, create a uniquely named snapshot and verify it:

```sh
sudo docker compose exec app forget-me-not --backup /backups/before-v0.2.0.sqlite
sudo docker compose exec app forget-me-not --verify-backup /backups/before-v0.2.0.sqlite
sudo docker compose cp app:/backups/before-v0.2.0.sqlite ./before-v0.2.0.sqlite
sudo chown deploy:deploy ./before-v0.2.0.sqlite
chmod 600 ./before-v0.2.0.sqlite
```

Copy the verified file to protected off-host storage (for example scp from your computer); the copied local file still lives on the VPS until transferred. Choose a new filename each time; snapshots refuse overwrite. For a write-free maintenance window use `docker compose stop app`, then `docker compose run --rm app --backup /backups/NEW_NAME.sqlite` against the same data volume.

For each update:

1. Read release/migration notes. Record the current image digest and active database path.
2. Create and verify a pre-upgrade snapshot using the current image; copy it off-host. If no writes may be lost on rollback, put the application into a deliberate maintenance window and stop writes before taking that snapshot.
3. Set the new reviewed image digest in the app deployment configuration.
4. From /opt/pets/forget-me-not, run `sudo docker compose pull`, then `sudo docker compose up -d`. Inspect application logs and repeat login/save/reload checks.
5. Retain the previous image and backup until the release is accepted.

Restarting the previous image is safe only if it supports the current database schema. Otherwise stop application writes, restore the pre-upgrade snapshot into a fresh database path with a compatible maintenance image, select the matching application image and deliberately switch the active path. For example, after stopping app, select the intended compatible image in .env, then run `sudo docker compose run --rm -e FMN_DB_PATH=/data/restored.sqlite app --restore-backup /backups/before-v0.2.0.sqlite` (restored.sqlite must not exist). Verify with `sudo docker compose run --rm app --verify-backup /data/restored.sqlite`; only then set FMN_DB_FILE=restored.sqlite in .env and start app with the matching image. Restore invalidates sessions/links and changes browser draft scope; later writes absent from the snapshot are lost. Never overwrite the live database or run older migrations backwards by hand.

Do not run `docker compose down -v` on persistent projects. Do not use indiscriminate volume/image pruning; it can remove data or rollback images. Inspect before deleting specific unused images.

## 10. Observe the small VPS

```sh
free -h
df -h
sudo docker stats --no-stream
sudo docker system df
```

Measure memory during login/password hashing, imports, searches and simultaneous project use. 1 GiB is a starting budget, not a guarantee for an unknown number of apps. Build on GitHub-hosted runners, keep log rotation enabled, and monitor disk growth from images, SQLite and backups. Review limits and swap after measurement; swap is not a substitute for enough RAM.

## References

- [Docker Engine on Ubuntu](https://docs.docker.com/engine/install/ubuntu/): installation and firewall behavior.
- [GitHub Actions image publishing](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images): workflow authentication and publishing.
- [GHCR](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry): package visibility and token permissions.
- [Caddy with Docker Compose](https://caddyserver.com/docs/running#docker-compose) and [automatic HTTPS](https://caddyserver.com/docs/automatic-https): proxy lifecycle and certificates.
