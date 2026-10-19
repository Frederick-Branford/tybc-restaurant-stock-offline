# Data Migration Plan — Supabase Cloud → Offline Edition

| Field | Value |
|---|---|
| Status | **Proposed** — Phase 1 planning only. No dump, load or Cloud change has been performed. |
| Date | 2026-10-19 |
| Decision record | [`OFFLINE-ARCHITECTURE-ADR.md`](OFFLINE-ARCHITECTURE-ADR.md) (D1, D2) |
| Target runtime | [`DOCKER-DEPLOYMENT-PLAN.md`](DOCKER-DEPLOYMENT-PLAN.md) |

> Guardrails: until the cutover in Phase 7 is approved, Supabase Cloud is accessed **read-only** (`default_transaction_read_only=on`), Vercel is not touched, `.env.local` is not modified or printed, no linked database is reset and `supabase db reset --linked` is never run. Every SQL script below is reviewed before it is run anywhere.

---

## 1. Principles

1. **One-way, one-time move.** Data moves Cloud → local once, at cutover. After the Go decision, local is the only write authority (D1). There is no sync back.
2. **Cloud data is never modified by the migration.** Extraction is read-only. The only Cloud change in the whole programme is the archive freeze at cutover (§8), which adds guard objects and revokes privileges but changes no rows.
3. **Same UUIDs, same history.** Business rows, `auth.users` and `auth.identities` are copied verbatim, so all 12 FKs into `auth.users`, all audit columns (`created_by`, `approved_by`, …) and the ledger keep their identities. Seeded reference rows created by the local migrations are replaced with Cloud's rows (Cloud UUIDs win).
4. **Prove, don't assume.** A load is accepted only if every reconciliation check (§6) passes with zero tolerance.
5. **Rehearse on copies, cut over once.** Rehearsals use separate volumes and port 3100 and are wiped afterwards.

## 2. Inputs, versions and preconditions

| Item | Required value | Source |
|---|---|---|
| Postgres | 17.x, same image build as Cloud (`17.11.0.003`) | `supabase/.temp` + `select version()` (read-only) |
| GoTrue / auth schema | `v2.197.0`; local `auth.schema_migrations` latest version = Cloud's | `/auth/v1/health` (version) + read-only query |
| Repo migrations | The same 10 versions as Cloud's `supabase_migrations.schema_migrations` (`20261009091639` … `20261010061943`) | read-only query |
| App release | The offline release built from the same migration set | `RELEASE.json` |
| Cloud settings to mirror | Auth password minimum length, JWT expiry, sign-up state, API max rows | Supabase dashboard (read only, recorded manually) |
| MFA / storage usage | `auth.mfa_factors` = 0 rows, `storage.objects` = 0 rows | read-only query; if not zero → stop and decide |

## 3. Read-only Cloud extraction

### 3.1 Connection

- From the developer machine (online), using `pg_dump`/`psql` 17 from the `tybc-ops` image (matches the server major version).
- Supabase session pooler (IPv4) or direct connection, `sslmode=require`, user `postgres`.
- `PGOPTIONS='-c default_transaction_read_only=on -c TimeZone=UTC -c DateStyle=ISO,MDY -c IntervalStyle=postgres'` — the session cannot write even by mistake. `pg_dump` additionally runs in a read-only, repeatable-read snapshot.
- The database password is entered at a prompt (`Read-Host -AsSecureString`) and passed only to the child process environment; it is never written to disk, logs or command lines. `.env.local` is not read.

### 3.2 What is extracted

| Artefact | Command (sketch) | Purpose |
|---|---|---|
| `cloud-data.sql` | `pg_dump --data-only --no-owner --no-privileges -t 'public.*' -t auth.users -t auth.identities` | The load input |
| `cloud-schema-public.sql` | `pg_dump --schema-only --schema=public --no-owner` | Schema parity (RC-10) |
| `cloud-full.dump` | `pg_dump -Fc` of every schema the role can read | Archive / forensics, never loaded automatically |
| `cloud-facts.json` | Read-only SQL pack (§6) | Expected values for reconciliation |
| `cloud-inventory-balances.csv` | `select … from public.inventory_balances order by item_id` | RC-06 and the business-facing comparison |
| `SHA256SUMS` | over all artefacts | Integrity |

`pg_dump` omits generated columns (e.g., `auth.users.confirmed_at`, `auth.identities.email`) from `COPY`; they are recomputed on load. `public` uses UUID keys, so there are no sequences to carry over.

### 3.3 What is deliberately excluded

| Excluded | Reason |
|---|---|
| `auth.sessions`, `auth.refresh_tokens`, `auth.flow_state`, `auth.one_time_tokens` | Sessions are environment-specific; everyone signs in again after cutover |
| `auth.mfa_*` | Not used (precondition: 0 rows) |
| `auth.audit_log_entries` | Cloud auth history; preserved in `cloud-full.dump` (open decision O-10) |
| `auth.sso_*`, `auth.saml_*`, other provider tables | Not used |
| `storage.*`, `realtime.*`, `supabase_functions.*`, `vault.*`, `net.*`, `cron.*` | Not used (Phase 0); precondition checks prove they hold no data |
| `supabase_migrations.schema_migrations` | Recreated locally by the migrate runner; versions compared in RC-01 |

A read-only query lists every user table with `n_live_tup > 0` across all schemas; anything outside the extracted set and the exclusion list stops the migration for review (RC-14).

## 4. Target preparation (local)

1. Create a **new** external volume (`tybc_db_data_<timestamp>` for rehearsals/restores, `tybc_db_data` for the final load) and start `db` → `auth` → `migrate` only, in a project without published ports.
2. Pre-load assertions (`supabase_admin`), all must hold or the load stops:
   - `supabase_migrations.schema_migrations` versions = the 10 Cloud versions (RC-01).
   - Latest `auth.schema_migrations` version = Cloud's (RC-02).
   - `auth.users` is empty.
   - Every `public` table other than the six seeded ones is empty.
   - The six seeded tables (`roles`, `permissions`, `role_permissions`, `categories`, `units`, `waste_reasons`) contain exactly the migration seed rows.
3. `rest`, `gateway` and `app` are **not** running during the load.

## 5. Load procedure

Run as `supabase_admin` (superuser in the `supabase/postgres` image — required for `session_replication_role`), in **one transaction**:

```sql
-- Sketch for review in Phase 4. Not executed in Phase 1.
\set ON_ERROR_STOP on
begin;
set local session_replication_role = replica;  -- suppress user triggers and FK triggers during load
set local TimeZone = 'UTC';

-- §4 assertions repeated here (DO block raising on failure).

-- Remove locally seeded reference rows (local UUIDs) so Cloud rows load verbatim.
-- All 18 public tables in ONE statement: TRUNCATE refuses FK-referenced tables otherwise.
-- Safe because §4 proved every non-seeded table is empty.
truncate table
  public.role_permissions, public.permissions, public.roles, public.profiles,
  public.categories, public.units, public.items, public.item_units, public.suppliers,
  public.stock_movements, public.purchase_orders, public.purchase_order_items,
  public.purchase_receipts, public.purchase_receipt_items, public.waste_reasons,
  public.waste_records, public.stock_counts, public.stock_count_items;

\i cloud-data.sql   -- COPY blocks: public.*, auth.users, auth.identities

-- In-transaction hard checks: per-table row counts = cloud-facts.json (DO block raising on mismatch).
commit;
analyze;
```

Why `replica` mode: it stops `on_auth_user_created` → `handle_new_user` from inserting duplicate STAFF profiles, `items_create_base_unit` from creating duplicate base units, and the ledger/receipt/waste immutability and validation triggers from rejecting historical rows. **CHECK, NOT NULL and UNIQUE constraints are still enforced** in replica mode; only triggers (including FK triggers) are skipped — so FK integrity and trigger-enforced rules are re-proved afterwards (RC-05, RC-08). `set local` ends with the transaction, and the triggers themselves are never disabled at table level (RC-11 confirms).

A failure anywhere rolls back the whole transaction; the candidate volume is then discarded.

## 6. Reconciliation catalogue

Every check runs the **same SQL** against the Cloud snapshot (read-only, at extraction time) and the local database, with `TimeZone=UTC`, `DateStyle=ISO,MDY`, `IntervalStyle=postgres`. Results must be identical. Reconciliation runs **before** any test login (a login changes `auth.users.last_sign_in_at`).

| ID | Check | Method | Pass |
|---|---|---|---|
| RC-01 | Migration history | `version, name` from `supabase_migrations.schema_migrations` | Identical 10 rows |
| RC-02 | Auth schema version | max `auth.schema_migrations.version` | Identical |
| RC-03 | Row counts | `count(*)` for 18 `public` tables + `auth.users` + `auth.identities` | Identical |
| RC-04 | Row digests | per table: `md5(string_agg(md5(t::text), '' order by md5(t::text) collate "C"))` | Identical |
| RC-05 | Referential integrity | Anti-join generated from `pg_constraint` for every FK (incl. the 12 into `auth.users`): child rows with non-null key and no parent | 0 everywhere |
| RC-06 | Stock balances | `inventory_balances` per item: balance, status, `below_minimum` vs `cloud-inventory-balances.csv`; plus `sum(base_quantity)` per item from `stock_movements` | Identical |
| RC-07 | Ledger integrity | non-null `idempotency_key` count; duplicates (must be 0); movement count and `sum(base_quantity)` per `movement_type` | Identical; duplicates 0 |
| RC-08 | Trigger-enforced rules re-checked | Queries equivalent to `stock_movements_validate` (unit/conversion vs `item_units`), PO status-transition invariants, receipt/waste links | Same result set as Cloud |
| RC-09 | Identity | exactly one active OWNER (`profiles.is_active` + `roles.code = 'OWNER'`), same user id and email as Cloud; profile ↔ auth user pairing; `md5(encrypted_password)` equal for each user (hash never printed) | Identical; OWNER count = 1 |
| RC-10 | Schema parity | Normalised diff of `pg_dump --schema-only --schema=public` (Cloud vs local); catalog: RLS on 18 tables, 17 policies, 14 `SECURITY DEFINER` functions with `search_path=''`, grants from `information_schema.role_table_grants` and `routine_privileges` for `anon`/`authenticated`/`service_role` | Empty diff; identical catalog results |
| RC-11 | Triggers | `pg_trigger` (non-internal) names, tables and `tgenabled = 'O'` | Identical list, all enabled |
| RC-12 | Business distributions | purchase orders by status, stock counts by status, receipts and receipt lines, waste records and quantities | Identical |
| RC-13 | Application view | Start app (port 3100 in rehearsal, 3000 at cutover); OWNER signs in with the **existing** password; dashboard figures and inventory list match the Cloud capture taken at extraction | Match |
| RC-14 | Nothing left behind | No non-empty user table outside the extracted set and the exclusion list; `storage.objects` = 0; `auth.mfa_factors` = 0 | True |

Output: `reports\reconcile-<run>.json` (check id, Cloud value, local value, PASS/FAIL) and a one-page summary. Reports contain counts and digests only — no personal data. **Any FAIL = No-Go.**

## 7. Rehearsals and final cutover

### 7.1 Rehearsals (Cloud untouched)

| Run | Source | Where | Goal |
|---|---|---|---|
| REH-1 | Existing backup `production-20261015-223431` (`data.sql`), filtered to the extracted set — no Cloud access at all | Developer machine | Prove the loader and RC-01…RC-14 (RC values taken from the backup) |
| REH-2 | Fresh read-only extraction (§3) | Developer machine | End-to-end with real artefacts; measure timings |
| REH-3 | REH-2 artefacts or a newer read-only extraction | **Client notebook** (offline after copy) | Prove on target hardware; time the full cutover sequence; feeds Phase 6 acceptance |

After each run: keep the reconciliation report; delete the rehearsal volume and any copied data except artefacts covered by §10. No real transactions are ever entered on a rehearsal stack.

### 7.2 Final cutover runbook (Phase 7, after explicit approval)

| Step | When | Action | Exit condition |
|---|---|---|---|
| 0 | T-7 d | Phase 6 acceptance signed; cutover date and freeze window agreed (O-8); both USB drives ready | Go/No-Go #0 |
| 1 | T-1 d | Read-only re-check of Cloud versions and preconditions (§2); REH-3 timings reviewed | No version drift |
| 2 | T0 | Staff stop using the Cloud app; developer confirms no new `stock_movements` for 10 minutes (read-only) | Activity stopped |
| 3 | T0 | **Freeze Cloud** with the reviewed L1 script (§8) and verify | Writes rejected with `ARCHIVE_READ_ONLY` |
| 4 | T0 | Final read-only extraction from the frozen Cloud (§3) → `backups\cutover\` + both USB drives, `SHA256SUMS` verified | Artefacts verified |
| 5 | T0 | Load into a fresh `tybc_db_data` on the notebook (§4–§5) | Commit succeeded |
| 6 | T0 | RC-01…RC-12, RC-14 | 100 % PASS |
| 7 | T0 | Start the stack on `127.0.0.1:3000`; RC-13 | PASS |
| 8 | T0 | **Go/No-Go #1** (owner + developer) — the point of no return is the first local business write after Go | Go |
| 9 | T0 | Backup `cutover-baseline` + USB copy; desktop shortcut switched to the offline launcher; operations resume locally | Backup verified |
| 10 | T0 (same day) | Archive hardening L2–L6 (§8) | Checklist complete |
| 11 | T+14 d | Hypercare: daily backup/clock/log check, weekly USB, issues triaged | Hypercare exit |

Expected freeze window: about 2–3 hours (small dataset); confirmed by REH-3.

Freezing **before** the final extraction guarantees that no Cloud write can happen between the dump and the switch, so nothing is lost and no merge is ever needed.

## 8. Cloud read-only cutover strategy

Goal (D2): after cutover, Cloud cannot accept business writes through any path — Vercel app, the old notebook launcher, any copy of old keys, the Supabase dashboard or SQL editor by mistake — while history stays viewable and exportable. **Designed here; implemented only in Phase 7 with approval.**

| Layer | Control | What it blocks |
|---|---|---|
| **L1** | DB freeze: statement-level `BEFORE INSERT OR UPDATE OR DELETE` and `BEFORE TRUNCATE` triggers on all 18 `public` tables calling `archive_guard.reject_write()`, which raises `ARCHIVE_READ_ONLY` | Every role and path, including `service_role`, `SECURITY DEFINER` RPCs, PostgREST and the dashboard table editor. `auth` is not frozen, so viewing via login still works. |
| **L2** | Revoke `INSERT, UPDATE, DELETE, TRUNCATE` on `public` tables and `EXECUTE` on mutation functions (`record_stock_out`, `record_waste`, `create_stock_count`, `record_stock_count_item`, `complete_stock_count`, `receive_purchase_order_item`, `update_user_access`, and any other mutating function found in the catalog) from `anon`, `authenticated`, `service_role` | Defence in depth with explicit permission errors |
| **L3** | Cloud Auth: disable new sign-ups | New Cloud accounts |
| **L4** | Keys: remove Cloud keys from the notebook (retire `.env.local` together with the cloud launcher), revoke/rotate the Cloud secret (service-role) key after Vercel is configured, remove the CLI project link on the notebook | Old configurations writing even if L1/L2 were undone |
| **L5** | Vercel Production — **minimum:** Deployment Protection so only the owner's Vercel account can open it. **Optional:** an `ARCHIVE_MODE` banner build that hides mutation UI (small code change + Production deploy, separate approval). **Alternative:** remove the production domain and rely on L6 dumps (open decision O-3) | Staff using the old app out of habit |
| **L6** | Final archive: frozen-state `cloud-full.dump`, `cloud-data.sql`, schema, facts, inventory CSV, `SHA256SUMS` on the notebook (`backups\cutover`), both USB drives and an owner-held copy | Loss of history if the Cloud project is later paused, downgraded or deleted |

L1 sketch (Cloud-only file `deploy/cutover/cloud-freeze.sql`, **never** in `supabase/migrations`, reviewed together with its inverse `cloud-unfreeze.sql`):

```sql
-- Sketch for review. Not executed before Phase 7.
begin;
create schema if not exists archive_guard;
create or replace function archive_guard.reject_write()
  returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'ARCHIVE_READ_ONLY: % on %.% rejected; this database is a read-only archive',
    tg_op, tg_table_schema, tg_table_name using errcode = 'P0001';
end $$;
-- Repeated for each of the 18 public tables:
create trigger zz_archive_read_only
  before insert or update or delete on public.stock_movements
  for each statement execute function archive_guard.reject_write();
create trigger zz_archive_read_only_truncate
  before truncate on public.stock_movements
  for each statement execute function archive_guard.reject_write();
commit;
```

Verification (no data touched): statement-level triggers fire even when no row matches, so `update public.categories set name = name where false;` must fail with `ARCHIVE_READ_ONLY`; 36 guard triggers listed and enabled; one Stock Out attempt through the Vercel app as OWNER shows an error and creates no movement.

Residual risks: a project owner with the DB password can drop the guard (intentional escape hatch — the password is rotated and held by the owner); Cloud migration history now differs from the repo by the guard objects (documented, archive only); if the Cloud plan pauses inactive projects, L6 remains the authoritative archive.

## 9. Rollback

| Situation | Rollback |
|---|---|
| Any rehearsal fails | Delete the rehearsal volume; fix; repeat. Cloud untouched. |
| Cutover step 3–7 fails (before Go) | Discard the local volume; run `cloud-unfreeze.sql` (reviewed); staff continue on Cloud. No data lost because nothing was written anywhere during the freeze. |
| After Go, before any local business write | Same as above, with owner approval. |
| After the first local business write | **Local is the truth.** Recover locally from `cutover-baseline` or later backups (blue/green restore). Returning to Cloud is not supported by tooling (D1); in an emergency it would mean unfreezing Cloud and manually re-entering local transactions, decided by the owner. |

## 10. Data protection

- Extraction artefacts, backups and rehearsal copies contain personal data (emails, bcrypt password hashes, names, phone numbers) and business data. They are stored only under `C:\TomYumBangC\backups` / the existing `restaurant-stock-backups` folder outside Git, and on the encrypted USB drives.
- Rehearsal copies on the developer machine are deleted after REH-3 except the reconciliation reports; `cutover` artefacts are kept permanently.
- Reports and logs contain counts, digests and identifiers only.
- Nothing is uploaded to any cloud service.
