import {
  Suspense,
  type ReactNode,
} from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { LogOut } from "lucide-react";

import {
  MobileNavigation,
  RailNavigation,
  SidebarNavigation,
} from "@/components/app-navigation";
import {
  BrandLockup,
  BrandMark,
} from "@/components/app/brand-logo";
import { Button } from "@/components/ui/button";
import {
  formatLongDate,
  roleLabel,
} from "@/lib/ui/format";
import { createClient } from "@/lib/supabase/server";

import { logout } from "./actions";

type AppLayoutProps = {
  children: ReactNode;
};

async function ProtectedApp({
  children,
}: AppLayoutProps) {
  await connection();

  const supabase =
    await createClient();

  const {
    data: { user },
    error,
  } =
    await supabase.auth.getUser();

  if (error || !user) {
    return redirect("/login");
  }

  const { data: profile } =
    await supabase
      .from("profiles")
      .select(
        "full_name, role_id",
      )
      .eq("id", user.id)
      .maybeSingle();

  let roleCode =
    "UNKNOWN";

  if (profile?.role_id) {
    const { data: role } =
      await supabase
        .from("roles")
        .select("code")
        .eq(
          "id",
          profile.role_id,
        )
        .maybeSingle();

    if (role?.code) {
      roleCode =
        role.code;
    }
  }

  const displayName =
    profile?.full_name ??
    user.email ??
    "ผู้ใช้งาน";

  const role =
    roleLabel(roleCode);

  const today =
    formatLongDate(new Date());

  return (
    <div className="min-h-screen bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-raised"
      >
        ข้ามไปยังเนื้อหาหลัก
      </a>

      {/* Desktop sidebar (xl+) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r bg-surface xl:flex">
        <div className="flex h-20 items-center border-b px-5">
          <BrandLockup />
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-5">
          <SidebarNavigation />
        </div>

        <div className="border-t p-3">
          <div className="rounded-xl bg-surface-warm px-3 py-3">
            <p className="truncate text-sm font-semibold text-foreground">
              {displayName}
            </p>
            <p className="text-xs text-muted-foreground">
              {role}
            </p>
          </div>

          <form action={logout} className="mt-2">
            <Button
              type="submit"
              variant="ghost"
              className="w-full justify-start gap-3 text-muted-foreground hover:text-foreground"
            >
              <LogOut className="size-4" aria-hidden="true" />
              ออกจากระบบ
            </Button>
          </form>
        </div>
      </aside>

      {/* Tablet rail (md–xl) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[5.5rem] flex-col border-r bg-surface md:flex xl:hidden">
        <div className="flex h-20 shrink-0 items-center justify-center border-b">
          <BrandMark size={44} />
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-3">
          <RailNavigation />
        </div>

        <form action={logout} className="border-t p-2">
          <button
            type="submit"
            className="flex min-h-14 w-full flex-col items-center justify-center gap-1 rounded-xl text-[0.6875rem] font-medium text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
          >
            <LogOut className="size-5" aria-hidden="true" />
            ออกจากระบบ
          </button>
        </form>
      </aside>

      <div className="md:pl-[5.5rem] xl:pl-64">
        <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur-sm">
          <div className="mx-auto flex min-h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 md:min-h-20 md:px-6 xl:px-10">
            <div className="min-w-0 md:hidden">
              <BrandLockup compact markSize={34} />
            </div>

            <div className="hidden min-w-0 md:block">
              <p className="text-xs font-semibold tracking-[0.16em] text-brand-deep xl:hidden">
                TOM YUM BANG C
              </p>
              <p className="hidden text-xs font-semibold tracking-[0.16em] text-brand-deep xl:block">
                วันนี้
              </p>
              <p className="truncate text-sm text-muted-foreground">
                {today}
              </p>
            </div>

            <div className="flex min-w-0 items-center gap-3">
              <div className="hidden min-w-0 text-right sm:block">
                <p className="truncate text-sm font-semibold text-foreground">
                  {displayName}
                </p>
                <p className="text-xs text-muted-foreground">
                  {role}
                </p>
              </div>

              <span className="rounded-full border border-brand-soft-strong bg-brand-soft px-3 py-1 text-xs font-semibold text-brand-deep sm:hidden">
                {role}
              </span>
            </div>
          </div>
        </header>

        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-6xl px-4 pt-5 pb-safe-nav focus:outline-none md:px-6 md:pt-7 md:pb-12 xl:px-10 xl:pt-8"
        >
          {children}
        </main>
      </div>

      <MobileNavigation />
    </div>
  );
}

function AppLoading() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
      <BrandMark size={56} />
      <p
        role="status"
        className="text-sm text-muted-foreground"
      >
        กำลังโหลดระบบ...
      </p>
    </div>
  );
}

export default function AppLayout({
  children,
}: AppLayoutProps) {
  return (
    <Suspense fallback={<AppLoading />}>
      <ProtectedApp>
        {children}
      </ProtectedApp>
    </Suspense>
  );
}
