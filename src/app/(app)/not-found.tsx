import Link from "next/link";
import { SearchX } from "lucide-react";

import { EmptyState } from "@/components/app/empty-state";
import { buttonVariants } from "@/components/ui/button";

export default function AppNotFound() {
  return (
    <EmptyState
      className="mx-auto max-w-lg bg-card py-14"
      icon={SearchX}
      title="ไม่พบข้อมูลที่ต้องการ"
      description="รายการนี้อาจถูกลบ ปิดใช้งาน หรือคุณไม่มีสิทธิ์เข้าถึง"
      action={
        <Link href="/dashboard" className={buttonVariants()}>
          กลับหน้าแรก
        </Link>
      }
    />
  );
}
