import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Static guards for the Local AI API route and its helpers.

const ROUTE = "src/app/api/ai/local/summary/route.ts";
const HELPER = "src/lib/auth/check-api-permission.ts";
const CONTRACT = "src/lib/ai/local/api-contract.ts";
const UI_FACTS = "src/lib/ai/local/ui-facts.ts";

function source(relativePath: string): string {
  return readFileSync(
    join(process.cwd(), relativePath),
    "utf8",
  );
}

const WRITE_PATTERNS = [
  /\.insert\(/,
  /\.update\(/,
  /\.upsert\(/,
  /\.delete\(/,
];

describe("Local AI route boundaries", () => {
  it.each([ROUTE, HELPER, CONTRACT, UI_FACTS])(
    "33. %s has no database writes",
    (path) => {
      const text = source(path);

      for (const pattern of WRITE_PATTERNS) {
        expect(text).not.toMatch(pattern);
      }
    },
  );

  it("33. only the helper calls an RPC, and only user_has_permission", () => {
    expect(source(ROUTE)).not.toMatch(/\.rpc\(/);
    expect(source(CONTRACT)).not.toMatch(/\.rpc\(/);
    expect(source(UI_FACTS)).not.toMatch(/\.rpc\(/);

    const rpcCalls = [
      ...source(HELPER).matchAll(/\.rpc\(\s*"([^"]+)"/g),
    ].map((match) => match[1]);

    expect(rpcCalls).toEqual(["user_has_permission"]);
  });

  it("34. the Local AI route never imports OpenAI or Snapshot V1", () => {
    const text = source(ROUTE);

    expect(text).not.toMatch(/from ["']openai["']/);
    expect(text).not.toMatch(/@\/lib\/ai\/openai/);
    expect(text).not.toMatch(
      /@\/lib\/ai\/business-snapshot["']/,
    );
  });

  it("13/14. the route never reads the request body, query or headers", () => {
    const text = source(ROUTE);

    expect(text).toMatch(/export async function POST\(\)/);
    expect(text).not.toMatch(
      /request\.|req\.|\.json\(\)|\.formData\(|searchParams|headers\(\)/,
    );
  });

  it("36. the route defines no GET or other method handlers", () => {
    expect(source(ROUTE)).not.toMatch(
      /export\s+(async\s+)?(function|const)\s+(GET|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/,
    );
  });

  it("uses the default Node.js runtime (no segment config, incompatible with cacheComponents)", () => {
    expect(source(ROUTE)).not.toMatch(
      /export\s+const\s+(runtime|dynamic|revalidate|fetchCache)\b/,
    );
  });

  it("the route reads no environment directly and is never cached", () => {
    const text = source(ROUTE);

    expect(text).not.toMatch(/process\.env/);
    expect(text).toContain('"Cache-Control": "no-store, max-age=0"');
  });

  it("the permission helper is server-only and never redirects", () => {
    const text = source(HELPER);

    expect(text).toMatch(/^import "server-only";/);
    expect(text).not.toMatch(
      /from ["']next\/navigation["']|\bredirect\(/,
    );
    expect(text).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it.each([CONTRACT, UI_FACTS])(
    "%s is pure (no Supabase, server-only, network or environment)",
    (path) => {
      const text = source(path);

      expect(text).not.toMatch(/@supabase\/|@\/lib\/supabase/);
      expect(text).not.toMatch(/["']server-only["']/);
      expect(text).not.toMatch(/\bfetch\(|process\.env/);
    },
  );
});
