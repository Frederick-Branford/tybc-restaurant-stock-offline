import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Static guards for the Snapshot V2 architecture boundaries.

function source(relativePath: string): string {
  return readFileSync(
    join(process.cwd(), relativePath),
    "utf8",
  );
}

const PURE_MODULES = [
  "src/lib/ai/snapshot/facts.ts",
  "src/lib/ai/snapshot/paginate.ts",
];

const SNAPSHOT_V2_MODULES = [
  ...PURE_MODULES,
  "src/lib/ai/business-snapshot-v2.ts",
];

const WRITE_PATTERNS = [
  /\.insert\(/,
  /\.update\(/,
  /\.upsert\(/,
  /\.delete\(/,
  /\.rpc\(/,
];

describe("Snapshot V2 boundaries", () => {
  it.each(PURE_MODULES)(
    "%s is pure: no Supabase, server-only, Next.js or network access",
    (path) => {
      const text = source(path);

      expect(text).not.toMatch(/@supabase\//);
      expect(text).not.toMatch(/@\/lib\/supabase/);
      expect(text).not.toMatch(/["']server-only["']/);
      expect(text).not.toMatch(/from ["']next\//);
      expect(text).not.toMatch(/\bfetch\(/);
      expect(text).not.toMatch(/Date\.now\(|new Date\(/);
      expect(text).not.toMatch(/Math\.random\(/);
    },
  );

  it.each(SNAPSHOT_V2_MODULES)(
    "%s contains no write or RPC calls",
    (path) => {
      const text = source(path);

      for (const pattern of WRITE_PATTERNS) {
        expect(text).not.toMatch(pattern);
      }
    },
  );

  it("the I/O layer is server-only", () => {
    expect(
      source("src/lib/ai/business-snapshot-v2.ts"),
    ).toMatch(/^import "server-only";/);
  });
});
