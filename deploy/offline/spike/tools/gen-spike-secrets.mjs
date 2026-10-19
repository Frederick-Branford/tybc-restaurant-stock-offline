#!/usr/bin/env node
// Generates SYNTHETIC secrets for the disposable Phase 2 spike stack.
// Usage: node gen-spike-secrets.mjs <output-env-file>   (file must be OUTSIDE the repo)
// Prints only SHA-256 fingerprints, never the values.
import { randomBytes, createHmac, createHash } from "node:crypto";
import { writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const out = process.argv[2];
if (!out) { console.error("usage: node gen-spike-secrets.mjs <output-env-file>"); process.exit(2); }
if (existsSync(out)) { console.error(`refusing to overwrite ${out}`); process.exit(2); }
if (resolve(out).toLowerCase().includes("restaurant-stock")) {
  console.error("refusing to write secrets inside the repository"); process.exit(2);
}
const b64u = (b) => Buffer.from(b).toString("base64url");
const pw = () => b64u(randomBytes(32));
const jwtSecret = b64u(randomBytes(48));
const sign = (payload) => {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify(payload));
  const s = createHmac("sha256", jwtSecret).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${s}`;
};
const now = Math.floor(Date.now() / 1000);
const exp = now + 10 * 365 * 24 * 3600;
const vals = {
  POSTGRES_PASSWORD: pw(),
  AUTHENTICATOR_PASSWORD: pw(),
  SUPABASE_AUTH_ADMIN_PASSWORD: pw(),
  TYBC_BACKUP_PASSWORD: pw(),
  JWT_SECRET: jwtSecret,
  ANON_KEY: sign({ iss: "supabase", role: "anon", iat: now, exp }),
  SERVICE_ROLE_KEY: sign({ iss: "supabase", role: "service_role", iat: now, exp }),
};
writeFileSync(out, Object.entries(vals).map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });
for (const [k, v] of Object.entries(vals)) {
  console.log(`${k.padEnd(30)} sha256:${createHash("sha256").update(v).digest("hex").slice(0, 12)}`);
}
console.log(`written: ${out} (synthetic spike secrets)`);
