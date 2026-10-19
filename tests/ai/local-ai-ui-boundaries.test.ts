import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Static guards for the Local AI Reports UI.

const CARD = "src/components/local-ai-summary-card.tsx";
const VIEW = "src/lib/ai/local/ui-view.ts";
const PAGE = "src/app/(app)/reports/page.tsx";
const OPENAI_CARD = "src/components/ai-summary-card.tsx";

// Modules the client card pulls into the browser bundle.
const CLIENT_IMPORT_CHAIN = [
  VIEW,
  "src/lib/ai/local/api-contract.ts",
  "src/lib/ai/local/digest.ts",
  "src/lib/ai/local/validate.ts",
  "src/lib/ai/local/schema.ts",
  "src/lib/ai/snapshot/facts.ts",
];

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

function importSpecifiers(text: string): string[] {
  return [...text.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
}

describe("Local AI card boundaries", () => {
  it("is a client component that fetches only the Local AI route", () => {
    const text = source(CARD);

    expect(text.startsWith('"use client";')).toBe(true);
    expect(text.match(/\bfetch\(/g)).toHaveLength(1);
    expect(text).toMatch(/fetch\(LOCAL_AI_SUMMARY_ENDPOINT,/);
    expect(source(VIEW)).toContain(
      'export const LOCAL_AI_SUMMARY_ENDPOINT = "/api/ai/local/summary";',
    );
  });

  it("has no path to Cloud AI or to Ollama", () => {
    for (const path of [CARD, VIEW]) {
      const text = source(path);

      expect(text).not.toContain("/api/ai/summary\"");
      expect(text).not.toMatch(/openai/i);
      expect(text).not.toMatch(/\bAiSummaryCard\b/);
      expect(text).not.toContain("@/components/ai-summary-card");
      expect(text).not.toContain("providers/ollama");
      expect(text).not.toContain("11434");
      expect(text).not.toMatch(/https?:\/\//);
    }
  });

  it("never injects HTML or persists results in the browser", () => {
    for (const path of [CARD, VIEW]) {
      const text = source(path);

      expect(text).not.toContain("dangerouslySetInnerHTML");
      expect(text).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    }
  });

  it("13. never parses model text for numbers", () => {
    for (const path of [CARD, VIEW]) {
      const text = source(path);

      expect(text).not.toMatch(/\bparseFloat\(|\bparseInt\(|\bNumber\(/);
      expect(text).not.toMatch(/\.match\(|\.matchAll\(|new RegExp\(/);
    }
  });

  it("never reads the error body of a failed response", () => {
    const text = source(CARD);
    const failedBranch = text.slice(
      text.indexOf("if (!response.ok)"),
      text.indexOf("let body: unknown;"),
    );

    expect(failedBranch).toContain("describeLocalAiFailure(response.status)");
    expect(failedBranch).not.toMatch(/\.json\(|\.text\(/);
  });

  it("the client import chain is server-free", () => {
    for (const path of CLIENT_IMPORT_CHAIN) {
      const text = source(path);

      expect(text).not.toMatch(/import\s+"server-only"/);

      for (const specifier of importSpecifiers(text)) {
        expect(specifier).not.toMatch(
          /supabase|providers\/|business-snapshot|\/prompt$|^node:|openai/,
        );
      }
    }

    for (const specifier of importSpecifiers(source(CARD))) {
      expect([
        "react",
        "lucide-react",
        "@/components/ui/badge",
        "@/lib/ai/local/api-contract",
        "@/lib/ai/local/digest",
        "@/lib/ai/local/ui-view",
      ]).toContain(specifier);
    }
  });
});

describe("Reports page wiring", () => {
  it("renders Local AI first and Cloud AI only inside a closed details section", () => {
    const text = source(PAGE);

    const localIndex = text.indexOf("<LocalAiSummaryCard");
    const detailsStart = text.indexOf("<details");
    const cloudIndex = text.indexOf("<AiSummaryCard />");
    const detailsEnd = text.indexOf("</details>");

    expect(localIndex).toBeGreaterThan(-1);
    expect(text.match(/<AiSummaryCard \/>/g)).toHaveLength(1);
    expect(localIndex).toBeLessThan(detailsStart);
    expect(detailsStart).toBeLessThan(cloudIndex);
    expect(cloudIndex).toBeLessThan(detailsEnd);

    const detailsTag = text.slice(
      detailsStart,
      text.indexOf(">", detailsStart) + 1,
    );

    expect(detailsTag).not.toMatch(/\bopen\b/);
    expect(text).toContain("Cloud AI (OpenAI) · ใช้เมื่อเลือกเองเท่านั้น");
  });

  it("derives availability from the server config, not from the client", () => {
    const text = source(PAGE);

    expect(text).toContain(
      'import { readLocalAiConfig } from "@/lib/ai/providers/ollama";',
    );
    expect(text).toMatch(
      /<LocalAiSummaryCard\s+availability=\{getLocalAiAvailability\(\)\}/,
    );
    expect(text).not.toMatch(/NEXT_PUBLIC_[A-Z_]*(AI|OLLAMA)/);
  });

  it("leaves the OpenAI card untouched", () => {
    const text = source(OPENAI_CARD);

    expect(text).toContain('"/api/ai/summary"');
    expect(text).not.toContain("/api/ai/local/summary");
  });
});
