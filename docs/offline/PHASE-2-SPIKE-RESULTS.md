# Phase 2 — Offline Docker Foundation Spike: Results

| Field | Value |
|---|---|
| Status | **Spike executed; Windows-side gates NOT TESTED** — stopped for approval before Phase 3 |
| Date | 2026-10-19 |
| Branch | `feat/offline-docker-v1` (local only, no upstream) from `v1.2.1` = `53ed3f7`; all Phase 2 files uncommitted |
| Approvals in force | A-1 Phase 2; A-2 prerequisite installation (after read-only check); O-1 `DOCKER_DESKTOP_LICENSE_ELIGIBILITY=CONFIRMED`; O-2 Ollama pinned to `11434` |
| Evidence | [`evidence/phase2-sandbox/`](evidence/phase2-sandbox/README.md) (synthetic data, no secrets) |

> Rule applied throughout: **NOT TESTED is never reported as PASS.** Results from the Linux sandbox are labelled as such and are not evidence for the client notebook.

---

## 1. Summary

| # | Phase 2 item | Result | Where proven |
|---|---|---|---|
| G | Git isolation (branch, tag, `main`, Cloud, Vercel untouched) | **PASS** | Developer workstation repo (§3) |
| 2.1 | Read-only prerequisite checker implemented | **PASS** (logic: 46/46 self-test assertions) | PowerShell 7.5.4 with fakes |
| 2.1 | Checker run on the client notebook | **NOT TESTED** | Client notebook not connected (§2) |
| 2.2 | Exact versions exist upstream | **PASS** (source tags + release binaries verified) | GitHub tags / release assets |
| 2.2 | Image digests, architecture, size recorded | **NOT TESTED** | Docker Hub blocked by the sandbox egress policy |
| 2.2 | Offline image strategy (`pull` → `save` → `load`, lock + verification) | **PASS** (round trip + tamper test in sandbox) | Scripts §5 |
| 2.3 | Minimal Supabase compatibility (version-exact substitute builds) | **PASS** — 33/33 checks + unchanged app UI end-to-end | Linux sandbox (§6) |
| 2.3 | Schema parity: repo migrations vs Production schema dump (local backup file, 2026-10-15) | **PASS** — columns, constraints, indexes, policies, functions, triggers, view, RLS and grants identical | Linux sandbox (§6.1) |
| 2.3 | Same with the upstream pinned images | **NOT TESTED** | Needs Docker Hub / Windows run |
| 2.4 | **S1** container → `host.docker.internal:11434` → native Windows Ollama | **NOT TESTED** (hard gate still open) | Kit ready (§7) |
| 2.4 | Ollama accepts `host.docker.internal` Host header; rejects others | **PASS** (Ollama 0.40.6) | Sandbox (§7) |
| 2.5 | Container stack RAM | **PASS** — ≈ 230 MiB peak under load | Linux sandbox (§8) |
| 2.5 | Ollama idle/peak, Windows headroom on 16 GB | **NOT TESTED** | Client notebook |
| 2.6 | External volume survives `stop`, `down`, `down -v`, `SIGKILL` | **PASS** (Linux Docker Engine) | §9 |
| 2.6 | Same on Docker Desktop for Windows | **NOT TESTED** | Kit ready |
| 2.7 | Offline artifact inventory | **PASS** (inventory complete; sizes/digests TBD by the export script) | §10 |

**Hard stop gates (Phase 2 brief):**

| Gate | Status |
|---|---|
| 1 Ollama requires `0.0.0.0` / LAN exposure | **Not determined** — S1 not run on Windows. Linux negative control shows S1 depends on Docker Desktop's `host.docker.internal` forwarding (§7). |
| 2 Pinned Supabase components incompatible | No evidence of incompatibility (exact versions, substitute packaging). Upstream images still to be run. |
| 3 RLS/auth semantics not reproducible | **Reproduced** (D01–D15, C01–C16) and the migrated schema is identical to the Production schema dump (§6.1). |
| 4 Notebook cannot support the stack in 16 GB | No evidence: stack ≈ 0.23 GiB measured; Ollama unmeasured. |
| 5 Docker Desktop licence not confirmed | **Confirmed** (recorded in `deploy/offline/decisions.env`). |
| 6 Production Cloud would need modification | **No.** |
| 7 Ledger architecture would need weakening | **No** — immutability, idempotency and grants verified unchanged. |

## 2. Environments

| Env | What it is | Used for | Limits |
|---|---|---|---|
| **E1 sandbox** | Linux VM, Docker Engine 29.8.2, Compose v5.5.1, 2 vCPU, 7.8 GB | Stack spike, compatibility, persistence, RAM, UI end-to-end, script validation | Egress policy blocks `registry-1.docker.io`, `auth.docker.io`, `ghcr.io`, `public.ecr.aws`, `ollama.com`, `registry.ollama.ai`, `huggingface.co`, `fonts.googleapis.com`; GitHub and npm reachable |
| **E2 developer workstation** (`laptop-thefeem`, Windows, Intel Core 5 120U) | Repository host, reached through a Linux file VM | Git operations, file delivery | No Windows command execution from this session; no Docker Desktop installed (no `~/.docker`); **not** the client notebook |
| **E3 client notebook** (Ryzen 7 6800H, 16 GB) | Target | — | **Not connected to this session** |

Consequence: every Windows / Docker Desktop / native-Ollama measurement is **NOT TESTED** and has a ready-to-run kit (§11).

## 3. Git isolation — PASS

| Check | Evidence |
|---|---|
| Branch | `feat/offline-docker-v1` created from `v1.2.1`, checked out; no upstream configured; no `.lock` files left |
| Base | `HEAD` = `53ed3f75790f…`; `git merge-base --is-ancestor 53ed3f7 HEAD` → true |
| `v1.2.1` unchanged | annotated tag object `b17bce46ed53…` → commit `53ed3f75790f…` (as before) |
| `main` unchanged | `main` = `origin/main` = `53ed3f75790f…` |
| Production | No request was made to Supabase Cloud or Vercel from any environment; `.env.local` was never printed, copied or modified (modification time unchanged since 2026-10-15; the checker only tests that it exists) |
| Vercel Preview risk | Remote is GitHub; the repo has no `vercel.json`/`.vercel`. Vercel's Git integration builds **Preview deployments for every pushed branch** by default, and an existing remote branch (`feat/local-ai-v1.1`) suggests branches have been pushed before. A pushed `feat/offline-docker-v1` would therefore likely create a public Preview build that uses the project's Preview environment variables (possibly the Cloud Supabase keys). **Nothing was pushed.** Before any push: confirm the Vercel Preview settings, or add an Ignored Build Step for `feat/offline-*` (a Vercel project change → needs approval). |

## 4. 2.1 Prerequisite checker

Files: `scripts/windows/Test-TomYum-OfflinePrerequisites.ps1` (+ `.cmd`), self-test `scripts/windows/tests/Test-TomYum-OfflinePrerequisites.SelfTest.ps1`.

- Read-only by construction: CIM queries, `wsl --version/--status/--list`, `docker version/info/compose version`, `Get-NetTCPConnection`, `Get-NetFirewallApplicationFilter`, `GET /api/version|tags` on `127.0.0.1:11434`, `w32tm /query`, `powercfg /query`, read-only Git. It never installs, enables, starts or configures anything and never reads `.env*` content.
- Covers everything the brief lists: P01 Windows, P02 x64, P03 RAM, P04 disk, P05 BIOS virtualization, P06 WSL, P07 Windows features (non-admin via `Win32_OptionalFeature`), P08 Docker Desktop, P09 Engine, P10 Compose, P11 Docker VM memory/`.wslconfig`, P12 ports, P13 Ollama executable, P14 API, P15 `qwen3.5:4b`, P16 Ollama exposure (listener, `OLLAMA_HOST`, inbound firewall rules), P17 clock (time zone, plausibility, last sync, **Docker VM drift via `docker info` SystemTime**), P18 sleep-on-AC, P19 repository state, P20 licence record.
- Output: table + hints, optional JSON (`-OutFile`, `-Json`); exit 0/1/2.

| Test | Result |
|---|---|
| Self-test (fakes for every system read; 20 scenarios incl. Ollama on `0.0.0.0`, BIOS off, features off, no Docker, engine stopped, model missing, port conflicts, ARM64, VM drift, uncapped VM, moved release tag) | **PASS** — 46/46 assertions |
| Defects found and fixed by testing | `$null` listener treated as exposed; Docker's 9-digit fractional `SystemTime`; PowerShell 7 JSON date conversion |
| Degraded run on Linux (no Windows APIs) | **PASS** as robustness proof — no crash, Windows checks report NOT CHECKED |
| Real run on the client notebook | **NOT TESTED** |

## 5. 2.2 Pinned container artifacts

| Component | Repository | Tag | Upstream version proof | Digest | Arch | Size |
|---|---|---|---|---|---|---|
| PostgreSQL | `supabase/postgres` | `17.11.0.003` | Git tag `17.11.0.003` → `e60902168c6f…`; `nix/config.nix` PostgreSQL `17.11` | NOT TESTED | NOT TESTED | NOT TESTED |
| GoTrue | `supabase/gotrue` | `v2.197.0` | Git tag → `4eee58f296d9…`; release binary reports `v2.197.0` (SHA-256 `9daff5d1939c…5678f3`) | NOT TESTED | NOT TESTED | NOT TESTED |
| PostgREST | `postgrest/postgrest` | `v14.18` | Git tag → `6fafa601d13b…`; release binary reports `PostgREST 14.18` (SHA-256 `98de1c0be778…27d299`) | NOT TESTED | NOT TESTED | NOT TESTED |
| Gateway | nginx (official or unprivileged, alpine) | **to be chosen** (exact version tag) | — | NOT TESTED | — | — |

No version was substituted. The digests cannot be resolved from this session because Docker Hub is blocked by the sandbox egress policy — the versions themselves are available upstream. Two ways to close this: run `Export-TomYum-OfflineImages.ps1` on an Internet-connected Windows machine with Docker Desktop (recommended, it also builds the package), or have an organisation admin allow `registry-1.docker.io`, `auth.docker.io` and `production.cloudflare.docker.com` for this workspace.

**Offline image strategy (implemented):**

1. `scripts/windows/offline-prep/Export-TomYum-OfflineImages.ps1` (preparation machine, online): `docker pull --platform linux/amd64` → inspect (registry digest, image ID, os/arch, size) → **stop** if a tag cannot be pulled, is floating (`latest`, `stable`, `alpine`…), is not linux/amd64, or resolves to a digest different from an existing lock → `docker save` → SHA-256 → writes `deploy/offline/images.lock.json` and `images/SHA256SUMS.txt`.
2. `scripts/windows/offline-prep/Import-TomYum-OfflineImages.ps1` (client, offline): SHA-256 check → `docker load` → **image ID must equal the lock**.
3. Compose uses `pull_policy: never`, so a missing image fails fast instead of reaching for a registry.

Sandbox proof: save → remove → import → image ID identical; one-byte tamper → import refused (evidence `image-roundtrip.txt`).

## 6. 2.3 Minimal Supabase compatibility — PASS (sandbox, substitute packaging)

**Fidelity statement.** Docker Hub was unreachable, so each component was rebuilt from its official source at the **same version**: PostgreSQL `REL_17_11` + `supautils` v3.4.4 + `pg-safeupdate` 1.4 + the Supabase init scripts/migrations from `supabase/postgres@17.11.0.003` run by the same docker-library entrypoint; GoTrue and PostgREST from their official release binaries; nginx 1.24 for the gateway role. Missing versus upstream: pgsodium, pg_graphql, vault, pg_net, pg_cron, pgaudit, timescaledb and other extensions the app does not use (`deploy/offline/spike/sandbox/README.md`). The same checks must be repeated with the upstream images (NOT TESTED).

Topology exercised exactly as planned: `db` → `auth` (GoTrue migrations) → `migrate` (10 repo migrations as role `postgres`) → `rest` → `gateway`; `tybc_backend` internal network; external volume; only `127.0.0.1:3100` published (app profile). Cold initialisation of an empty volume: **13 s**.

| ID | Check | Result | Detail |
|---|---|---|---|
| STACK | Startup graph healthy | PASS | migrate: 10 applied; on restart 0 applied (`skip` ×10) |
| D01 | Supabase roles | PASS | anon/authenticated nologin; authenticator login; service_role BYPASSRLS; supabase_admin super; supabase_auth_admin login |
| D02 | Role wiring | PASS | authenticator NOINHERIT and member of anon/authenticated/service_role |
| D03 | `postgres` demoted | PASS | not superuser (Supabase behaviour) |
| D04 | `auth.uid()/role()/jwt()` exist | PASS | |
| D05 | GoTrue auth schema | PASS | 82 migrations, latest `20260831180000` |
| D06 | Repo migration history | PASS | 10 rows `20261009091639`…`20261010061943` in `supabase_migrations.schema_migrations` |
| D07 | 18 public tables, RLS on all | PASS | |
| D08 | Policies | PASS | 17 |
| D09 | `SECURITY DEFINER` functions | PASS | **11 distinct** functions, all `search_path=''` (Phase 0 reported 14) |
| D10 | Triggers enabled | PASS | 31 user triggers incl. `on_auth_user_created` |
| D11 | Ledger immutability (even superuser) | PASS | UPDATE and DELETE rejected: "Confirmed stock movements are immutable…" |
| D12 | Idempotency duplicates | PASS | 0 |
| D13 | Ledger grants | PASS | authenticated INSERT=false; service_role INSERT=true, UPDATE=false |
| D14/D15 | Version / encoding | PASS | PostgreSQL 17.11; UTF8 |
| C01 | Gateway | PASS | healthz 200; no/unknown apikey 401; unknown path 404; GoTrue `v2.197.0` via gateway |
| C02 | Sign-up disabled | PASS | "Signups not allowed for this instance" |
| C03 | Admin user creation + `handle_new_user` | PASS | both new users got STAFF profiles |
| C04 | Bootstrap first OWNER (service role) | PASS | `user_has_permission(owner,'users.manage')` = true |
| C05 | OWNER password sign-in through gateway | PASS | JWT role/aud `authenticated`, `session_id` present, HS256 |
| C06 | `auth.getClaims()` (used by `src/proxy.ts`) | PASS | |
| C07 | `auth.uid()` in RLS | PASS | OWNER sees 2 profiles, STAFF sees only own |
| C08 | `has_permission()` from JWT | PASS | OWNER true / STAFF false for `users.manage`; STAFF true for `inventory.view` |
| C09 | Service-role write path as the app does it | PASS | item + base-unit trigger, Stock In insert, `record_stock_out` RPC, `inventory_balances` = 1700 g |
| C10 | RLS distinguishes roles | PASS | anon → `42501`; OWNER/STAFF see item; STAFF sees 0 suppliers (no `purchase.view`) |
| C11 | Ledger write path server-only | PASS | authenticated INSERT, service-role UPDATE/DELETE → `42501` |
| C12 | Idempotency replay | PASS | second call `23505`; 1 row |
| C13 | Forged JWT (wrong secret) | PASS | 401 |
| C14 | Expired JWT | PASS | 401 |
| C15 | Refresh rotation; sign-out revokes | PASS | reuse → "Refresh Token Not Found" |
| C16 | Admin password reset (OWNER reset design) | PASS | new works, old fails |
| UI | **Unchanged v1.2.1 UI** against the stack (sandbox build) | PASS | synthetic OWNER signs in; cookie `sb-gateway-auth-token`; 10 pages 200 (dashboard, inventory, movements, stock-in/out, waste, stock-count, purchase-orders, suppliers, reports); data visible; Thai text and Buddhist-era date render |

### 6.1 Schema parity with Production (RC-10 preview) — PASS

The existing read-only backup file `restaurant-stock-backups/production-20261015-223431/schema.sql` (schema only — no `COPY`/`INSERT`; SHA-256 matches the backup's `SHA256SUMS`; its `migration-list.txt` shows the same 10 versions Local = Remote) was restored into a second disposable database with the same Supabase bootstrap and compared with the migration-built database. No Production system was contacted and no Production data was used.

| Catalog item (public) | Migrations | Production dump | Difference |
|---|---|---|---|
| Columns (type, nullability, default, position) | 189 | 189 | none |
| Constraints | 134 | 134 | none |
| Indexes | 71 | 71 | none |
| RLS policies (roles, USING, WITH CHECK) | 17 | 17 | none |
| Functions (signature, SECURITY DEFINER, `search_path`, md5 of source) | 26 | 26 | none |
| Triggers | 30 | 30 | none |
| View `inventory_balances` (md5 of definition) | 1 | 1 | none |
| RLS enabled/forced flags | 18 | 18 | none |
| Explicit grants to anon/authenticated/service_role (table / function) | 161 / 60 | 161 / 60 | none (8 `MAINTAIN` grants verified with `has_table_privilege`; `information_schema` omits them) |

Only restore error: `supabase_vault` unavailable in the substitute image (unused by the app). Evidence: `evidence/phase2-sandbox/schema-parity.txt`.

**Findings from the spike (corrections to the Phase 1 plan; to be applied in Phase 3 docs):**

| # | Finding | Plan impact |
|---|---|---|
| F1 | The upstream image's `migrate.sh` only runs `init-scripts/*.sql` | Role bootstrap must be `99-tybc-roles.sql` (psql backtick env), not `90-tybc-roles.sh` (deployment plan §6/§11) |
| F2 | An init-script failure does **not** stop the container; `db` still turns healthy | Migrate runner now has a fail-fast preflight (roles + auth tables); verified |
| F3 | nginx `map` with JWT-length keys needs `map_hash_bucket_size 256` | Added to the gateway template |
| F4 | GoTrue `/health` fails with `wget --spider` (HEAD) | Health checks use GET |
| F5 | Supabase sets `authenticator` `session_preload_libraries = supautils, safeupdate` | Any image used must ship both (upstream does) |
| F6 | 11 distinct `SECURITY DEFINER` functions (not 14); anon gets `42501`, not `[]` | Update RC-10 and AC-SEC-06 expectations |
| F7 | Generic `supabase.co`/`api.openai.com` strings exist inside libraries | Image gate must scan for the Cloud **project ref**, `restaurant-stock-rho`, font hosts — not generic hosts |
| F8 | A webpack production build drops Tailwind (CSS pipeline is Turbopack-only) | Phase 3 Dockerfile must use the default Turbopack `next build` |
| F9 | **Turbopack build with `next/font/local` succeeded with egress blackholed** (sandbox copy, not committed) | Confirms the B9 local-font plan; fonts available from `@fontsource-variable/*` 5.3.0 (OFL-1.1) |
| F10 | `repo@sha256` references may not resolve after `docker load` offline | Tag + image-ID verification + `pull_policy: never` (implemented) |
| F11 | Fresh installs without migrated data need a first-OWNER bootstrap (service role sets `profiles.role_id`) | Add to install runbook (Phase 5); migrated installs keep the Cloud OWNER |
| F12 | Compose parses single-letter volume names as Windows drive letters (`v:/v`) | Use descriptive volume names (already the case) |
| F13 | **Restoring a schema dump into a fresh Supabase database widens privileges**: the target's default privileges gave anon table grants and anon/authenticated `EXECUTE` on `record_stock_out`, `record_waste`, `update_user_access`… (532 vs 286 table grants) | Never rebuild the schema from a dump (incl. the `tybc-full.dump` fallback); always migrations + data-only load (data plan already does); RC-10 must compare effective privileges (`has_*_privilege`), not only `information_schema` |

## 7. 2.4 Spike S1 — Ollama connectivity: NOT TESTED (hard gate open)

| Sub-test | Result | Evidence |
|---|---|---|
| S1a–c on the client notebook (version, tags incl. `qwen3.5:4b`, small inference via `host.docker.internal:11434`) | **NOT TESTED** | No Windows/Docker Desktop/Ollama environment reachable |
| S1-EXPOSURE (Ollama loopback-only; not reachable on any LAN IP from host or container) | **NOT TESTED** | Same |
| Ollama Host-header guard accepts `host.docker.internal`, rejects arbitrary names | **PASS** | Ollama 0.40.6: `host.docker.internal` 200, `evil.example.com` 403 |
| Negative control: plain Linux Docker Engine → loopback-bound Ollama | **FAIL (expected)** | `host.docker.internal` → `172.17.0.1`, `ECONNREFUSED` |

Interpretation: on a plain Docker Engine (including Engine inside WSL without Docker Desktop) a loopback-bound host service is unreachable, so S1 depends entirely on Docker Desktop for Windows forwarding `host.docker.internal` to the Windows loopback. The runner `deploy/offline/spike/windows/Invoke-TomYum-Phase2Spike.ps1` captures: listener addresses for 11434, `OLLAMA_HOST` in all scopes, `host.docker.internal` resolution inside the container, the edge network config, S1a–c, and a LAN probe of every host IPv4 address from the host and from a container.

If S1 fails on the notebook, **stop** and choose one of these for approval (none weakens the approved posture without a decision): (A) Docker Desktop host-networking option for the `app` service only; (B) WSL mirrored networking with loopback sharing; (C) bind Ollama to the host-only Docker/WSL virtual adapter address (never `0.0.0.0`/LAN) plus an inbound firewall rule limited to that subnet; (D) containerised CPU-only Ollama on the internal network (contradicts D4/B7, costs RAM). Ollama will not be bound to `0.0.0.0`.

## 8. 2.5 Resources

Measured (sandbox, substitute images, single user, cgroup v1):

| Container | Idle | Peak under 30 page loads | Limit |
|---|---|---|---|
| app (Next.js standalone) | 81 MiB | 108 MiB | 768 MiB |
| db | 50–79 MiB | 86 MiB | 1 GiB |
| auth | 11–14 MiB | 14 MiB | 128 MiB |
| rest | 12–16 MiB | 17 MiB | 128 MiB |
| gateway | 3 MiB | 4 MiB | 32 MiB |
| **Total** | ≈ 160–195 MiB | **≈ 230 MiB** | ≈ 2.3 GiB |

Page loads p50 215 ms / p95 331 ms (sandbox CPU). The upstream `supabase/postgres` preloads more extensions (pg_cron, pg_net, pgsodium, pgaudit…), so expect a higher `db` figure there.

| Measure | Result |
|---|---|
| Ollama idle RAM, inference peak, Windows used/free during inference, Docker VM (`vmmem`) RAM | **NOT TESTED** (runner samples all of them every 0.5 s during a 200-token `qwen3.5:4b` generation) |

Headroom assessment (projection, to be confirmed): Windows + browser 5–6 GB (assumption) + Docker VM ≈ 1–1.5 GB (VM overhead + stack) + Ollama 3–4.5 GB (Phase 1 estimate, unmeasured) ≈ **9–12 GB of 16 GB**. Nothing measured so far triggers hard gate 4. Recommendation only (never applied automatically): `.wslconfig` `memory=4GB` (3 GB is the minimum indicated by these numbers), `processors=4`, `swap=2GB`; keep the per-container limits.

## 9. 2.6 Persistence

| Test | Result |
|---|---|
| `stop`/`start`, `down`/`up`, `down -v`/`up` keep the **external** volume and identical data digest | **PASS** (Linux Docker Engine) |
| Abrupt `SIGKILL` of `db` → WAL recovery, identical digest | **PASS** |
| Contrast: a normal (non-external) named volume **is** deleted by `down -v` | Confirmed |
| Same on Docker Desktop for Windows | **NOT TESTED** (runner step 6) |
| Docker Desktop "Clean / Purge data", "Reset to factory defaults", uninstall | Not run (forbidden on the client). These **delete all Docker-managed volumes, including external ones**; only off-VM backups protect against them. |

## 10. 2.7 Offline artifact inventory

| # | Artifact | Source | Preparation needs Internet | Client install needs Internet | Integrity |
|---|---|---|---|---|---|
| 1 | Repository at the release tag (source, scripts, docs, compose, migrations) | Git | Yes (clone/fetch) | No | Git tag + `SHA256SUMS` |
| 2 | App image `tybc-app` (Phase 3, Turbopack, local fonts) | Built from 1 | Yes (`npm ci`, base images) | No | `images.lock.json` |
| 3 | Ops image `tybc-ops` (migrate/backup; Phase 3/5) | Built `FROM` pinned postgres | Yes | No | lock |
| 4–6 | `supabase/postgres:17.11.0.003`, `supabase/gotrue:v2.197.0`, `postgrest/postgrest:v14.18` | Docker Hub | Yes | No (`docker load`) | lock (digest, image ID, archive SHA-256) |
| 7 | Gateway nginx, exact tag (to choose) | Docker Hub | Yes | No | lock |
| 8 | Docker Desktop installer (pinned version) | docker.com | Yes | No for the installer itself; first-run behaviour offline (sign-in prompt, update check, WSL update) **NOT VERIFIED** | SHA-256 |
| 9 | WSL package (`wsl.<ver>.x64.msi`, MIT) | GitHub `microsoft/WSL` releases | Yes | No; Windows features enabled offline with DISM (admin) | SHA-256 |
| 10 | Ollama installer (pinned version, MIT) | GitHub `ollama/ollama` releases | Yes | No | SHA-256 |
| 11 | `qwen3.5:4b` model | `ollama pull` on the preparation machine; copy `%USERPROFILE%\.ollama\models\manifests\registry.ollama.ai\library\qwen3.5\4b` + referenced `blobs\sha256-*` | Yes | No (copy into the same path or `OLLAMA_MODELS`); verify with `ollama list` | Blob names are SHA-256; model licence via `ollama show --license` **NOT VERIFIED** |
| 12 | Local fonts (Geist, Geist Mono, Noto Sans Thai `woff2` + OFL-1.1) | `@fontsource-variable/*` 5.3.0 (verified available) | Yes, once | No (vendored in repo, Phase 3) | Git |
| 13 | Spike probe dependencies (`deploy/offline/spike/tests/node_modules`) | `npm ci` | Yes | No | `package-lock.json` |
| 14 | Config templates (`offline.env.example`, `decisions.env`) | Repo | No | No | Git |
| 15 | Secrets | **Generated on the client** (never shipped) | — | No | fingerprints only |
| 16 | Scripts (prerequisite check, image import, install/start/stop/backup/USB/restore/reset — Phase 5) | Repo | No | No | Git |
| 17 | `images.lock.json`, `images/SHA256SUMS.txt`, package-level `SHA256SUMS`, `RELEASE.json` | Generated | — | No | self |
| 18 | 7-Zip installer (only if O-4 chooses 7-Zip AES) | 7-zip.org | Yes | No | SHA-256 |

Host Node.js is **not** needed on the client for the offline edition (the app and the probe run in containers); it stays only for the current cloud launcher until cutover. Target final state holds: the client installation uses no registry and no model download.

## 11. How to close the NOT TESTED items

On the **client notebook** (Docker Desktop running, Ollama running on `127.0.0.1:11434`), after the images and probe dependencies are in place:

```powershell
.\scripts\windows\Test-TomYum-OfflinePrerequisites.cmd -OutFile C:\TomYumBangC\reports\prereq.json
.\scripts\windows\offline-prep\Import-TomYum-OfflineImages.ps1 -PackageDir <package>    # if prepared elsewhere
.\deploy\offline\spike\windows\Invoke-TomYum-Phase2Spike.ps1
```

On an Internet-connected **preparation machine** with Docker Desktop: `Export-TomYum-OfflineImages.ps1 -OutDir <package> -GatewayImage <exact nginx tag> -NodeImage <exact node tag>` and `npm ci` in `deploy/offline/spike/tests`.

Return `prereq.json` and the `%LOCALAPPDATA%\TomYumBangC\spike\evidence-*` folder (no secrets inside; synthetic data only). The runner never changes Ollama's binding, the firewall, WSL, Docker Desktop settings or networking; `-Cleanup` removes the spike.

## 12. New risks

| ID | Risk | L | I | Mitigation |
|---|---|---|---|---|
| R16 | Digest-pinned image references fail offline after `docker load` | M | M | Tag + image-ID verification + `pull_policy: never` (implemented, round trip verified) |
| R17 | Silent DB bootstrap failure (container healthy, roles missing) | L | H | Migrate preflight refuses to run (implemented) |
| R18 | Pushing the branch creates a Vercel Preview build, possibly with Cloud keys | M | M | Do not push; confirm Preview settings or add an Ignored Build Step first (approval) |
| R19 | Docker Desktop on the notebook does not forward `host.docker.internal` to loopback | M | H | S1 on the notebook; stop-and-decide options in §7 |
| R20 | Sandbox substitutes differ from upstream images (extensions, config) | M | M | Repeat D/C checks with the upstream images via the runner |
| R21 | Webpack build silently drops Tailwind | L | M | Turbopack build in the Dockerfile; screenshot check in the image gate |
| R22 | Docker Desktop first-run offline (sign-in prompt, update/WSL update checks) | M | M | Install and first-run once online during preparation; verify a cold offline start in Phase 6 |
| R23 | A restore path that replays a schema dump re-opens mutation RPCs to anon/authenticated (F13) | L | H | Restore = migrations + data-only load only; privilege parity check in every reconciliation |

## 13. Blockers

| ID | Blocker | Needed to clear |
|---|---|---|
| BK-1 | No Windows execution environment in this session (client notebook not connected; workstation has no Docker Desktop and no Windows shell access) | Someone runs the three commands in §11 on the client notebook and returns the reports, **or** the client notebook is linked to a session |
| BK-2 | Upstream image digests unresolved (Docker Hub blocked here) | `Export-TomYum-OfflineImages.ps1` on a preparation machine, or registry hosts allowed for this workspace |
| BK-3 | S1 hard gate open | Result of the runner on the client notebook |

## 14. Recommendation for Phase 3

1. **Clear BK-1/BK-3 first** if possible: one on-site run of the checker + runner on the client notebook (~30 minutes once Docker Desktop and the images are present) decides S1 and replaces every Windows NOT TESTED with evidence.
2. If approval for Phase 3 is wanted before that, split it:
   - **Phase 3a (S1-independent, branch-local, Vercel-neutral):** runtime Supabase configuration (`TYBC_*` with fallback), Ollama allowlist exactly `127.0.0.1`/`[::1]`/`host.docker.internal` on port `11434` (O-2), local fonts (F9), conditional standalone + Turbopack Dockerfile (F8), project-ref image gate (F7), plan corrections F1–F13 applied to the deployment plan, data migration plan and acceptance criteria.
   - **Phase 3b (after S1 PASS):** Local AI wiring and validation through `host.docker.internal`.
3. Keep everything local on `feat/offline-docker-v1` until the Vercel Preview question (R18) is settled.

## 15. Files added in Phase 2 (uncommitted)

```text
deploy/offline/.gitattributes                 LF for container-mounted files; CRLF for .ps1/.cmd
deploy/offline/decisions.env                  O-1 CONFIRMED, O-2 11434 (non-secret)
deploy/offline/spike/**                       compose, init SQL, gateway template, migrate runner, tests, tools, Windows runner, sandbox notes
scripts/windows/Test-TomYum-OfflinePrerequisites.ps1 / .cmd
scripts/windows/tests/Test-TomYum-OfflinePrerequisites.SelfTest.ps1
scripts/windows/offline-prep/Export-TomYum-OfflineImages.ps1
scripts/windows/offline-prep/Import-TomYum-OfflineImages.ps1
docs/offline/PHASE-2-SPIKE-RESULTS.md         this report
docs/offline/evidence/phase2-sandbox/**       sandbox evidence (synthetic)
docs/offline/IMPLEMENTATION-ROADMAP.md        updated with Phase 2 status
```

No application code, migration, `.env*`, `package.json`, Vercel or Supabase configuration was changed.
