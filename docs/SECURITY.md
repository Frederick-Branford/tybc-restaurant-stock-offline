# Security

## Core Rules

- Secrets must never be committed.
- Supabase server secrets must never reach the browser.
- Validate all mutation input server-side.
- Enforce authorization server-side.
- Enable RLS for protected application data.
- AI does not receive unrestricted database access.
- AI is read-only in V1.

## Dependency Audit Baseline

At project bootstrap:

npm audit --omit=dev

Result:
0 production vulnerabilities.

Full npm audit reports high-severity advisories in development tooling dependency chains.

These advisories must not be resolved using `npm audit fix --force` when doing so causes incompatible framework or tooling downgrades.

Review upstream fixes and upgrade intentionally.
