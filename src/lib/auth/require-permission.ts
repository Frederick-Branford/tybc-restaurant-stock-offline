import "server-only";

import { redirect } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function requirePermission(
  permission: string,
) {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return redirect("/login");
  }

  const admin = createAdminClient();

  const {
    data: allowed,
    error: permissionError,
  } = await admin.rpc("user_has_permission", {
    p_user_id: user.id,
    requested_permission: permission,
  });

  if (permissionError) {
    throw new Error(
      `Permission check failed: ${permissionError.message}`,
    );
  }

  if (!allowed) {
    throw new Error(
      `Forbidden: missing ${permission}`,
    );
  }

  return {
    user,
    admin,
  };
}
