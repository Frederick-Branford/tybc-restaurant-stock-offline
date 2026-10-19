// TYBC Offline Edition — Phase 2 compatibility probe (SYNTHETIC data only).
// Runs inside the backend network against the internal gateway, using the same
// @supabase/supabase-js version as the app. Prints one JSON report to stdout.
import { createClient } from "@supabase/supabase-js";
import { createHmac, randomBytes, randomUUID } from "node:crypto";

const URL_ = process.env.SUPABASE_URL;
const ANON = process.env.ANON_KEY;
const SERVICE = process.env.SERVICE_ROLE_KEY;
const JWT_SECRET = process.env.JWT_SECRET;
const results = [];
const rec = (id, title, status, detail = "") => results.push({ id, title, status, detail: String(detail).slice(0, 300) });
const check = async (id, title, fn) => {
  try { const r = await fn(); rec(id, title, r === true || r?.ok ? "PASS" : "FAIL", r?.detail ?? (r === true ? "" : JSON.stringify(r))); }
  catch (e) { rec(id, title, "FAIL", e?.message ?? e); }
};
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const anon = createClient(URL_, ANON, opts);
const admin = createClient(URL_, SERVICE, opts);
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (payload, secret) => {
  const h = b64u({ alg: "HS256", typ: "JWT" }), p = b64u(payload);
  return `${h}.${p}.${createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url")}`;
};
const decode = (t) => JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString());
const pw = () => randomBytes(18).toString("base64url");
const run = randomBytes(3).toString("hex");
const ownerEmail = `owner-${run}@spike.invalid`, staffEmail = `staff-${run}@spike.invalid`;
let ownerPw = pw(); const staffPw = pw();
let ownerId, staffId, owner, staff, itemId, unitG, unitKg;

// ---- C01 gateway -----------------------------------------------------------
await check("C01", "Gateway: healthz 200, no/unknown apikey 401, unknown path 404, GoTrue health via gateway", async () => {
  const s = async (p, h = {}) => (await fetch(URL_ + p, { headers: h })).status;
  const health = await fetch(URL_ + "/auth/v1/health", { headers: { apikey: ANON } });
  const hv = await health.json().catch(() => ({}));
  const r = {
    healthz: await s("/healthz"), restNoKey: await s("/rest/v1/"), restBadKey: await s("/rest/v1/", { apikey: "x" + ANON.slice(1) }),
    authNoKey: await s("/auth/v1/health"), unknown: await s("/studio"), authHealth: health.status, gotrueVersion: hv.version,
  };
  return { ok: r.healthz === 200 && r.restNoKey === 401 && r.restBadKey === 401 && r.authNoKey === 401 && r.unknown === 404 && r.authHealth === 200, detail: JSON.stringify(r) };
});

// ---- C02 sign-up disabled -----------------------------------------------------
await check("C02", "Public sign-up is disabled", async () => {
  const { data, error } = await anon.auth.signUp({ email: `x-${run}@spike.invalid`, password: pw() });
  return { ok: !!error && !data?.user, detail: error?.message };
});

// ---- C03 admin user creation + handle_new_user trigger ---------------------
await check("C03", "Service role creates users (GoTrue admin API); handle_new_user creates STAFF profiles", async () => {
  const a = await admin.auth.admin.createUser({ email: ownerEmail, password: ownerPw, email_confirm: true });
  const b = await admin.auth.admin.createUser({ email: staffEmail, password: staffPw, email_confirm: true });
  if (a.error || b.error) throw new Error(a.error?.message || b.error?.message);
  ownerId = a.data.user.id; staffId = b.data.user.id;
  const { data, error } = await admin.from("profiles").select("id, roles(code)").in("id", [ownerId, staffId]);
  if (error) throw error;
  return { ok: data.length === 2 && data.every((p) => p.roles?.code === "STAFF"), detail: JSON.stringify(data.map((p) => p.roles?.code)) };
});

// ---- C04 bootstrap OWNER (service role) ------------------------------------
await check("C04", "Bootstrap first OWNER by service role (profiles.role_id)", async () => {
  const { data: role } = await admin.from("roles").select("id").eq("code", "OWNER").single();
  const { error } = await admin.from("profiles").update({ role_id: role.id }).eq("id", ownerId);
  if (error) throw error;
  const { data } = await admin.rpc("user_has_permission", { p_user_id: ownerId, requested_permission: "users.manage" });
  return { ok: data === true, detail: `user_has_permission(owner, users.manage)=${data}` };
});

// ---- C05/C06 sign-in, JWT claims, getClaims -------------------------------
await check("C05", "OWNER password sign-in through gateway; JWT carries sub/role/aud", async () => {
  owner = createClient(URL_, ANON, opts);
  const { data, error } = await owner.auth.signInWithPassword({ email: ownerEmail, password: ownerPw });
  if (error) throw error;
  const c = decode(data.session.access_token);
  return { ok: c.sub === ownerId && c.role === "authenticated" && c.aud === "authenticated", detail: JSON.stringify({ role: c.role, aud: c.aud, alg: "HS256", hasSessionId: !!c.session_id }) };
});
await check("C06", "auth.getClaims() (used by src/proxy.ts) verifies the HS256 session", async () => {
  const { data, error } = await owner.auth.getClaims();
  if (error) throw error;
  return { ok: data?.claims?.sub === ownerId, detail: `sub matches: ${data?.claims?.sub === ownerId}` };
});

// ---- C07/C08 auth.uid() through RLS and SECURITY DEFINER --------------------
await check("C07", "auth.uid() in RLS: OWNER sees all profiles; STAFF sees only own row", async () => {
  staff = createClient(URL_, ANON, opts);
  const s = await staff.auth.signInWithPassword({ email: staffEmail, password: staffPw });
  if (s.error) throw s.error;
  const o = await owner.from("profiles").select("id").in("id", [ownerId, staffId]);
  const st = await staff.from("profiles").select("id").in("id", [ownerId, staffId]);
  if (o.error || st.error) throw o.error || st.error;
  return { ok: o.data.length === 2 && st.data.length === 1 && st.data[0].id === staffId, detail: `owner=${o.data.length} staff=${st.data.length}` };
});
await check("C08", "has_permission() resolves auth.uid() from the JWT (OWNER true / STAFF false for users.manage)", async () => {
  const o = await owner.rpc("has_permission", { requested_permission: "users.manage" });
  const s = await staff.rpc("has_permission", { requested_permission: "users.manage" });
  const s2 = await staff.rpc("has_permission", { requested_permission: "inventory.view" });
  return { ok: o.data === true && s.data === false && s2.data === true, detail: JSON.stringify({ owner: o.data, staff: s.data, staffInventoryView: s2.data, err: o.error?.message || s.error?.message }) };
});

// ---- C09 service-role writes (as the app does) ------------------------------
await check("C09", "Service role: create item (base-unit trigger), Stock In insert, record_stock_out RPC, balance view", async () => {
  const { data: units } = await admin.from("units").select("id, code").in("code", ["G", "KG"]);
  unitG = units.find((u) => u.code === "G").id; unitKg = units.find((u) => u.code === "KG").id;
  const { data: cat } = await admin.from("categories").select("id").eq("code", "INGREDIENT").single();
  const ins = await admin.from("items").insert({ sku: `SPIKE-${run.toUpperCase()}`, name: `Spike chilli ${run}`, category_id: cat.id, base_unit_id: unitG, minimum_stock: 100, reorder_point: 200 }).select("id").single();
  if (ins.error) throw ins.error;
  itemId = ins.data.id;
  const iu = await admin.from("item_units").select("unit_id, conversion_to_base").eq("item_id", itemId);
  const kgAdd = await admin.from("item_units").insert({ item_id: itemId, unit_id: unitKg, conversion_to_base: 1000 });
  const sIn = await admin.from("stock_movements").insert({
    item_id: itemId, movement_type: "STOCK_IN", input_quantity: 2, input_unit_id: unitKg, conversion_to_base: 1000,
    base_unit_id: unitG, base_quantity: 2000, idempotency_key: randomUUID(), created_by: ownerId,
  });
  if (sIn.error) throw sIn.error;
  const out = await admin.rpc("record_stock_out", { p_item_id: itemId, p_input_quantity: 300, p_input_unit_id: unitG, p_actor_id: ownerId, p_idempotency_key: `out-${run}` });
  if (out.error) throw out.error;
  const bal = await admin.from("inventory_balances").select("*").eq("item_id", itemId).single();
  const hasBalance = Object.values(bal.data ?? {}).some((v) => v !== null && v !== "" && Number(v) === 1700);
  return { ok: !kgAdd.error && iu.data?.length === 1 && hasBalance, detail: JSON.stringify({ baseUnitRows: iu.data?.length, kgUnit: kgAdd.error?.message ?? "ok", balanceRow: bal.data }) };
});

// ---- C10 RLS distinguishes roles / anon -----------------------------------
await check("C10", "RLS: anon sees nothing; authenticated with inventory.view sees items; STAFF lacks purchase.view", async () => {
  await admin.from("suppliers").insert({ name: `Spike supplier ${run}`, created_by: ownerId });
  const a = await anon.from("items").select("id").eq("id", itemId);
  const o = await owner.from("items").select("id").eq("id", itemId);
  const s = await staff.from("items").select("id").eq("id", itemId);
  const os = await owner.from("suppliers").select("id");
  const ss = await staff.from("suppliers").select("id");
  const r = { anonItems: a.data?.length ?? a.error?.code, ownerItems: o.data?.length, staffItems: s.data?.length, ownerSuppliers: os.data?.length, staffSuppliers: ss.data?.length };
  return { ok: (a.data?.length === 0 || !!a.error) && o.data?.length === 1 && s.data?.length === 1 && os.data?.length >= 1 && ss.data?.length === 0, detail: JSON.stringify(r) };
});

// ---- C11 ledger write path is server-only -----------------------------------
await check("C11", "Authenticated users cannot write the ledger directly; service role cannot UPDATE/DELETE it", async () => {
  const w = await owner.from("stock_movements").insert({ item_id: itemId, movement_type: "STOCK_IN", input_quantity: 1, input_unit_id: unitG, conversion_to_base: 1, base_unit_id: unitG, base_quantity: 1 });
  const u = await admin.from("stock_movements").update({ note: "tamper" }).eq("item_id", itemId).select();
  const d = await admin.from("stock_movements").delete().eq("item_id", itemId).select();
  const r = { authInsert: w.error?.code ?? "allowed", srvUpdate: u.error?.code ?? `rows:${u.data?.length}`, srvDelete: d.error?.code ?? `rows:${d.data?.length}` };
  return { ok: !!w.error && !!u.error && !!d.error, detail: JSON.stringify(r) };
});

// ---- C12 idempotency ----------------------------------------------------------
await check("C12", "Idempotency: replaying record_stock_out with the same key creates no second movement", async () => {
  const again = await admin.rpc("record_stock_out", { p_item_id: itemId, p_input_quantity: 300, p_input_unit_id: unitG, p_actor_id: ownerId, p_idempotency_key: `out-${run}` });
  const { data } = await admin.from("stock_movements").select("id").eq("idempotency_key", `out-${run}`);
  return { ok: data.length === 1, detail: JSON.stringify({ replayError: again.error?.code ?? null, rows: data.length }) };
});

// ---- C13/C14 JWT validation at PostgREST -----------------------------------
await check("C13", "PostgREST rejects a JWT signed with the wrong secret (forged service_role)", async () => {
  const forged = jwt({ role: "service_role", iss: "supabase", exp: Math.floor(Date.now() / 1000) + 600 }, "not-the-secret-" + run);
  const r = await fetch(`${URL_}/rest/v1/profiles?select=id`, { headers: { apikey: ANON, Authorization: `Bearer ${forged}` } });
  return { ok: r.status === 401, detail: `status ${r.status}` };
});
await check("C14", "PostgREST rejects an expired but correctly signed JWT", async () => {
  const expired = jwt({ role: "authenticated", sub: ownerId, aud: "authenticated", iat: 1, exp: Math.floor(Date.now() / 1000) - 60 }, JWT_SECRET);
  const r = await fetch(`${URL_}/rest/v1/items?select=id`, { headers: { apikey: ANON, Authorization: `Bearer ${expired}` } });
  return { ok: r.status === 401, detail: `status ${r.status}` };
});

// ---- C15 session lifecycle --------------------------------------------------
await check("C15", "Refresh token rotation works; sign-out revokes the refresh token", async () => {
  const before = (await owner.auth.getSession()).data.session;
  const ref = await owner.auth.refreshSession();
  if (ref.error) throw ref.error;
  const rt = ref.data.session.refresh_token;
  await owner.auth.signOut({ scope: "global" });
  const c = createClient(URL_, ANON, opts);
  const reuse = await c.auth.refreshSession({ refresh_token: rt });
  return { ok: ref.data.session.refresh_token !== before.refresh_token && !!reuse.error, detail: `reuse after sign-out: ${reuse.error?.message}` };
});

// ---- C16 password reset path (OWNER reset design) -------------------------
await check("C16", "Admin password reset (PUT /admin/users/{id}): new password works, old one fails, wrong password rejected", async () => {
  const newPw = pw();
  const u = await admin.auth.admin.updateUserById(ownerId, { password: newPw });
  if (u.error) throw u.error;
  const c1 = createClient(URL_, ANON, opts), c2 = createClient(URL_, ANON, opts);
  const oldTry = await c1.auth.signInWithPassword({ email: ownerEmail, password: ownerPw });
  const newTry = await c2.auth.signInWithPassword({ email: ownerEmail, password: newPw });
  ownerPw = newPw;
  return { ok: !!oldTry.error && !newTry.error, detail: JSON.stringify({ old: oldTry.error?.message, new: newTry.error?.message ?? "ok" }) };
});

// ---- S1 (optional): Ollama via host.docker.internal ------------------------
if (process.env.RUN_S1 === "1") {
  const base = process.env.OLLAMA_URL, model = process.env.OLLAMA_MODEL;
  await check("S1a", `Ollama /api/version via ${base}`, async () => {
    const r = await fetch(`${base}/api/version`, { signal: AbortSignal.timeout(5000) });
    return { ok: r.ok, detail: `${r.status} ${await r.text()}` };
  });
  await check("S1b", `Ollama /api/tags lists ${model}`, async () => {
    const r = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) });
    const j = await r.json();
    return { ok: (j.models ?? []).some((m) => m.name === model), detail: (j.models ?? []).map((m) => m.name).join(",") };
  });
  await check("S1c", `Small ${model} inference via ${base}/api/generate`, async () => {
    const t0 = Date.now();
    const r = await fetch(`${base}/api/generate`, {
      method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(180000),
      body: JSON.stringify({ model, prompt: "Reply with the single word OK.", stream: false, think: false, options: { num_predict: 8 } }),
    });
    const j = await r.json();
    return { ok: r.ok && typeof j.response === "string", detail: JSON.stringify({ ms: Date.now() - t0, status: r.status, response: (j.response ?? j.error ?? "").slice(0, 40) }) };
  });
} else {
  rec("S1", "Ollama via host.docker.internal", "NOT TESTED", "RUN_S1 not set");
}

const summary = results.reduce((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {});
console.log(JSON.stringify({ suite: "tybc-phase2-compat", ranAt: new Date().toISOString(), summary, results }, null, 2));
process.exit(results.some((r) => r.status === "FAIL") ? 1 : 0);
