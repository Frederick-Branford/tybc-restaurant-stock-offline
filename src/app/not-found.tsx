import Link from "next/link";
import { SearchX } from "lucide-react";

import { BrandLockup } from "@/components/app/brand-logo";
import { EmptyState } from "@/components/app/empty-state";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-1 flex-col items-center justify-center gap-8 bg-background px-4 py-10">
      <BrandLockup />
      <EmptyState
        className="w-full max-w-lg bg-card py-14"
        icon={SearchX}
        title="ไม่พบหน้าที่ต้องการ"
        description="ลิงก์อาจไม่ถูกต้องหรือหน้านี้ถูกย้ายแล้ว"
        action={
          <Link href="/dashboard" className={buttonVariants()}>
            กลับหน้าแรก
          </Link>
        }
      />
    </main>
  );
}
