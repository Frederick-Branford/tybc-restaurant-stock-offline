import "server-only";

import type { User } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// API-route authentication and authorization. Unlike requirePermission(),
// this never redirects and never throws: it returns a result the route maps
// to an HTTP response.
//
// - The signed-in user comes from the cookie session (auth.getUser()).
// - The permission comes from the existing user_has_permission RPC, called
//   with the server-side admin client (the RPC is granted to service_role
//   only). The service-role key never leaves the server.
// - Responses never contain Supabase error details.

export type ApiPermissionFailureCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "AUTH_CHECK_FAILED"
  | "PERMISSION_CHECK_FAILED";

export type ApiPermissionFailure = {
  ok: false;
  status: 401 | 403 | 500;
  code: ApiPermissionFailureCode;
  error: string;
};

export type ApiPermissionResult =
  | { ok: true; user: User }
  | ApiPermissionFailure;

const FAILURES: Record<
  ApiPermissionFailureCode,
  Omit<ApiPermissionFailure, "ok" | "code">
> = {
  UNAUTHENTICATED: {
    status: 401,
    error: "กรุณาเข้าสู่ระบบ",
  },
  FORBIDDEN: {
    status: 403,
    error: "บัญชีนี้ไม่มีสิทธิ์ใช้งานฟังก์ชันนี้",
  },
  AUTH_CHECK_FAILED: {
    status: 500,
    error: "ไม่สามารถตรวจสอบการเข้าสู่ระบบได้",
  },
  PERMISSION_CHECK_FAILED: {
    status: 500,
    error: "ไม่สามารถตรวจสอบสิทธิ์ได้",
  },
};

function fail(code: ApiPermissionFailureCode): ApiPermissionFailure {
  return { ok: false, code, ...FAILURES[code] };
}

export async function checkApiPermission(
  permission: string,
): Promise<ApiPermissionResult> {
  let user: User;

  try {
    const supabase = await createClient();

    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
      return fail("UNAUTHENTICATED");
    }

    user = data.user;
  } catch {
    return fail("AUTH_CHECK_FAILED");
  }

  try {
    const admin = createAdminClient();

    const { data: allowed, error } = await admin.rpc(
      "user_has_permission",
      {
        p_user_id: user.id,
        requested_permission: permission,
      },
    );

    if (error) {
      return fail("PERMISSION_CHECK_FAILED");
    }

    // Only an explicit true grants access (false, null and anything
    // unexpected are denied).
    if (allowed !== true) {
      return fail("FORBIDDEN");
    }

    return { ok: true, user };
  } catch {
    return fail("PERMISSION_CHECK_FAILED");
  }
}
