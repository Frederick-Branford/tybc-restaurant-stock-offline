# Offline Acceptance Criteria

| Field | Value |
|---|---|
| Status | **Proposed** — Phase 1 planning. Executed in Phase 6 (AC-CUT-* in Phase 7). |
| Date | 2026-10-19 |
| Related | [`OFFLINE-ARCHITECTURE-ADR.md`](OFFLINE-ARCHITECTURE-ADR.md) · [`DOCKER-DEPLOYMENT-PLAN.md`](DOCKER-DEPLOYMENT-PLAN.md) · [`DATA-MIGRATION-PLAN.md`](DATA-MIGRATION-PLAN.md) |

**Principle:** containers starting is not acceptance. The Offline Edition is accepted only when every MUST criterion below passes **on the client notebook with Wi-Fi disabled and no usable Internet route**, using migrated data, including a reboot, a backup and a restore. Nothing may be described as "offline ready" before this record is signed.

---

## 1. Setup

| Item | Value |
|---|---|
| Machine | The client notebook (not the developer machine) |
| Release | One release bundle, identified by `RELEASE.json` (commit, tag, image digests) |
| Data | Acceptance volume `tybc_db_data_acceptance` loaded from REH-3 artefacts and reconciled (data plan §7.1); discarded after acceptance |
| Compose config | Production configuration (`127.0.0.1:3000`). The cloud launcher is stopped for the session. Real operations continue on Cloud from other devices; nothing typed during acceptance is kept. |
| Test records | Names prefixed `ACC-` (supplier, PO notes, count notes) so they are recognisable |
| People | Executor: developer. Witness: OWNER, who performs the stock and purchasing steps personally. |
| Evidence root | `C:\TomYumBangC\acceptance\<yyyyMMdd>\<test-id>\` — screenshots, command/SQL output, timings. Evidence contains business data and stays on the notebook/USB. |

## 2. Disconnected-network procedure (precondition for every test)

1. Record adapters: `Get-NetAdapter | Select Name, Status, MediaType, MacAddress` → `AC-NET-01\adapters-before.txt`.
2. Turn on **Airplane mode**, unplug Ethernet, disconnect phone tethering/hotspot and any VPN.
3. Prove there is no usable route — **all must fail**:

```powershell
Test-NetConnection 1.1.1.1 -Port 443          # TcpTestSucceeded : False
Test-NetConnection 8.8.8.8 -Port 53           # False
Resolve-DnsName supabase.com -DnsOnly          # error
curl.exe -sS -m 5 https://restaurant-stock-rho.vercel.app   # error
Get-NetRoute -DestinationPrefix 0.0.0.0/0      # none, or only on disconnected adapters
docker compose exec app node -e "fetch('https://example.com').then(()=>process.exit(1),()=>process.exit(0))"   # exit 0
```

4. Keep the notebook disconnected for the entire session, including the reboot in AC-PERS-02; re-run step 3 after the reboot.
5. Only after evidence is collected is the network restored.

## 3. Pass rules

- **MUST** criteria: all pass. **SHOULD** criteria: a failure needs an owner-signed waiver with a remediation date.
- A test passes only with its evidence stored.
- Any code, image or configuration change after a pass ⇒ re-run the affected tests plus the offline smoke set (AC-NET-01, AC-AUTH-01, AC-DASH-01, AC-OPS-01, AC-OPS-02, AC-PERS-01, AC-BKP-01).
- Before stock tests, export balances of the items used (`inventory_balances`) as the baseline; every operation has a pre-computed expected delta.

## 4. Test catalogue

### A. Network and boot

| ID | Pri | Steps | Expected | Evidence |
|---|---|---|---|---|
| AC-NET-01 | MUST | §2 procedure | Every probe fails | Command output |
| AC-NET-02 | MUST | Static scan of the app image for the Cloud project ref, `restaurant-stock-rho`, `fonts.googleapis.com`, `fonts.gstatic.com`, `api.openai.com`; check `OPENAI_*` unset in the container | No matches; unset | Scan output |
| AC-NET-03 | MUST | Execute this entire catalogue while AC-NET-01 holds | All MUST pass | This record |
| AC-BOOT-01 | MUST | Offline, on a Docker Desktop with no TYBC images: `docker load` from the release bundle, install, first start on an empty volume | Healthy ≤ 5 min; 10 migrations applied | Timings, `docker ps`, migration list |
| AC-BOOT-02 | MUST | `Start-TomYum-Offline` from stopped state | `app` healthy ≤ 180 s (target ≤ 120 s); browser opens `http://127.0.0.1:3000` | Timings |
| AC-BOOT-03 | MUST | Restart the stack twice | `migrate` applies nothing on restarts; `Check-TomYum-Offline` all green | Logs, check output |

### B. Authentication and access

| ID | Pri | Steps | Expected | Evidence |
|---|---|---|---|---|
| AC-AUTH-01 | MUST | OWNER signs in with the **existing Cloud password** | Dashboard shown | Screenshot |
| AC-AUTH-02 | MUST | Wrong password | Rejected, no session cookie | Screenshot |
| AC-AUTH-03 | MUST | Sign out, then open a protected URL | Redirected to `/login` | Screenshot |
| AC-AUTH-04 | MUST | Session after 1 h idle (JWT expiry 3600 s) | Silent refresh or clean re-login; no error page | Notes |
| AC-AUTH-05 | MUST | A non-OWNER account (migrated, or created via the app's user-management flow) | Sees only permitted navigation; direct URL to a forbidden page denied | Screenshots |
| AC-AUTH-06 | MUST | OWNER changes a user's access (`update_user_access`) | Applied; last-OWNER guard prevents removing the only OWNER | Screenshots |

### C. Dashboard and inventory

| ID | Pri | Steps | Expected | Evidence |
|---|---|---|---|---|
| AC-DASH-01 | MUST | Open dashboard | Metrics equal SQL for the same data (balances, LOW/OUT, below minimum, today's in/out, open POs) | Screenshot + SQL |
| AC-INV-01 | MUST | Inventory list, search, filters, item detail | Balances equal `inventory_balances`; statuses correct | Screenshot + SQL |
| AC-INV-02 | MUST | Item transaction history | Matches `stock_movements` for the item | Screenshot + SQL |

### D. Stock operations

| ID | Pri | Steps | Expected | Evidence |
|---|---|---|---|---|
| AC-OPS-01 | MUST | Stock In for item A using a non-base unit | One `STOCK_IN`; `base_quantity` = input × conversion; balance + expected delta | Screenshot + SQL |
| AC-OPS-02 | MUST | Stock Out for item A | One `STOCK_OUT` (negative); balance − expected delta | Screenshot + SQL |
| AC-OPS-03 | MUST | Stock Out larger than the balance | Rejected with message; no movement | Screenshot + SQL |
| AC-OPS-04 | MUST | Waste with a reason | One `WASTE` movement + `waste_records` row; record immutable | Screenshot + SQL |
| AC-OPS-05 | MUST | Stock count: create → record items (one over, one under) → complete | `COUNT_ADJUSTMENT` movements = counted − system; count completed and locked | Screenshot + SQL |
| AC-OPS-06 | MUST | Any adjustment flow exposed in the v1.2.1 UI | Correct movement type and delta (N/A recorded if not exposed) | Screenshot + SQL |
| AC-OPS-07 | MUST | Double-submit Stock Out (double click / resubmit) | Exactly one movement for the idempotency key | SQL |

### E. Purchasing and receiving

| ID | Pri | Steps | Expected | Evidence |
|---|---|---|---|---|
| AC-PO-01 | MUST | Create PO with two lines for supplier `ACC-Supplier` | PO number generated; status as designed | Screenshot |
| AC-PO-02 | MUST | Move PO to ORDERED | Allowed transition only | Screenshot + SQL |
| AC-PO-03 | MUST | Receive part of line 1 | `PARTIALLY_RECEIVED`; one `PO_RECEIVE` movement; receipt + receipt line; balance + delta | Screenshot + SQL |
| AC-PO-04 | MUST | Receive the remainder; then attempt over-receipt; attempt to receive a cancelled PO | Fully received; over-receipt and terminal-PO receipt rejected | Screenshot + SQL |

### F. Reports

| ID | Pri | Steps | Expected | Evidence |
|---|---|---|---|---|
| AC-RPT-01 | MUST | Open every report page for today and a past range | Loads offline; figures equal SQL with Bangkok day boundaries | Screenshot + SQL |
| AC-RPT-02 | MUST | Dashboard "today" figures after sections D–E | Reflect the test operations exactly | Screenshot |

### G. Local AI

| ID | Pri | Steps | Expected | Evidence |
|---|---|---|---|---|
| AC-AI-01 | MUST | Generate the Local AI summary | Answer from `qwen3.5:4b` via `host.docker.internal:11434` within `OLLAMA_TIMEOUT_MS`; cold and warm times recorded | Screenshot + timing |
| AC-AI-02 | MUST | Quit Ollama; use the AI card; use stock pages; restart Ollama; retry | Clean degraded message, no hang; stock pages unaffected; recovers without app restart | Screenshots |
| AC-AI-03 | MUST | Cloud AI section with `OPENAI_*` unset | Hidden or clean "not configured"; no outbound attempt | Screenshot |
| AC-AI-04 | MUST | Row counts before/after an AI run | Unchanged (AI is read-only) | SQL |

### H. Ledger checks (SQL, run as `supabase_admin` inside `begin … rollback` where they attempt writes)

| ID | Pri | Check | Expected |
|---|---|---|---|
| AC-LEDGER-01 | MUST | `update public.stock_movements set note = note where id = <any>`; `delete … where id = <any>` | Both rejected by the immutability triggers |
| AC-LEDGER-02 | MUST | Same for `purchase_receipts` and `waste_records` | Rejected |
| AC-LEDGER-03 | MUST | Per item: `inventory_balances` balance = `sum(base_quantity)`; test items' balances = baseline + expected deltas | Exact |
| AC-LEDGER-04 | MUST | `select idempotency_key, count(*) … group by 1 having count(*) > 1` | 0 rows |
| AC-LEDGER-05 | MUST | RC-05 anti-joins and RC-11 trigger list re-run after sections D–E | 0 orphans; all triggers enabled |

### I. Persistence

| ID | Pri | Steps | Expected | Evidence |
|---|---|---|---|---|
| AC-PERS-01 | MUST | `Stop-TomYum-Offline` → `Start-TomYum-Offline` | Row counts and digests identical to before stop | SQL |
| AC-PERS-02 | MUST | Windows restart, still offline (§2 step 4) → Docker Desktop → start script | Identical counts/digests; OWNER signs in | SQL + screenshot |
| AC-PERS-03 | MUST | Quit and restart Docker Desktop | Identical | SQL |
| AC-PERS-04 | SHOULD | Abrupt VM stop while idle (owner-approved, e.g. Docker Desktop force quit) | Postgres recovers via WAL; identical | SQL + logs |

### J. Backup and restore

| ID | Pri | Steps | Expected | Evidence |
|---|---|---|---|---|
| AC-BKP-01 | MUST | Scheduled (or `Backup-Now`) backup | Set with `tybc-data.sql.gz`, `tybc-full.dump`, `manifest.json`, `SHA256SUMS`; verification passed | Folder listing + hashes |
| AC-BKP-02 | MUST | Start with last backup > 24 h old (acceptance state file back-dated) | Catch-up backup within 15 min | Logs |
| AC-BKP-03 | MUST | Retention with synthetic old sets | GFS counts kept (14/8/12); never fewer than 3 verified sets; `cutover` sets untouched | Listing |
| AC-BKP-04 | MUST | `Copy-Backup-To-USB` with `TYBC-BACKUP-A`; then with an unlabelled drive | Copy verified on USB; unlabelled drive refused | Log |
| AC-BKP-05 | MUST | Make the backup target unwritable | Failure recorded; red warning at next start | Screenshot |
| AC-RST-01 | MUST | `Restore-TomYum` latest set (blue/green) | Reconciliation vs manifest PASS; pointer switched; old volume retained | Report |
| AC-RST-02 | MUST | Restore from a deliberately corrupted set | Aborted at checksum; live DB untouched | Logs + SQL |
| AC-RST-03 | MUST | Disaster recovery: clean Docker Desktop (or second Windows machine) + release bundle + **USB backup only**, offline | Working system; reconciliation PASS; OWNER signs in | Report |

### K. Security

| ID | Pri | Steps | Expected | Evidence |
|---|---|---|---|---|
| AC-SEC-01 | MUST | `Get-NetTCPConnection -State Listen` for 3000, 3100, 5432, 8000, 9999, 11434 | 3000 and 11434 on `127.0.0.1` only; 5432/8000/9999 absent | Output |
| AC-SEC-02 | MUST | Separate session with LAN connected (Internet optional): from another LAN device probe notebook IP ports 3000, 5432, 8000, 11434 | All closed | Output |
| AC-SEC-03 | MUST | Prerequisite check P16 | PASS (loopback only, no inbound rule) | Report |
| AC-SEC-04 | MUST | Secrets hygiene: image scan, `docker history`, image config env, logs grep for key fingerprints, `icacls` on the secrets file, `git status` | No secrets outside the secrets file; ACL restricted | Output |
| AC-SEC-05 | MUST | From an ops one-off: `/rest/v1/items` with no `apikey`, a random `apikey` | 401 | Output |
| AC-SEC-06 | MUST | Anon key only, no user JWT: `GET /rest/v1/items` | `[]` (RLS `TO authenticated`) | Output |
| AC-SEC-07 | MUST | `POST /auth/v1/signup` | Rejected (sign-ups disabled) | Output |
| AC-SEC-08 | MUST | Ollama allowlist: unit matrix (ADR §5) passes; runtime with `OLLAMA_BASE_URL=http://192.168.1.20:11434` | Tests green; AI reports invalid configuration, no request sent | Test output + screenshot |

### L. Clock and recovery

| ID | Pri | Steps | Expected | Evidence |
|---|---|---|---|---|
| AC-CLK-01 | MUST | Normal start | T1–T4 OK and logged | Log |
| AC-CLK-02 | MUST | Acceptance `last-seen-utc.txt` set 1 h in the future | Start blocked with remedy text; `-AcceptClockRisk` works and is logged | Screenshot + log |
| AC-CLK-03 | MUST | Test hook simulating 30 s and 120 s VM drift | Warn at 30 s; block at 120 s | Log |
| AC-RESET-01 | MUST | `Reset-Owner-Password` | New password works, old fails; an existing signed-in browser is signed out on its next request; audit line without password | Screenshots + log |
| AC-RESET-02 | MUST | Search process list during reset, `docker logs` of all services, ops logs for the test password string | Not found | Output |

### M. Performance and resources (single user)

| ID | Pri | Measure | Target |
|---|---|---|---|
| AC-PERF-01 | SHOULD | Dashboard, inventory, reports navigation (p95 over 10 loads, warm) | ≤ 2 s |
| AC-PERF-02 | SHOULD | Stock In/Out submit → confirmation | ≤ 2 s |
| AC-PERF-03 | MUST | `docker stats` peak during the session; Windows available memory during AI generation | Containers ≤ 2.3 GiB; Windows available memory > 1 GB; no OOM kills |

### N. Cutover (Phase 7, production volume)

| ID | Pri | Check | Expected |
|---|---|---|---|
| AC-CUT-01 | MUST | Cloud freeze: `update public.categories set name = name where false;` on Cloud; Stock Out attempt via Vercel as OWNER | `ARCHIVE_READ_ONLY`; no movement |
| AC-CUT-02 | MUST | Final reconciliation RC-01…RC-14 | 100 % PASS |
| AC-CUT-03 | MUST | Read-only Cloud digests (RC-03/RC-04) re-taken ≥ 24 h after cutover | Identical to the frozen extraction (no Cloud writes happened) |
| AC-CUT-04 | MUST | Notebook: no Cloud keys, cloud launcher retired, CLI link removed, desktop shortcut → offline launcher | Verified |
| AC-CUT-05 | MUST | `cutover-baseline` backup + USB copy | Verified |

## 5. Sign-off

| Section | Result | Waivers | Executor | Witness (OWNER) | Date |
|---|---|---|---|---|---|
| A Network & boot | | | | | |
| B Auth | | | | | |
| C Dashboard & inventory | | | | | |
| D Stock operations | | | | | |
| E Purchasing | | | | | |
| F Reports | | | | | |
| G Local AI | | | | | |
| H Ledger | | | | | |
| I Persistence | | | | | |
| J Backup & restore | | | | | |
| K Security | | | | | |
| L Clock & recovery | | | | | |
| M Performance | | | | | |
| **Offline Edition accepted** | ☐ Yes ☐ No | | | | |
