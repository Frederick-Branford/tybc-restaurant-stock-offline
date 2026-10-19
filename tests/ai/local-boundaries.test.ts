import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Static guards: the Local AI digest, schema, validation and prompt
// modules are pure. HTTP, Ollama, environment, auth and Supabase belong to
// later phases.

const LOCAL_MODULES = [
  "src/lib/ai/local/digest.ts",
  "src/lib/ai/local/schema.ts",
  "src/lib/ai/local/validate.ts",
  "src/lib/ai/local/prompt.ts",
];

function source(relativePath: string): string {
  return readFileSync(
    join(process.cwd(), relativePath),
    "utf8",
  );
}

describe("Local AI module boundaries", () => {
  it.each(LOCAL_MODULES)(
    "41. %s does not import Supabase, server-only or Next.js",
    (path) => {
      const text = source(path);

      expect(text).not.toMatch(/@supabase\//);
      expect(text).not.toMatch(/@\/lib\/supabase/);
      expect(text).not.toMatch(/["']server-only["']/);
      expect(text).not.toMatch(/from ["']next(\/|["'])/);
      expect(text).not.toMatch(/@\/lib\/ai\/openai/);
      expect(text).not.toMatch(
        /@\/lib\/ai\/business-snapshot/,
      );
    },
  );

  it.each(LOCAL_MODULES)(
    "42. %s makes no network calls and reads no environment, clock or randomness",
    (path) => {
      const text = source(path);

      expect(text).not.toMatch(/\bfetch\(/);
      expect(text).not.toMatch(/https?:\/\//);
      expect(text).not.toMatch(/process\.env/);
      expect(text).not.toMatch(/Date\.now\(|new Date\(/);
      expect(text).not.toMatch(/Math\.random\(/);
      // No Ollama client, endpoint or port (comments may name it).
      expect(text).not.toMatch(
        /from ["'][^"']*ollama|\/api\/(chat|generate)|11434/i,
      );
    },
  );

  it.each(LOCAL_MODULES)(
    "43. %s contains no insert, update, upsert, delete or RPC calls",
    (path) => {
      const text = source(path);

      for (const pattern of [
        /\.insert\(/,
        /\.update\(/,
        /\.upsert\(/,
        /\.delete\(/,
        /\.rpc\(/,
      ]) {
        expect(text).not.toMatch(pattern);
      }
    },
  );
});
