# Phase 0 — Offline Readiness Audit

**Project:** TOM YUM BANG C Restaurant Stock
**Baseline:** `main` @ `53ed3f7` (tag `v1.2.1`), clean working tree
**Audit date:** 2026-10-19
**Mode:** read-only. No code, database, Supabase project, release tag or `.env.local` value was changed or printed.

---

## 1. Summary

The application is a server-rendered Next.js 16 app whose **only** data and identity backend is Supabase Cloud (PostgREST + GoTrue + PostgreSQL 17 with RLS). Local AI already runs offline on the host through Ollama. Every other runtime dependency is either Supabase Cloud or optional cloud AI.

| Area | Finding |
|---|---|
| Data access | 100% through `supabase-js`: 83 query-builder calls in 21 files, 12 RPC calls, 13 auth calls. No raw SQL client in the app. |
| Browser → backend | None. The browser client (`src/lib/supabase/client.ts`) is unused; all Supabase traffic is server-side. |
| Auth | Supabase Auth email/password, cookie session via `@supabase/ssr`; `proxy.ts` refreshes the session on every request with `auth.getClaims()`. |
| Authorization | App-level `user_has_permission` RPC (service role) before every write; RLS (17 SELECT policies, `auth.uid()` / `has_permission`) on user-scoped reads. |
| Ledger integrity | Enforced in PostgreSQL: immutable `stock_movements`/`waste_records`/receipts triggers, `validate_stock_movement`, atomic `SECURITY DEFINER` RPCs with row locks and idempotency keys, `inventory_balances` view = `SUM(stock_movements.base_quantity)`. |
| Supabase-specific DB features | `auth.users` (12 FK columns + `on_auth_user_created` trigger), `auth.uid()`, roles `anon`/`authenticated`/`service_role` (33 `GRANT`, 30 `REVOKE`). **No** Storage, Realtime, Edge Functions, `pg_net`, `pg_cron`, Vault or extensions schema usage. |
| Local AI | Ollama `qwen3.5:4b` on `127.0.0.1:11434`, enabled only by the Windows launcher. Config **rejects any non-loopback host**. |
| Current runtimes | (a) Vercel + Supabase Cloud (production, Local AI disabled); (b) Windows notebook `next start -H 127.0.0.1 -p 3000` + Supabase Cloud + native Ollama. |
| Docker | Not used today. README states Docker/WSL are not required. No `~/.docker` on the development machine. |

**Conclusion:** offline operation requires replacing Supabase Cloud with a local Supabase-compatible backend and containerising the app. The evidence favours **self-hosted Supabase (minimal subset)** — see §9 and the ADR to follow.

---

## 2. Scripts and build

| Item | Detail |
|---|---|
| Scripts | `dev`, `build` (Turbopack), `start`, `lint`, `typecheck` (`next typegen && tsc`), `test` (Vitest), `e2e` (Playwright, no config present) |
| `next.config.ts` | `cacheComponents`, `partialPrefetching`, Turbopack Tailwind loader. No `output: "standalone"`, no `images` config. |
| Fonts | `next/font/google` (Geist, Geist Mono, Noto Sans Thai) — **downloaded at build time** from `fonts.googleapis.com`; self-hosted in `.next` afterwards. |
| Brand asset | `public/brand/tom-yum-bang-c-logo.jpg` (local, served via `next/image`). |
| Key dependencies | `next 16.4.0`, `react 19.3`, `@supabase/ssr`, `@supabase/supabase-js`, `openai`, `zod`; dev: `supabase` CLI, `vitest`, `@playwright/test`. |

## 3. Supabase clients

| Client | File | Used for |
|---|---|---|
| User (cookie session, RLS) | `src/lib/supabase/server.ts` | Page reads (dashboard, inventory, movements, stock-in/out, waste, stock count, suppliers, POs, reports), `getUser`, login/logout |
| Service role (bypasses RLS) | `src/lib/supabase/admin.ts` (`server-only`) | All writes after a permission check; reports; Business Snapshot V1/V2; permission RPC |
| Proxy (middleware) | `src/lib/supabase/proxy.ts` | Session refresh via `auth.getClaims()` on every matched request |
| Browser | `src/lib/supabase/client.ts` | **Unused** |

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are inlined by Next.js at **build time**. Because only the server uses them, the URL may point at a container-internal address, but a Docker image built for one environment is then tied to it unless the app reads a runtime variable instead.

## 4. Authentication and protected routes

- Login: `signInWithPassword` server action → redirect to `/dashboard`. Logout: `signOut`.
- Session check: `auth.getUser()` in `(app)/layout.tsx`, `/`, `/login`, reports, API routes and permission helpers (13 calls).
- `src/proxy.ts` matches all routes except static assets/images and calls `getClaims()`; with a symmetric (HS256) JWT secret this falls back to a `getUser` round-trip to GoTrue.
- Sign-up: no UI. `supabase/config.toml` (local CLI only) has `enable_signup = true`, `enable_confirmations = false`, `minimum_password_length = 6`. Cloud settings are not in the repo.
- Password reset: no flow in the app; GoTrue email is not used. **Offline there is no email**, so OWNER recovery needs an admin procedure.
- `.runtime/server.err.log` shows `refresh_token_not_found` errors from stale browser cookies — harmless today, but the local deployment will invalidate all cloud sessions (different JWT secret), so users must log in once.

## 5. RLS, roles and RPC functions

- 18 tables + 1 view in `public`; RLS enabled on all 18 tables; 17 policies, all `FOR SELECT TO authenticated`, most gated by `public.has_permission(...)` which uses `auth.uid()`.
- Writes never rely on RLS: they use the service role or `SECURITY DEFINER` RPCs (14 definer functions, all `set search_path = ''`).
- RPCs called by the app: `user_has_permission` (×6), `record_stock_out`, `record_waste`, `create_stock_count`, `record_stock_count_item`, `complete_stock_count`, `receive_purchase_order_item`. Also present: `update_user_access` (OWNER guard with advisory lock), PO number generators, validation/protection triggers.
- `handle_new_user` trigger on `auth.users` inserts a `profiles` row with the STAFF role. **Any data restore that inserts into `auth.users` with triggers enabled will create duplicate profiles** — restores must run with triggers disabled (`session_replication_role = replica`).
- Actor columns referencing `auth.users(id)`: `profiles.id`, `created_by` ×5, `approved_by`, `cancelled_by`, `completed_by`, `counted_by`, `received_by`, `started_by`.

## 6. Migrations and schema portability

10 migrations (`supabase/migrations`, 5,819 lines) are the schema source of truth (README forbids `supabase db reset --linked`). They depend on:

| Supabase feature | Portable to plain PostgreSQL? |
|---|---|
| `auth.users`, `auth.uid()` | No — needs GoTrue's `auth` schema or a rewrite |
| Roles `anon`, `authenticated`, `service_role` + grants | No — needs Supabase role model or a rewrite |
| `gen_random_uuid()` | Yes (core since PG 13) |
| Triggers, plpgsql, advisory locks, partial unique indexes | Yes |
| Extensions / pg_net / pg_cron / storage / realtime | Not used |

Server versions recorded by the CLI link (`supabase/.temp`): PostgreSQL **17.11.0.003**, GoTrue **v2.197.0**, PostgREST **v14.18**. PostgREST `max_rows = 1000` (local config) — pages that do not paginate rely on this limit today.

## 7. Storage, API routes and server actions

- **Storage:** none (no `supabase.storage`; logo is a static file).
- **API routes:** `POST /api/ai/summary` (OpenAI, cloud), `POST /api/ai/local/summary` (Ollama, local).
- **Server actions:** inventory create item; stock in (direct insert into `stock_movements`); stock out, waste, stock count (RPC); suppliers create/toggle; purchase orders create/add/delete/confirm/cancel/receive (direct inserts + `receive_purchase_order_item` RPC); login/logout.

## 8. Ledger, purchasing, reports and AI

- **Ledger:** `stock_movements` is append-only (update/delete triggers raise), validated against item units; balances are always derived (`inventory_balances` view). Idempotency keys (unique partial index) protect stock out, waste and PO receiving. A data migration must therefore copy movements verbatim and verify `SUM(base_quantity)` per item afterwards.
- **Purchasing:** status machine enforced by triggers (`validate_purchase_order_transition`, `protect_terminal_purchase_order`), receipts immutable, receiving atomic with `FOR UPDATE` locks.
- **Reports:** server-side aggregation via service role; no external services.
- **Local AI:** Business Snapshot V2 (paginated, read-only) → digest → Ollama → validated output. Config guards: disabled when `VERCEL` is set, `AI_LOCAL_ENABLED=true` required, **base URL must be `127.0.0.1` or `[::1]`**, single request in flight.
- **Cloud AI:** OpenAI via `OPENAI_API_KEY`; the UI section is always rendered and fails at request time when offline.

## 9. Environment variables

| Variable | Purpose | Offline status |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase API base (build-time inlined) | Replace with local gateway |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public API key | Replace with locally generated key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only service key | Replace with locally generated key |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Optional cloud AI | Unset offline |
| `AI_LOCAL_ENABLED`, `OLLAMA_*` | Local AI | Keep; host rule must change for Docker |
| `VERCEL` | Disables Local AI on Vercel | Unset |

`.env.local` currently defines only the three Supabase keys and the two OpenAI keys (names checked; values not read). Local AI variables are injected by the launcher.

## 10. Windows launchers and diagnostics

| File | Behaviour | Offline impact |
|---|---|---|
| `Setup-TomYum-Stock-AI.cmd` → `Setup-TomYum-LocalAI.ps1` | winget installs Node.js/Ollama, `ollama pull qwen3.5:4b`, creates `.env.local`, `npm ci`, `npm run build`, desktop shortcut | Needs Internet (install-time only) |
| `Start-TomYum-Stock-AI.cmd` → `Start-TomYum-LocalAI.ps1` | Starts Ollama if needed, verifies model, sets Local AI env, `npm start -H 127.0.0.1 -p 3000`, PID file in `.runtime/` | Works offline for the app process; data still needs Supabase Cloud |
| `Stop-TomYum-Stock-AI.cmd` | Stops the PID | Offline-capable |
| `Check-TomYum-System.cmd` | Checks Node/npm/Ollama/model/build/port/env, git secret protection, **Supabase Cloud `/auth/v1/health`**, **Vercel production** | Cloud checks fail offline by design |

## 11. Tests

27 test files (519 passing / 3 skipped at the last full gate run; not re-run during this read-only audit; the 3 skipped are the opt-in real-Ollama integration tests). Tests never touch the network (global `fetch` is stubbed in `tests/setup/test-guards.ts`). Snapshot V2 tests use an in-repo fake PostgREST (`tests/ai/support/fake-postgrest.ts`) shaped for `supabase-js` — they stay valid only while the app keeps `supabase-js`.

## 12. Backup and restore today

- `README.md` documents manual production logical backups (`roles.sql`, `schema.sql`, `data.sql`, git commit, tag, migration list, SHA-256 sums), stored outside the repo.
- One such backup exists (`../restaurant-stock-backups/production-20261015-223431`, tag v1.1.0). Its `data.sql` contains `public.*` **and** `auth.*` tables (including `auth.users`), dumped from PostgreSQL 17.11. Contents were not opened beyond section headers.
- Earlier artefacts show the app previously ran against a **local Supabase PostgreSQL 17.11** (`local-data-before-cloud.sql`, with `auth` and `public` data) and was migrated to Cloud with an audited, assertion-guarded SQL script that remapped the single local actor to the Cloud OWNER.
- **No automated backup, no scheduled backup, and no documented, tested restore** exist for the local runtime.

---

## 13. External network dependencies

| # | Dependency | Used by | When | Classification |
|---|---|---|---|---|
| 1 | Supabase Cloud PostgREST (`/rest/v1`) | All reads/writes (83 queries, 12 RPC) | Runtime | **Locally replaceable** (self-hosted PostgREST + Supabase Postgres) |
| 2 | Supabase Cloud GoTrue (`/auth/v1`) | Login, logout, session checks, proxy refresh | Runtime | **Locally replaceable** (self-hosted GoTrue) |
| 3 | Supabase role model / `auth` schema / RLS | Migrations, RLS, FKs | Runtime | **Locally replaceable** with Supabase Postgres image; **requires refactoring** without it |
| 4 | Vercel | Production hosting | Runtime | **Cloud-only** (kept for the cloud deployment, not used offline) |
| 5 | OpenAI API | Cloud AI section | Runtime | **Cloud-only** — must be disabled/hidden offline |
| 6 | Ollama (`127.0.0.1:11434`) | Local AI | Runtime | **Already offline-capable**; **requires refactoring** for container networking |
| 7 | Google Fonts | `next/font/google` | Build | Build-time only; **locally replaceable** with `next/font/local` (OFL fonts) |
| 8 | npm registry | `npm ci` | Install/build | Install-time only |
| 9 | Container registries | Image pulls | Install | Install-time only (pre-pull / `docker save` for offline reinstall) |
| 10 | winget, nodejs.org, ollama.com | Setup script | Install | Install-time only |
| 11 | Ollama model registry | `ollama pull` | Install | Install-time only |
| 12 | Supabase CLI ↔ linked Cloud project | Migrations workflow | Admin | **Cloud-only** workflow; **locally replaceable** (apply migrations to local DB) |
| 13 | Cloud health checks (Supabase, Vercel) | `Check-TomYum-System.ps1` | Diagnostics | **Requires refactoring** (offline variant) |
| 14 | Next.js telemetry | build/start | Runtime | Disable (`NEXT_TELEMETRY_DISABLED=1`) |
| 15 | Email (GoTrue SMTP) | Not used | — | Offline: none; OWNER recovery needs admin script |
| 16 | Static assets, `next/image`, UI | — | Runtime | **Already offline-capable** (no CDN) |

---

## 14. Blockers and risks

| ID | Severity | Item |
|---|---|---|
| B1 | High | **Single source of truth.** Cloud production and an offline database cannot both accept writes — there is no sync, and the ledger is append-only. A cutover decision is required (cloud becomes read-only archive, or offline edition is used by a different restaurant/branch). |
| B2 | High | **Docker prerequisites unverified** on the client notebook: Docker Desktop + WSL2 + BIOS virtualization, admin install, auto-start at login. Not detected on the development machine. |
| B3 | High | **Ollama networking.** `readLocalAiConfig` rejects non-loopback hosts. A containerised app cannot reach host or container Ollama via `127.0.0.1` without a security-reviewed change (allow-listed Docker hostname) or a shared network namespace. |
| B4 | High | **Single-machine data risk.** Offline means the notebook holds the only live copy of the ledger. Automated local backups plus an off-device copy (USB/second disk) and a rehearsed restore are mandatory. |
| B5 | Medium | **Auth schema compatibility.** OWNER identity lives in `auth.users` (GoTrue v2.197.0 schema). The local GoTrue/Postgres versions must be pinned to match before importing users. |
| B6 | Medium | **Build-time inlining** of `NEXT_PUBLIC_SUPABASE_*` ties an image to one environment; needs build args or a runtime variable. |
| B7 | Medium | **AMD integrated GPU.** Docker Desktop GPU passthrough is NVIDIA-only; Ollama in a container runs CPU-only. Keeping native Windows Ollama avoids double memory use and keeps today's measured performance. |
| B8 | Medium | **Offline account recovery** — no email; needs an admin password-reset procedure. |
| B9 | Medium | **Offline rebuilds** fail while fonts come from Google Fonts. |
| B10 | Low | Cloud AI section and cloud diagnostics must degrade cleanly offline. |
| B11 | Low | **Clock drift** offline affects JWT expiry and ledger timestamps; Windows time sync is unavailable without Internet. |
| B12 | Low | **Memory budget** on 16 GB: Ollama (~4 GB) + WSL2 VM + Postgres/GoTrue/PostgREST/gateway + Next.js (~1.5–2 GB) — fits, but Docker Desktop memory must be capped and the full official Supabase stack avoided. |

---

## 15. Architecture direction (preview — formal ADR in Phase 1)

| Criterion | A: Self-hosted Supabase (minimal) | B: PostgreSQL + local auth |
|---|---|---|
| App code change | Config + small targeted changes | Rewrite 83 queries, 12 RPC call sites, 13 auth calls, sessions |
| Auth / OWNER identity | GoTrue verifies the existing bcrypt hash; OWNER keeps the same password | New auth system; hash import possible but custom |
| RLS / grants | Unchanged (17 policies, `auth.uid()`, Supabase roles) | Rewrite or replace with app-only checks |
| Migrations | Apply as-is | Rewrite `auth.users` FKs, roles, grants, policies |
| Tests | Unchanged | Fake PostgREST harness and many tests rewritten |
| Data migration | Restore `auth` + `public` from `pg_dump` (format already used) | Transform `auth.users` into a custom table |
| Containers | ~5 (db, auth, rest, gateway, app) | ~2 (db, app) |
| Extra memory | ~0.6–1 GB | ~0.3 GB |
| Prior evidence | App already ran on local Supabase PG 17.11 | None |
| Rough effort | ~10–15 working days incl. migration, backup and offline test | ~20–30 working days with higher regression risk to ledger/purchasing flows |

**Recommended:** Option A, pinned to the Cloud versions (Postgres 17.11.0.003, GoTrue v2.197.0, PostgREST v14.18), without Studio/Realtime/Storage/Functions/Analytics, gateway not published, app bound to `127.0.0.1:3000`, Ollama kept native on Windows.

## 16. Proposed implementation phases (after approval)

1. **Architecture & design docs** — ADR, Docker plan, migration plan, acceptance criteria, roadmap (no code).
2. **Docker foundation spike** — pinned minimal Supabase stack, migrations applied to an empty local DB, health checks, `127.0.0.1` bindings, Docker Desktop prerequisite check on the target notebook.
3. **App container** — multi-stage Dockerfile, standalone output, runtime/build-arg Supabase config, local fonts, telemetry off, Ollama connectivity decision, Cloud AI hidden when not configured.
4. **Data migration rehearsal** — restore from a fresh Cloud dump into local, triggers disabled, reconciliation queries, OWNER login; Cloud untouched.
5. **Backup / restore + Windows workflow** — scheduled `pg_dump`, retention, off-device copy, restore drill, new Start/Stop/Check scripts.
6. **Offline acceptance** — every criterion run on the target notebook with Wi-Fi off; restart persistence; performance.
7. **Cutover** — agreed freeze of Cloud writes, final dump, migrate, verify, switch.

## 17. Assumptions

- One restaurant, one OWNER, one notebook (Ryzen 7 6800H, 16 GB, Radeon iGPU, Windows 11) as documented in `README.md`.
- "Offline" means no Internet after installation; installation and image builds may use the Internet.
- Cloud production must stay unchanged and reachable for its current users until a cutover is agreed.
- The `v1.2.1` tag and Supabase Cloud data are read-only inputs.
