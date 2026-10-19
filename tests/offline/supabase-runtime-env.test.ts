import { describe, expect, it } from "vitest";

import {
  readSupabaseAdminConfig,
  readSupabaseServerConfig,
} from "@/lib/supabase/runtime-env";

describe("offline Supabase runtime environment", () => {
  it("prefers TYBC runtime values over cloud fallbacks", () => {
    expect(
      readSupabaseServerConfig({
        TYBC_SUPABASE_URL: "http://gateway:8000",
        TYBC_SUPABASE_PUBLISHABLE_KEY: "local-anon",
        NEXT_PUBLIC_SUPABASE_URL: "https://cloud.example",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "cloud-anon",
      }),
    ).toEqual({
      url: "http://gateway:8000",
      publishableKey: "local-anon",
    });
  });

  it("keeps NEXT_PUBLIC fallback for cloud compatibility", () => {
    expect(
      readSupabaseServerConfig({
        NEXT_PUBLIC_SUPABASE_URL: "https://cloud.example",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "cloud-anon",
      }),
    ).toEqual({
      url: "https://cloud.example",
      publishableKey: "cloud-anon",
    });
  });

  it("treats blank TYBC values as unset", () => {
    expect(
      readSupabaseServerConfig({
        TYBC_SUPABASE_URL: " ",
        TYBC_SUPABASE_PUBLISHABLE_KEY: "",
        NEXT_PUBLIC_SUPABASE_URL: "https://cloud.example",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "cloud-anon",
      }),
    ).toEqual({
      url: "https://cloud.example",
      publishableKey: "cloud-anon",
    });
  });

  it("requires a Supabase URL", () => {
    expect(() =>
      readSupabaseServerConfig({
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "anon",
      }),
    ).toThrow(/SUPABASE_URL/);
  });

  it("requires a publishable key", () => {
    expect(() =>
      readSupabaseServerConfig({
        NEXT_PUBLIC_SUPABASE_URL: "https://cloud.example",
      }),
    ).toThrow(/PUBLISHABLE_KEY/);
  });

  it("requires the service-role key for admin access", () => {
    expect(() =>
      readSupabaseAdminConfig({
        TYBC_SUPABASE_URL: "http://gateway:8000",
        TYBC_SUPABASE_PUBLISHABLE_KEY: "local-anon",
      }),
    ).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("returns service-role config without exposing it elsewhere", () => {
    expect(
      readSupabaseAdminConfig({
        TYBC_SUPABASE_URL: "http://gateway:8000",
        TYBC_SUPABASE_PUBLISHABLE_KEY: "local-anon",
        SUPABASE_SERVICE_ROLE_KEY: "local-service-role",
      }),
    ).toEqual({
      url: "http://gateway:8000",
      publishableKey: "local-anon",
      serviceRoleKey: "local-service-role",
    });
  });
});
