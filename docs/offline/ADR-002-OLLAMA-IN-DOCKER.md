# ADR-002 — Ollama in Docker Compose

| Field | Value |
|---|---|
| Status | **Accepted** |
| Date | 2026-10-20 |
| Supersedes | ADR-001 decisions D4/D5 and the native-Windows-Ollama runtime design |
| Scope | TOM YUM BANG C Offline Edition Local AI runtime |

## 1. Context

ADR-001 selected native Windows Ollama and connected the Next.js container through `host.docker.internal:11434`.

The final client-notebook validation demonstrated that Ollama can run reliably inside the same Docker Compose runtime as the application while preserving offline operation, Local AI functionality, and the existing application security boundary.

The validated notebook has 16 GB system RAM. Docker Desktop / WSL2 is configured with an 8 GB memory allocation for the offline stack.

## 2. Decision

Run Ollama as an internal Docker Compose service.

```text
Windows Notebook
      |
      v
Browser
http://127.0.0.1:3100
      |
      v
Docker Compose
      |
      +-- app
      |     |
      |     +-- gateway -> auth / rest -> db
      |     |
      |     +-- http://ollama:11434
      |
      +-- ollama
            |
            +-- qwen3.5:4b
            +-- tybc_ollama_data
```

The application uses:

```text
AI_LOCAL_ENABLED=true
TYBC_OFFLINE_CONTAINER=true
OLLAMA_BASE_URL=http://ollama:11434
OLLAMA_MODEL=qwen3.5:4b
OLLAMA_TIMEOUT_MS=120000
OLLAMA_KEEP_ALIVE=2m
```

## 3. Runtime Boundary

- Ollama image: `ollama/ollama:0.40.4`.
- Ollama listens on port `11434` only inside Docker networking.
- Port `11434` is not published to Windows, the restaurant LAN, or the Internet.
- The app reaches Ollama using the Docker DNS name `ollama`.
- The model store is persisted in the external Docker volume `tybc_ollama_data`.
- Ollama has its own healthcheck, but it is not an `app.depends_on` requirement; core stock operations can start and remain healthy if Ollama is unavailable.
- Native Windows Ollama is not required by the final offline runtime.

## 4. Security Boundary

The Local AI provider keeps strict destination validation.

- Loopback hosts remain valid for non-container development use.
- In offline-container mode, the only allowed Docker Ollama destination is exactly `http://ollama:11434`.
- Arbitrary hostnames, LAN addresses, public addresses, alternate ports, credentials, URL paths, queries, and fragments remain rejected.
- No `host.docker.internal` exception is required by the final runtime.
- Local AI remains read-only and receives only the application-generated business digest.

## 5. Persistence and Resource Policy

- `tybc_ollama_data` is an external persistent volume and must not be removed during normal operation.
- `docker compose down -v` must not be used for normal shutdown.
- Ollama has a Compose memory limit of `6500m`.
- `OLLAMA_KEEP_ALIVE=2m` allows the model to unload after inactivity and return memory to the Docker VM.
- The validated Docker / WSL2 allocation is 8 GB on the current 16 GB notebook.

## 6. Validation Evidence

The architecture was accepted after the following checks passed on the client notebook:

- Docker Compose configuration validation completed successfully.
- Ollama Compose service became healthy.
- `qwen3.5:4b` was available from the persistent Ollama volume.
- The app container resolved and reached `http://ollama:11434` directly.
- The application generated a Local AI report through the Docker Ollama service.
- Local AI continued to work with Wi-Fi disabled.
- The application container remained healthy on the new application image.
- Full automated test suite: 532 passed, 3 skipped, 0 failed.

## 7. Consequences

### Positive

- One Compose runtime owns the application, database services, gateway, authentication, and Local AI.
- No host bridge is required for Local AI.
- No Ollama port must be exposed on Windows or the LAN.
- Startup and dependency management are reproducible through Compose.
- Local AI remains fully usable without Internet connectivity.

### Costs

- Ollama model inference consumes substantial Docker / WSL2 memory.
- Fresh offline installations must provision both the Ollama image and the `qwen3.5:4b` model data.
- The Ollama persistent volume must be treated as deployment data alongside the database volume.

## 8. Rejected Final Alternatives

| Alternative | Outcome | Reason |
|---|---|---|
| Native Windows Ollama + `host.docker.internal` | Superseded | Adds a second runtime boundary and host-bridge dependency that is no longer required. |
| Publish Ollama `11434` to Windows/LAN | Rejected | Unnecessary exposure; the app can reach Ollama through the internal Docker network. |
| Remote/cloud Ollama | Rejected | Conflicts with the Offline Edition requirement. |

## 9. Current Decision

**The production Offline Edition runs Local AI through Ollama inside Docker Compose using `http://ollama:11434`.**
