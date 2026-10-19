"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Boxes,
  Building2,
  ClipboardCheck,
  History,
  LayoutDashboard,
  LogOut,
  MoreHorizontal,
  PackageMinus,
  PackagePlus,
  ShoppingCart,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";

import { logout } from "@/app/(app)/actions";
import { BrandMark } from "@/components/app/brand-logo";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  // Short label for the bottom bar and the tablet rail.
  short: string;
  description: string;
  icon: LucideIcon;
};

const ITEMS = {
  dashboard: {
    href: "/dashboard",
    label: "หน้าแรก",
    short: "หน้าแรก",
    description: "สถานะร้านและสิ่งที่ต้องดูแลวันนี้",
    icon: LayoutDashboard,
  },
  inventory: {
    href: "/inventory",
    label: "คลังสินค้า",
    short: "คลัง",
    description: "ยอดคงเหลือและสถานะสินค้า",
    icon: Boxes,
  },
  stockIn: {
    href: "/stock-in",
    label: "รับสินค้าเข้า",
    short: "รับเข้า",
    description: "บันทึกสินค้าเข้าร้าน",
    icon: PackagePlus,
  },
  stockOut: {
    href: "/stock-out",
    label: "เบิกสินค้า",
    short: "เบิก",
    description: "บันทึกการเบิกไปใช้",
    icon: PackageMinus,
  },
  waste: {
    href: "/waste",
    label: "ของเสีย",
    short: "ของเสีย",
    description: "บันทึกวัตถุดิบเสียหรือสูญเสีย",
    icon: Trash2,
  },
  stockCount: {
    href: "/stock-count",
    label: "นับสต็อก",
    short: "นับสต็อก",
    description: "ตรวจนับของจริงและปรับยอด",
    icon: ClipboardCheck,
  },
  movements: {
    href: "/movements",
    label: "ประวัติสต็อก",
    short: "ประวัติ",
    description: "การเคลื่อนไหวของสต็อกย้อนหลัง",
    icon: History,
  },
  suppliers: {
    href: "/suppliers",
    label: "ผู้จำหน่าย",
    short: "ผู้จำหน่าย",
    description: "รายชื่อ Supplier สำหรับการจัดซื้อ",
    icon: Building2,
  },
  purchaseOrders: {
    href: "/purchase-orders",
    label: "ใบสั่งซื้อ",
    short: "ใบสั่งซื้อ",
    description: "สร้าง PO และรับสินค้าเข้าคลัง",
    icon: ShoppingCart,
  },
  reports: {
    href: "/reports",
    label: "รายงาน",
    short: "รายงาน",
    description: "ภาพรวม Stock ของเสีย การจัดซื้อ และ AI",
    icon: BarChart3,
  },
} satisfies Record<string, NavItem>;

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "งานประจำวัน",
    items: [
      ITEMS.dashboard,
      ITEMS.inventory,
      ITEMS.stockIn,
      ITEMS.stockOut,
      ITEMS.waste,
      ITEMS.stockCount,
    ],
  },
  {
    label: "จัดซื้อ",
    items: [ITEMS.purchaseOrders, ITEMS.suppliers],
  },
  {
    label: "ติดตามผล",
    items: [ITEMS.movements, ITEMS.reports],
  },
];

const ALL_ITEMS = NAV_GROUPS.flatMap((group) => group.items);

const MOBILE_PRIMARY = [
  ITEMS.dashboard,
  ITEMS.inventory,
  ITEMS.stockIn,
  ITEMS.stockOut,
];

const MOBILE_MORE = [
  ITEMS.waste,
  ITEMS.stockCount,
  ITEMS.movements,
  ITEMS.suppliers,
  ITEMS.purchaseOrders,
  ITEMS.reports,
];

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Full sidebar navigation (desktop, xl+). */
export function SidebarNavigation() {
  const pathname = usePathname();

  return (
    <nav aria-label="เมนูหลัก" className="space-y-6">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="px-3 pb-2 text-[0.6875rem] font-semibold tracking-[0.08em] text-muted-foreground">
            {group.label}
          </p>

          <ul className="space-y-1">
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = isActivePath(pathname, item.href);

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
                      active
                        ? "bg-brand-soft text-foreground"
                        : "text-muted-foreground hover:bg-surface-muted hover:text-foreground",
                    )}
                  >
                    <Icon
                      className={cn(
                        "size-[1.125rem] shrink-0",
                        active
                          ? "text-brand"
                          : "text-muted-foreground group-hover:text-foreground",
                      )}
                      aria-hidden="true"
                    />
                    <span className="truncate">{item.label}</span>
                    {active ? (
                      <span
                        className="ml-auto h-5 w-1 rounded-full bg-brand-accent"
                        aria-hidden="true"
                      />
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Compact icon rail (tablet, md–xl). */
export function RailNavigation() {
  const pathname = usePathname();

  return (
    <nav aria-label="เมนูหลัก">
      <ul className="space-y-1">
        {ALL_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = isActivePath(pathname, item.href);

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                title={item.label}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 text-center text-[0.6875rem] leading-tight font-medium transition-colors",
                  active
                    ? "bg-brand-soft text-foreground"
                    : "text-muted-foreground hover:bg-surface-muted hover:text-foreground",
                )}
              >
                <Icon
                  className={cn(
                    "size-5",
                    active ? "text-brand" : undefined,
                  )}
                  aria-hidden="true"
                />
                <span>{item.short}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Bottom bar + "เพิ่มเติม" sheet (phones, < md). */
export function MobileNavigation() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  // The sheet is phone-only: close it if the viewport grows to tablet size
  // (e.g. rotation), so its backdrop never covers the tablet layout.
  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }

    const query = window.matchMedia("(min-width: 768px)");
    const close = () => {
      if (query.matches) {
        setMoreOpen(false);
      }
    };

    query.addEventListener("change", close);

    return () => query.removeEventListener("change", close);
  }, []);

  const moreActive = MOBILE_MORE.some((item) =>
    isActivePath(pathname, item.href),
  );

  return (
    <>
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="max-h-[85dvh] gap-0 overflow-y-auto rounded-t-2xl border-t pb-[calc(1rem+env(safe-area-inset-bottom))] md:hidden"
        >
          <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-2">
            <div className="flex min-w-0 items-center gap-3">
              <BrandMark size={36} decorative />
              <div className="min-w-0">
                <SheetTitle className="text-base font-semibold">
                  เมนูเพิ่มเติม
                </SheetTitle>
                <SheetDescription className="text-xs">
                  ของเสีย นับสต็อก จัดซื้อ และรายงาน
                </SheetDescription>
              </div>
            </div>

            <SheetClose
              render={
                <Button variant="outline" size="icon-sm" aria-label="ปิดเมนู" />
              }
            >
              <X className="size-4" aria-hidden="true" />
            </SheetClose>
          </div>

          <ul className="grid gap-1 px-2 py-2">
            {MOBILE_MORE.map((item) => {
              const Icon = item.icon;
              const active = isActivePath(pathname, item.href);

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setMoreOpen(false)}
                    className={cn(
                      "flex min-h-14 items-center gap-3 rounded-xl px-3 py-2 transition-colors",
                      active ? "bg-brand-soft" : "hover:bg-surface-muted",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-10 shrink-0 items-center justify-center rounded-lg",
                        active
                          ? "bg-surface text-brand"
                          : "bg-surface-muted text-muted-foreground",
                      )}
                    >
                      <Icon className="size-5" aria-hidden="true" />
                    </span>

                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-foreground">
                        {item.label}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {item.description}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="mx-4 mt-1 border-t pt-3">
            <form action={logout}>
              <Button
                type="submit"
                variant="ghost"
                className="w-full justify-start gap-3 text-danger hover:bg-danger-soft hover:text-danger"
              >
                <LogOut className="size-4" aria-hidden="true" />
                ออกจากระบบ
              </Button>
            </form>
          </div>
        </SheetContent>
      </Sheet>

      <nav
        aria-label="เมนูหลัก"
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-surface/95 backdrop-blur-sm md:hidden"
      >
        <ul className="grid grid-cols-5">
          {MOBILE_PRIMARY.map((item) => {
            const Icon = item.icon;
            const active = isActivePath(pathname, item.href);

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-xs font-medium transition-colors",
                    active ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-8 w-14 items-center justify-center rounded-full transition-colors",
                      active ? "bg-brand-soft text-brand" : "",
                    )}
                  >
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <span className={active ? "font-semibold" : undefined}>
                    {item.short}
                  </span>
                </Link>
              </li>
            );
          })}

          <li>
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen(true)}
              className={cn(
                "flex min-h-16 w-full flex-col items-center justify-center gap-1 px-1 text-xs font-medium transition-colors",
                moreActive ? "text-foreground" : "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "flex h-8 w-14 items-center justify-center rounded-full transition-colors",
                  moreActive ? "bg-brand-soft text-brand" : "",
                )}
              >
                <MoreHorizontal className="size-5" aria-hidden="true" />
              </span>
              <span className={moreActive ? "font-semibold" : undefined}>
                เพิ่มเติม
              </span>
            </button>
          </li>
        </ul>

        <div className="h-[env(safe-area-inset-bottom)]" />
      </nav>
    </>
  );
}
