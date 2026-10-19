# Sandbox substitute images (Phase 2 evidence only)

The Phase 2 sandbox could not reach Docker Hub (`registry-1.docker.io` is blocked by its egress
policy), so the pinned upstream images could not be pulled there. To still exercise the stack, the
same component **versions** were rebuilt from their official sources. These images are **not** for
the client and are never part of the offline package.

| Image tag (local only) | Built from | Same version as |
|---|---|---|
| `tybc-spike/postgres:17.11-sbinit` | PostgreSQL `REL_17_11` source tag (`--with-openssl --with-icu --with-uuid=e2fs --with-lz4 --with-zstd`), `supautils` v3.4.4 and `pg-safeupdate` 1.4 from their tags, Supabase `migrations/db` init scripts and migrations from `supabase/postgres@17.11.0.003`, docker-library entrypoint at the commit the upstream Dockerfile pins | `supabase/postgres:17.11.0.003` (minus pgsodium, pg_graphql, vault, pg_net, pg_cron, timescaledb, pgaudit and other extensions the app does not use) |
| `tybc-spike/gotrue:v2.197.0` | Official release binary `auth-v2.197.0-x86.tar.gz` (SHA-256 `9daff5d1…5678f3`) | `supabase/gotrue:v2.197.0` |
| `tybc-spike/postgrest:v14.18` | Official release binary `postgrest-v14.18-linux-static-x86-64.tar.xz` (SHA-256 `98de1c0b…27d299`), `FROM scratch` | `postgrest/postgrest:v14.18` |
| `tybc-spike/nginx:1.24-noble` | Ubuntu 24.04 `nginx` + a template step equivalent to the official image | gateway role (final image chosen on the preparation machine) |
| `tybc-spike/node:22` | Node 22.22.0 | probe runtime |
| `tybc-spike/app:v1.2.1-spike` | v1.2.1 source, sandbox copy only with `output: "standalone"` and `next/font/local` (Phase 3 preview, **not** committed) | — |

Base for the non-scratch images: `debootstrap --variant=minbase noble` imported with `docker import`.
Run with `TYBC_IMG_*` overrides (see `../README.md`). The real pinned images are validated by
`windows/Invoke-TomYum-Phase2Spike.ps1` on a Windows machine.
