import {
  CheckCircle2,
  FilePen,
  PackageOpen,
  Truck,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { StatusPill } from "@/components/app/stock-status-badge";

const PO_STATUS: Record<
  string,
  {
    label: string;
    icon: LucideIcon;
    tone: "neutral" | "brand" | "warning" | "success";
  }
> = {
  DRAFT: { label: "แบบร่าง", icon: FilePen, tone: "neutral" },
  ORDERED: { label: "สั่งซื้อแล้ว · รอรับ", icon: Truck, tone: "brand" },
  PARTIALLY_RECEIVED: {
    label: "รับบางส่วน",
    icon: PackageOpen,
    tone: "warning",
  },
  RECEIVED: { label: "รับครบแล้ว", icon: CheckCircle2, tone: "success" },
  CANCELLED: { label: "ยกเลิก", icon: XCircle, tone: "neutral" },
};

/** Purchase order status with icon and text. */
export function PurchaseOrderStatus({ status }: { status: string }) {
  const config = PO_STATUS[status] ?? {
    label: "ไม่ทราบสถานะ",
    icon: FilePen,
    tone: "neutral" as const,
  };

  return (
    <StatusPill tone={config.tone} icon={config.icon}>
      {config.label}
    </StatusPill>
  );
}
