# Phase 2 infrastructure spike (TEMPORARY)

Disposable stack that proves `PostgreSQL → GoTrue → PostgREST → internal gateway` compatibility with
the v1.2.1 application assumptions, spike S1 (container → native Windows Ollama), resource use and
external-volume persistence. **Synthetic data only. Never point it at Production.** It is replaced
by the real `deploy/offline/` stack in later phases.

| Path | Purpose |
|---|---|
| `compose.spike.yaml` | Topology from the deployment plan: `db`, `auth`, `migrate`, `rest`, `gateway` (+ `probe`, `app` profiles). Internal backend network, external volume, `pull_policy: never`, only `127.0.0.1:3100` published (app profile). |
| `db/init-scripts/99-tybc-roles.sql` | First-init role passwords + read-only `tybc_backup` role (local only). |
| `gateway/templates/default.conf.template` | `/auth/v1` and `/rest/v1` routing with an `apikey` allowlist. |
| `migrate/run-migrations.sh` | Applies `supabase/migrations` as `postgres`, records versions CLI-compatibly, refuses unknown versions and incomplete bootstraps. |
| `tests/compat.mjs`, `tests/db-checks.sql` | API (C01–C16, S1a–c) and database (D01–D15) checks. |
| `tests/make-ui-user.mjs` | Synthetic OWNER for browser checks. |
| `tools/gen-spike-secrets.mjs` | Synthetic secrets (prints fingerprints only; refuses to write inside the repo). |
| `windows/Invoke-TomYum-Phase2Spike.ps1` | One-shot Windows runner: stack, checks, S1 + LAN exposure, RAM sampling, persistence; evidence to `%LOCALAPPDATA%\TomYumBangC\spike\`. |
| `sandbox/` | How the sandbox evidence was produced without Docker Hub (substitute builds of the same versions). |

## Run on Windows (Docker Desktop running, Ollama running on 127.0.0.1:11434)

```powershell
# Preparation machine (Internet): exact images + lock + archives, then probe dependencies
.\scripts\windows\offline-prep\Export-TomYum-OfflineImages.ps1 -OutDir D:\TYBC-package -GatewayImage <nginx exact tag> -NodeImage <node exact tag>
cd deploy\offline\spike\tests; npm ci; cd ..\..\..\..

# Any machine (offline is fine once images are loaded):
.\scripts\windows\offline-prep\Import-TomYum-OfflineImages.ps1 -PackageDir D:\TYBC-package   # client only
.\deploy\offline\spike\windows\Invoke-TomYum-Phase2Spike.ps1
.\deploy\offline\spike\windows\Invoke-TomYum-Phase2Spike.ps1 -Cleanup                        # remove spike
```

The runner never changes Ollama's binding, the firewall, WSL, Docker Desktop settings or Windows
networking. Spike S1 is a hard gate: if the container cannot reach Ollama while Ollama stays on
`127.0.0.1`, stop and report — do not bind Ollama to `0.0.0.0` or a LAN address.
