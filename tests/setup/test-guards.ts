import { beforeEach, vi } from "vitest";

// Environment variables that production code reads for credentials or
// endpoints. Tests must never see real values, even when the developer
// shell exports them. Tests that need a value stub a fake one explicitly.
export const SENSITIVE_ENV_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
] as const;

export const NETWORK_BLOCKED_MESSAGE =
  "Network access is blocked in tests";

beforeEach(() => {
  for (const key of SENSITIVE_ENV_KEYS) {
    vi.stubEnv(key, undefined);
  }

  // The OpenAI SDK and supabase-js both use global fetch.
  // Any unmocked request fails loudly instead of reaching the network.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      throw new Error(
        `${NETWORK_BLOCKED_MESSAGE}: ${String(input)}`,
      );
    }),
  );
});
