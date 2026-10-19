// Display formatting shared by the UI. Thai locale, Bangkok time.
// Formatting only: values are never rounded before being stored or used.

const TIME_ZONE = "Asia/Bangkok";

export function toNumber(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);

  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatNumber(
  value: number | string | null | undefined,
  maximumFractionDigits = 4,
): string {
  const number = toNumber(value);

  return (number === 0 ? 0 : number).toLocaleString("th-TH", {
    maximumFractionDigits,
  });
}

export function formatQuantity(
  value: number | string | null | undefined,
  unit?: string | null,
): string {
  const text = formatNumber(value);

  // Non-breaking space keeps "500 g" together when Thai text wraps.
  return unit ? `${text}\u00a0${unit}` : text;
}

export function formatSignedQuantity(
  value: number | string | null | undefined,
  unit?: string | null,
): string {
  const number = toNumber(value);
  const text = formatQuantity(number, unit);

  return number > 0 ? `+${text}` : text;
}

export function formatCount(value: number): string {
  return value.toLocaleString("th-TH");
}

export function formatMoney(value: number | string | null | undefined): string {
  return toNumber(value).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function toDate(value: string | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

/** e.g. "15 ต.ค. 2569 14:05" */
export function formatDateTime(value: string | Date | null | undefined): string {
  const date = value ? toDate(value) : null;

  return date
    ? date.toLocaleString("th-TH", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: TIME_ZONE,
      })
    : "-";
}

/** e.g. "15 ต.ค. 2569" */
export function formatDate(value: string | Date | null | undefined): string {
  const date = value ? toDate(value) : null;

  return date
    ? date.toLocaleDateString("th-TH", {
        dateStyle: "medium",
        timeZone: TIME_ZONE,
      })
    : "-";
}

/** e.g. "14:05" */
export function formatTime(value: string | Date | null | undefined): string {
  const date = value ? toDate(value) : null;

  return date
    ? date.toLocaleTimeString("th-TH", {
        timeStyle: "short",
        timeZone: TIME_ZONE,
      })
    : "-";
}

function bangkokDayKey(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: TIME_ZONE });
}

/**
 * Time with day context for activity lists:
 * "วันนี้ 14:05", "เมื่อวาน 18:00", or "13 ต.ค. 18:00".
 */
export function formatActivityTime(
  value: string | Date | null | undefined,
  now: Date = new Date(),
): string {
  const date = value ? toDate(value) : null;

  if (!date) {
    return "-";
  }

  const time = formatTime(date);
  const yesterday = new Date(now.getTime() - 86_400_000);

  if (bangkokDayKey(date) === bangkokDayKey(now)) {
    return `วันนี้ ${time}`;
  }

  if (bangkokDayKey(date) === bangkokDayKey(yesterday)) {
    return `เมื่อวาน ${time}`;
  }

  const day = date.toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    timeZone: TIME_ZONE,
  });

  return `${day} ${time}`;
}

/** e.g. "วันพฤหัสบดีที่ 15 ตุลาคม 2569" */
export function formatLongDate(value: string | Date): string {
  const date = toDate(value);

  return date
    ? date.toLocaleDateString("th-TH", {
        dateStyle: "full",
        timeZone: TIME_ZONE,
      })
    : "";
}

export const ROLE_LABELS: Record<string, string> = {
  OWNER: "เจ้าของร้าน",
  MANAGER: "ผู้จัดการ",
  PURCHASING: "ฝ่ายจัดซื้อ",
  STAFF: "พนักงาน",
};

export function roleLabel(code: string | null | undefined): string {
  if (!code) {
    return "ผู้ใช้งาน";
  }

  return ROLE_LABELS[code] ?? "ผู้ใช้งาน";
}
