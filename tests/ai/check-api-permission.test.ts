import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkApiPermission } from "@/lib/auth/check-api-permission";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  rpc: vi.fn(),
  adminFrom: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    from: mocks.adminFrom,
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

const USER = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "owner@example.test",
};

describe("checkApiPermission (API-safe, no redirect)", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      mock.mockReset();
    }

    mocks.createClient.mockResolvedValue({
      auth: { getUser: mocks.getUser },
    });
    mocks.getUser.mockResolvedValue({
      data: { user: USER },
      error: null,
    });
    mocks.rpc.mockResolvedValue({ data: true, error: null });
  });

  it("returns the user when ai.use is granted", async () => {
    expect(await checkApiPermission("ai.use")).toEqual({
      ok: true,
      user: USER,
    });
  });

  it("1. returns 401 without a signed-in user", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    expect(await checkApiPermission("ai.use")).toEqual({
      ok: false,
      status: 401,
      code: "UNAUTHENTICATED",
      error: "กรุณาเข้าสู่ระบบ",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("2. returns 401 on an auth error", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: "invalid JWT" },
    });

    expect(await checkApiPermission("ai.use")).toMatchObject({
      ok: false,
      status: 401,
      code: "UNAUTHENTICATED",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([false, null, "true", 1, undefined])(
    "3/4. returns 403 unless the RPC returns exactly true (%j)",
    async (allowed) => {
      mocks.rpc.mockResolvedValue({
        data: allowed,
        error: null,
      });

      expect(await checkApiPermission("ai.use")).toEqual({
        ok: false,
        status: 403,
        code: "FORBIDDEN",
        error: "บัญชีนี้ไม่มีสิทธิ์ใช้งานฟังก์ชันนี้",
      });
    },
  );

  it("5. returns 500 when the permission RPC fails, without Supabase details", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "permission denied for function user_has_permission",
        code: "42501",
      },
    });

    const result = await checkApiPermission("ai.use");

    expect(result).toEqual({
      ok: false,
      status: 500,
      code: "PERMISSION_CHECK_FAILED",
      error: "ไม่สามารถตรวจสอบสิทธิ์ได้",
    });
    expect(JSON.stringify(result)).not.toMatch(
      /42501|user_has_permission|denied/,
    );
  });

  it("returns 500 when the permission RPC throws", async () => {
    mocks.rpc.mockRejectedValue(new Error("network down"));

    expect(await checkApiPermission("ai.use")).toMatchObject({
      status: 500,
      code: "PERMISSION_CHECK_FAILED",
    });
  });

  it("returns 500 when the session client cannot be created", async () => {
    mocks.createClient.mockRejectedValue(
      new Error("NEXT_PUBLIC_SUPABASE_URL missing"),
    );

    const result = await checkApiPermission("ai.use");

    expect(result).toEqual({
      ok: false,
      status: 500,
      code: "AUTH_CHECK_FAILED",
      error: "ไม่สามารถตรวจสอบการเข้าสู่ระบบได้",
    });
    expect(JSON.stringify(result)).not.toContain(
      "NEXT_PUBLIC",
    );
  });

  it("6. calls user_has_permission with the user id and the exact permission", async () => {
    await checkApiPermission("ai.use");

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "user_has_permission",
      {
        p_user_id: USER.id,
        requested_permission: "ai.use",
      },
    );
    expect(mocks.adminFrom).not.toHaveBeenCalled();
  });

  it("never redirects", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });
    await checkApiPermission("ai.use");

    mocks.getUser.mockResolvedValue({
      data: { user: USER },
      error: null,
    });
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    await checkApiPermission("ai.use");

    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
