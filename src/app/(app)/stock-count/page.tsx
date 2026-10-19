import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import {
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  Plus,
  XCircle,
} from "lucide-react";

import { EmptyState } from "@/components/app/empty-state";
import {
  Field,
  MobileActionBar,
} from "@/components/app/form-controls";
import {
  PageHeader,
  Panel,
  SectionHeader,
} from "@/components/app/page-header";
import {
  RecordItem,
  RecordList,
} from "@/components/app/record-list";
import { StatusPill } from "@/components/app/stock-status-badge";
import { SubmitButton } from "@/components/app/submit-button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/ui/format";
import { createClient } from "@/lib/supabase/server";

import {
  createStockCount,
} from "./actions";

export const metadata: Metadata = {
  title: "นับสต็อก",
};

function CountStatus({ status }: { status: string }) {
  if (status === "COMPLETED") {
    return (
      <StatusPill tone="success" icon={CheckCircle2}>
        เสร็จสิ้น
      </StatusPill>
    );
  }

  if (status === "DRAFT") {
    return (
      <StatusPill tone="warning" icon={Clock3}>
        กำลังนับ
      </StatusPill>
    );
  }

  return (
    <StatusPill icon={XCircle}>
      ยกเลิก
    </StatusPill>
  );
}

async function StockCountContent() {
  await connection();
  const supabase =
    await createClient();

  const { data, error } =
    await supabase
      .from("stock_counts")
      .select(
        "id, count_code, status, notes, started_at, completed_at",
      )
      .order(
        "started_at",
        {
          ascending: false,
        },
      )
      .limit(50);

  if (error) {
    throw new Error(
      "Unable to load Stock Counts.",
    );
  }

  const counts = data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ClipboardCheck}
        title="นับสต็อก"
        description="ตรวจนับของจริงในร้าน แล้วให้ระบบปรับยอดตามที่นับได้"
      />

      <Panel aria-labelledby="new-count-title">
        <SectionHeader
          id="new-count-title"
          title="เริ่มรอบนับใหม่"
          description="ระบบจะสร้างรายการสินค้าที่ใช้งานอยู่ทั้งหมดสำหรับรอบนี้"
          icon={Plus}
        />

        <form
          action={createStockCount}
          className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end"
        >
          <Field
            label="หมายเหตุรอบนับ"
            htmlFor="count-notes"
            hint="ไม่บังคับ"
          >
            <Input
              id="count-notes"
              name="notes"
              placeholder="เช่น นับสต็อกปิดร้านประจำวัน"
              maxLength={500}
            />
          </Field>

          <MobileActionBar className="md:pb-6">
            <SubmitButton
              className="w-full md:w-auto"
              pendingLabel="กำลังสร้างรอบนับ..."
            >
              <ClipboardCheck className="size-4" aria-hidden="true" />
              เริ่มนับสต็อก
            </SubmitButton>
          </MobileActionBar>
        </form>
      </Panel>

      <Panel aria-labelledby="count-history-title">
        <SectionHeader
          id="count-history-title"
          title="ประวัติการนับ"
          description="รอบนับล่าสุดของร้าน แตะเพื่อเปิดรายการ"
          icon={ClipboardList}
        />

        {counts.length === 0 ? (
          <EmptyState
            className="mt-4"
            icon={ClipboardList}
            title="ยังไม่มีประวัติการนับสต็อก"
            description="เริ่มรอบนับแรกจากแบบฟอร์มด้านบน"
          />
        ) : (
          <RecordList
            className="mt-4"
            label="ประวัติการนับ"
          >
            {counts.map((count) => (
              <RecordItem
                key={count.id}
                href={`/stock-count/${count.id}`}
                title={count.count_code}
                subtitle={`เริ่ม ${formatDateTime(count.started_at)}`}
                meta={count.notes || undefined}
                aside={<CountStatus status={count.status} />}
              />
            ))}
          </RecordList>
        )}
      </Panel>
    </div>
  );
}

function Loading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <Skeleton className="h-12 w-48" />
      <Skeleton className="h-44 w-full" />
      <Skeleton className="h-72 w-full" />
    </div>
  );
}

export default function StockCountPage() {
  return (
    <Suspense fallback={<Loading />}>
      <StockCountContent />
    </Suspense>
  );
}
