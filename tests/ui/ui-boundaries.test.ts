import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

// Static guards for the Phase 6 brand redesign.

const ROOT = process.cwd();

function walk(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(ROOT, path)).isDirectory() ? walk(path) : [path];
  });
}

function source(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

const UI_FILES = walk("src")
  .filter((path) => /\.(tsx|ts)$/.test(path))
  .filter((path) => !path.startsWith(join("src", "lib", "ai")))
  .filter((path) => !path.includes(join("app", "api")));

// Protected, unchanged in this phase.
const PROTECTED = new Set([join("src", "components", "ai-summary-card.tsx")]);

describe("design tokens", () => {
  it("keeps brand hex values out of components", () => {
    const offenders = UI_FILES.filter(
      (path) =>
        path !== join("src", "lib", "brand.ts") &&
        /#[0-9a-fA-F]{6}\b/.test(source(path)),
    );

    expect(offenders).toEqual([]);
  });

  it("uses semantic status tokens instead of raw palette colours", () => {
    const pattern =
      /\b(?:bg|text|border|ring)-(?:red|green|emerald|amber|yellow|orange|rose|lime)-\d{2,3}\b/;

    const offenders = UI_FILES.filter(
      (path) => !PROTECTED.has(path) && pattern.test(source(path)),
    );

    expect(offenders).toEqual([]);
  });

  it("defines the brand, surface, text and status tokens centrally", () => {
    const css = source("src/app/globals.css");

    for (const token of [
      "--brand-primary",
      "--brand-primary-hover",
      "--brand-secondary",
      "--brand-accent",
      "--brand-deep",
      "--brand-soft",
      "--background",
      "--surface",
      "--surface-warm",
      "--surface-muted",
      "--border",
      "--text-primary",
      "--text-secondary",
      "--success",
      "--warning",
      "--danger",
      "--critical",
    ]) {
      expect(css).toContain(`${token}:`);
    }
  });
});

describe("brand assets", () => {
  it("serves the supplied logo from /public/brand without base64 or remote URLs", () => {
    const brand = source("src/lib/brand.ts");

    expect(brand).toContain('"/brand/tom-yum-bang-c-logo.jpg"');
    expect(brand).not.toMatch(/data:image|https?:\/\//);

    for (const path of UI_FILES) {
      expect(source(path)).not.toMatch(/data:image\/(?:png|jpe?g|webp)/);
    }
  });

  it("sets Thai as the document language and a real title", () => {
    const layout = source("src/app/layout.tsx");

    expect(layout).toContain('lang="th"');
    expect(layout).not.toContain("Create Next App");
  });
});

describe("forms still send every field their server actions read", () => {
  // Route folder → files that render its forms.
  const ROUTES = [
    "src/app/(app)/inventory",
    "src/app/(app)/stock-in",
    "src/app/(app)/stock-out",
    "src/app/(app)/waste",
    "src/app/(app)/stock-count",
    "src/app/(app)/suppliers",
    "src/app/(app)/purchase-orders",
    "src/app/(auth)/login",
  ];

  it.each(ROUTES)("%s", (route) => {
    const actions = source(`${route}/actions.ts`);
    const keys = new Set(
      [...actions.matchAll(/formData\.get(?:All)?\(\s*"([A-Za-z_]+)"/g)].map(
        (match) => match[1],
      ),
    );

    expect(keys.size).toBeGreaterThan(0);

    const markup = walk(route)
      .filter((path) => path.endsWith(".tsx"))
      .map(source)
      .join("\n");

    const missing = [...keys].filter(
      (key) => !new RegExp(`name=(?:"${key}"|\\{?"${key}"\\}?)`).test(markup),
    );

    expect(missing).toEqual([]);
  });

  it("every page still wires the same server actions", () => {
    const expectations: Record<string, string[]> = {
      "src/app/(app)/inventory/page.tsx": ["createItem"],
      "src/app/(app)/stock-in/stock-in-form.tsx": ["createStockIn"],
      "src/app/(app)/stock-out/stock-out-form.tsx": ["createStockOut"],
      "src/app/(app)/waste/waste-form.tsx": ["createWaste"],
      "src/app/(app)/stock-count/page.tsx": ["createStockCount"],
      "src/app/(app)/stock-count/[id]/page.tsx": ["completeStockCount", "recordCountItem"],
      "src/app/(app)/suppliers/page.tsx": ["createSupplier", "setSupplierActive"],
      "src/app/(app)/purchase-orders/new/page.tsx": ["createPurchaseOrder"],
      "src/app/(app)/purchase-orders/[id]/page.tsx": [
        "addPurchaseOrderItem",
        "cancelPurchaseOrder",
        "confirmPurchaseOrder",
        "deletePurchaseOrderItem",
      ],
      "src/app/(app)/purchase-orders/[id]/receiving-section.tsx": ["receivePurchaseOrderItem"],
      "src/app/(auth)/login/page.tsx": ["login"],
    };

    for (const [path, names] of Object.entries(expectations)) {
      const text = source(path);

      for (const name of names) {
        expect(text, `${relative(ROOT, path)} → ${name}`).toMatch(
          new RegExp(`action=\\{\\s*${name}\\s*\\}`),
        );
      }
    }
  });

  it("keeps the PO receiving idempotency key per rendered form", () => {
    expect(
      source("src/app/(app)/purchase-orders/[id]/receiving-section.tsx"),
    ).toContain(
      "value={`po-receive:${purchaseOrderId}:${line.id}:${randomUUID()}`}",
    );
  });
});
