# Phase 2 sandbox evidence (synthetic data only)

Produced on 2026-10-19 in the Linux sandbox (Docker Engine 29.8.2, Compose v5.5.1, 2 vCPU, 7.8 GB RAM)
with the substitute images described in `deploy/offline/spike/sandbox/README.md`. Identifiers and
e-mail addresses are synthetic (`*@spike.invalid`). No secrets are included. These files are **not**
evidence for the Windows client notebook; see `docs/offline/PHASE-2-SPIKE-RESULTS.md`.

| File | Content |
|---|---|
| `runner-results.json` | Summary from `Invoke-TomYum-Phase2Spike.ps1` run under PowerShell 7.5.4 on Linux |
| `compose-up.txt`, `migrate.log` | Stack start-up and the 10 repository migrations |
| `db-checks.txt` | D01–D15 |
| `compat.json` | C01–C16 and S1a–c (S1 fails here by design: no Ollama reachable from a Linux engine) |
| `persistence.json` | Digest before/after stop, down, down -v (runner) |
| `persistence-extended.txt` | Same plus `SIGKILL` of `db` and the non-external-volume contrast |
| `schema-parity.txt` | Repo migrations vs Production schema dump (local backup file): catalog fingerprint and privileges |
| `ui-e2e.json`, `ui-dashboard-synthetic.png` | Unchanged v1.2.1 UI (sandbox build) signed in as a synthetic OWNER against the stack |
| `resources-sandbox.txt` | `docker stats` idle and under 30 page loads |
| `ollama-host-guard.txt` | Ollama 0.40.6 Host-header guard and the Linux-engine negative control |
| `image-roundtrip.txt` | `docker save` → `rmi` → import script → image ID check |
| `prereq-selftest.txt` | 46 assertions of the prerequisite checker self-test |
| `prereq-linux-degraded-run.json` | Checker run on Linux: proves graceful NOT CHECKED behaviour, not a Windows result |
