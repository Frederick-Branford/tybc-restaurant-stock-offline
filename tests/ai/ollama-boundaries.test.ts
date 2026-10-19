import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Static guards for the local AI provider path.

const PROVIDER_MODULES = [
  "src/lib/ai/providers/ollama.ts",
  "src/lib/ai/providers/types.ts",
];

const ALLOWED_ENV_KEYS = [
  "AI_LOCAL_ENABLED",
  "OLLAMA_BASE_URL",
  "OLLAMA_KEEP_ALIVE",
  "OLLAMA_MODEL",
  "OLLAMA_TIMEOUT_MS",
  "TYBC_OFFLINE_CONTAINER",
  "VERCEL",
];

function source(relativePath: string): string {
  return readFileSync(
    join(process.cwd(), relativePath),
    "utf8",
  );
}

describe("Local AI provider boundaries", () => {
  it("ollama.ts is server-only", () => {
    expect(
      source("src/lib/ai/providers/ollama.ts"),
    ).toMatch(/^import "server-only";/);
  });

  it.each(PROVIDER_MODULES)(
    "%s has no Supabase client, service-role key, OpenAI SDK or database access",
    (path) => {
      const text = source(path);

      expect(text).not.toMatch(/@supabase\//);
      expect(text).not.toMatch(/@\/lib\/supabase/);
      expect(text).not.toMatch(/SERVICE_ROLE/);
      expect(text).not.toMatch(/from ["']openai["']/);
      expect(text).not.toMatch(/@\/lib\/ai\/openai/);
      expect(text).not.toMatch(
        /@\/lib\/ai\/business-snapshot/,
      );
    },
  );

  it.each(PROVIDER_MODULES)(
    "%s has no writes, RPC, tools or process management",
    (path) => {
      const text = source(path);

      for (const pattern of [
        /\.insert\(/,
        /\.update\(/,
        /\.upsert\(/,
        /\.delete\(/,
        /\.rpc\(/,
        /\btools\s*:/,
        /child_process|\bspawn\(|\bexecFile\(|\bexecSync\(/,
        /\/api\/pull|\/api\/delete|\/api\/create/,
      ]) {
        expect(text).not.toMatch(pattern);
      }
    },
  );

  it.each(PROVIDER_MODULES)(
    "%s never reads NEXT_PUBLIC_* and never logs",
    (path) => {
      const text = source(path);

      expect(text).not.toMatch(
        /env\.NEXT_PUBLIC|env\[["']NEXT_PUBLIC/,
      );
      expect(text).not.toMatch(/console\./);
    },
  );

  it("reads only the documented environment variables", () => {
    const text = source("src/lib/ai/providers/ollama.ts");

    const keys = new Set(
      [...text.matchAll(/\benv\.([A-Z0-9_]+)/g)].map(
        (match) => match[1],
      ),
    );

    expect([...keys].sort()).toEqual(ALLOWED_ENV_KEYS);
    expect(text).not.toMatch(/process\.env\.[A-Z]/);
    expect(text).not.toMatch(/process\.env\[/);
  });

  it("uses only the Ollama chat endpoint", () => {
    const text = source("src/lib/ai/providers/ollama.ts");

    expect(text).toContain('"/api/chat"');
    expect(text).not.toContain("/api/generate");
  });
});
