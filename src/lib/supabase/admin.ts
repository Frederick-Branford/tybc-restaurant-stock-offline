import "server-only";

import { createClient } from "@supabase/supabase-js";

import { readSupabaseAdminConfig } from "@/lib/supabase/runtime-env";

export function createAdminClient() {
  const {
    url,
    serviceRoleKey,
  } = readSupabaseAdminConfig();

  return createClient(
    url,
    serviceRoleKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}
