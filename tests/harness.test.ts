import { describe, expect, it } from "vitest";

import {
  NETWORK_BLOCKED_MESSAGE,
  SENSITIVE_ENV_KEYS,
} from "./setup/test-guards";

describe("test harness", () => {
  it("runs in the node environment", () => {
    expect(typeof window).toBe("undefined");
    expect(typeof process.versions.node).toBe("string");
  });

  it("resolves @/ aliases and server-only imports", async () => {
    // admin.ts starts with `import "server-only"` and is imported via `@/`.
    const adminModule = await import("@/lib/supabase/admin");

    expect(typeof adminModule.createAdminClient).toBe("function");
  });

  it("hides real secrets from tests", async () => {
    for (const key of SENSITIVE_ENV_KEYS) {
      expect(process.env[key]).toBeUndefined();
    }

    const { createAdminClient } = await import(
      "@/lib/supabase/admin"
    );

    expect(() => createAdminClient()).toThrow(
      "NEXT_PUBLIC_SUPABASE_URL is not configured.",
    );
  });

  it("blocks network access", async () => {
    await expect(
      fetch("https://example.invalid/"),
    ).rejects.toThrow(NETWORK_BLOCKED_MESSAGE);
  });
});
