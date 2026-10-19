// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/waste",
}));

vi.mock("@/app/(app)/actions", () => ({
  logout: vi.fn(),
}));

import { MobileNavigation, RailNavigation, SidebarNavigation } from "@/components/app-navigation";
import { BrandLockup } from "@/components/app/brand-logo";
import { EmptyState } from "@/components/app/empty-state";
import { Notice } from "@/components/app/notice";
import {
  OperationalAlert,
  type AttentionItem,
} from "@/components/app/operational-alert";
import { StockStatusBadge } from "@/components/app/stock-status-badge";
import { SubmitButton } from "@/components/app/submit-button";
import { STOCK_LEVELS } from "@/lib/ui/stock-level";
import { Boxes } from "lucide-react";

afterEach(cleanup);

describe("StockStatusBadge", () => {
  it.each(STOCK_LEVELS)("%s shows an icon and a text label, not colour alone", (level) => {
    const { container } = render(<StockStatusBadge level={level} />);
    const badge = container.firstElementChild as HTMLElement;

    expect(badge.querySelector("svg")).not.toBeNull();
    expect(badge.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(badge.textContent?.trim().length).toBeGreaterThan(0);
  });

  it("uses distinct labels for each level", () => {
    render(
      <>
        {STOCK_LEVELS.map((level) => (
          <StockStatusBadge key={level} level={level} />
        ))}
      </>,
    );

    for (const label of ["หมด", "ต่ำกว่าขั้นต่ำ", "ใกล้จุดสั่งซื้อ", "ปกติ"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});

describe("OperationalAlert", () => {
  const items: AttentionItem[] = Array.from({ length: 6 }, (_, index) => ({
    id: `item-${index}`,
    name: `สินค้า ${index + 1}`,
    quantity: `${index * 100} g`,
    level: index === 0 ? "OUT_OF_STOCK" : "NEAR_REORDER",
    detail: "จุดสั่งซื้อ 1,000 g",
  }));

  it("says stock is normal and lists nothing when there is nothing to check", () => {
    render(
      <OperationalAlert
        counts={{ OUT_OF_STOCK: 0, BELOW_MINIMUM: 0, NEAR_REORDER: 0 }}
        items={[]}
        href="/inventory"
      />,
    );

    expect(screen.getByRole("heading", { name: "ต้องตรวจสอบ" })).toBeInTheDocument();
    expect(screen.getByText("Stock โดยรวมอยู่ในระดับปกติ")).toBeInTheDocument();
    expect(screen.queryByText(/รายการต้องดูแล/)).toBeNull();
    expect(screen.getByRole("link", { name: "ดูคลังสินค้า" })).toHaveAttribute("href", "/inventory");
  });

  it("shows the total, per-level counts and the most urgent items first", () => {
    render(
      <OperationalAlert
        counts={{ OUT_OF_STOCK: 1, BELOW_MINIMUM: 0, NEAR_REORDER: 5 }}
        items={items}
        href="/inventory"
      />,
    );

    expect(screen.getByText("รายการต้องดูแล", { exact: false })).toHaveTextContent("6 รายการต้องดูแล");

    const summary = screen.getByRole("list", { name: "สรุปตามสถานะ" });
    expect(within(summary).getByText("หมด").parentElement).toHaveTextContent("หมด1");
    expect(within(summary).getByText("ใกล้จุดสั่งซื้อ").parentElement).toHaveTextContent("ใกล้จุดสั่งซื้อ5");

    // Default limit is 5 rows, the rest is summarised.
    expect(screen.getByText("สินค้า 5")).toBeInTheDocument();
    expect(screen.queryByText("สินค้า 6")).toBeNull();
    expect(screen.getByText(/แสดง 5 จาก 6 รายการ/)).toBeInTheDocument();
  });
});

describe("BrandLockup", () => {
  it("shows the supplied logo file and the brand name", () => {
    const complete = vi
      .spyOn(HTMLImageElement.prototype, "complete", "get")
      .mockReturnValue(false);

    const { container } = render(<BrandLockup />);
    const image = container.querySelector("img");

    expect(image).not.toBeNull();
    expect(decodeURIComponent(image!.getAttribute("src") ?? "")).toContain(
      "/brand/tom-yum-bang-c-logo.jpg",
    );
    expect(screen.getByText("TOM YUM BANG C")).toBeInTheDocument();
    expect(screen.getByText("HALAL HOME")).toBeInTheDocument();

    // A missing file never leaves a broken-image icon behind.
    fireEvent.error(image!);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("TOM YUM BANG C")).toBeInTheDocument();

    complete.mockRestore();
  });
});

describe("Notice", () => {
  it("announces errors as alerts and other feedback as status", () => {
    render(
      <>
        <Notice tone="error">ผิดพลาด</Notice>
        <Notice tone="success">สำเร็จ</Notice>
      </>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("ผิดพลาด");
    expect(screen.getByRole("status")).toHaveTextContent("สำเร็จ");
  });
});

describe("EmptyState", () => {
  it("renders a title, description and action", () => {
    render(
      <EmptyState
        icon={Boxes}
        title="ยังไม่มีสินค้า"
        description="เพิ่มรายการแรก"
        action={<a href="/inventory">เพิ่ม</a>}
      />,
    );

    expect(screen.getByText("ยังไม่มีสินค้า")).toBeInTheDocument();
    expect(screen.getByText("เพิ่มรายการแรก")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "เพิ่ม" })).toBeInTheDocument();
  });
});

describe("SubmitButton", () => {
  it("disables itself while the form action is pending (no double submit)", async () => {
    let finish: () => void = () => {};
    const action = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );

    render(
      <form action={action}>
        <SubmitButton pendingLabel="กำลังบันทึก...">บันทึก</SubmitButton>
      </form>,
    );

    const button = screen.getByRole("button", { name: "บันทึก" });
    expect(button).toBeEnabled();

    await act(async () => {
      fireEvent.click(button);
    });

    const pending = screen.getByRole("button", { name: /กำลังบันทึก/ });
    expect(pending).toBeDisabled();

    await act(async () => {
      fireEvent.click(pending);
    });
    expect(action).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish();
    });

    expect(screen.getByRole("button", { name: "บันทึก" })).toBeEnabled();
  });
});

describe("navigation", () => {
  it("marks the current page with aria-current in the sidebar and rail", () => {
    render(
      <>
        <SidebarNavigation />
        <RailNavigation />
      </>,
    );

    const current = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");

    expect(current).toHaveLength(2);
    for (const link of current) {
      expect(link).toHaveAttribute("href", "/waste");
    }
  });

  it("bottom bar has the five primary destinations and an accessible More menu", async () => {
    render(<MobileNavigation />);

    const nav = screen.getByRole("navigation", { name: "เมนูหลัก" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.textContent?.trim()),
    ).toEqual(["หน้าแรก", "คลัง", "รับเข้า", "เบิก"]);

    const more = within(nav).getByRole("button", { name: "เพิ่มเติม" });
    expect(more).toHaveAttribute("aria-expanded", "false");

    await act(async () => {
      fireEvent.click(more);
    });

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("เมนูเพิ่มเติม")).toBeInTheDocument();

    for (const label of ["ของเสีย", "นับสต็อก", "ประวัติสต็อก", "ผู้จำหน่าย", "ใบสั่งซื้อ", "รายงาน"]) {
      expect(within(dialog).getByRole("link", { name: new RegExp(`^${label}`) })).toBeInTheDocument();
    }

    // Current page inside "More" is marked, and logout is available.
    expect(within(dialog).getByRole("link", { name: /^ของเสีย/ })).toHaveAttribute("aria-current", "page");
    expect(within(dialog).getByRole("button", { name: "ออกจากระบบ" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "ปิดเมนู" })).toBeInTheDocument();
  });
});
