// Creates (or resets) a SYNTHETIC OWNER for browser checks. Password comes from UI_PW.
import { createClient } from "@supabase/supabase-js";
const admin = createClient(process.env.SUPABASE_URL, process.env.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const email = process.env.UI_EMAIL ?? "ui-owner@spike.invalid", password = process.env.UI_PW;
if (!password) { console.error("UI_PW required"); process.exit(2); }
let { data: list } = await admin.auth.admin.listUsers();
let user = list.users.find((u) => u.email === email);
if (!user) user = (await admin.auth.admin.createUser({ email, password, email_confirm: true })).data.user;
else await admin.auth.admin.updateUserById(user.id, { password });
const { data: role } = await admin.from("roles").select("id").eq("code", "OWNER").single();
const { error } = await admin.from("profiles").update({ role_id: role.id, full_name: "Spike Owner" }).eq("id", user.id);
console.log(JSON.stringify({ email, id: user.id, ok: !error, error: error?.message }));
