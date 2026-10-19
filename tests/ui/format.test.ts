import { describe, expect, it } from "vitest";

import {
  formatActivityTime,
  formatCount,
  formatDate,
  formatDateTime,
  formatMoney,
  formatQuantity,
  formatSignedQuantity,
  roleLabel,
  toNumber,
} from "@/lib/ui/format";

const NBSP = " ";

describe("number formatting", () => {
  it("formats quantities with thousands separators and a non-breaking unit", () => {
    expect(formatQuantity(11700, "g")).toBe(`11,700${NBSP}g`);
    expect(formatQuantity("1234.56789", "kg")).toBe(`1,234.5679${NBSP}kg`);
    expect(formatQuantity(0, "ml")).toBe(`0${NBSP}ml`);
    expect(formatQuantity(-0, "g")).toBe(`0${NBSP}g`);
    expect(formatQuantity(5)).toBe("5");
  });

  it("signs movements without changing the value", () => {
    expect(formatSignedQuantity(15000, "g")).toBe(`+15,000${NBSP}g`);
    expect(formatSignedQuantity(-2500, "g")).toBe(`-2,500${NBSP}g`);
    expect(formatSignedQuantity(0, "g")).toBe(`0${NBSP}g`);
  });

  it("treats null and invalid input as zero for display", () => {
    expect(toNumber(null)).toBe(0);
    expect(toNumber("abc")).toBe(0);
    expect(formatCount(1234)).toBe("1,234");
    expect(formatMoney(1234.5)).toBe("1,234.50");
  });
});

describe("date formatting (Asia/Bangkok)", () => {
  // 2026-10-15 07:05 UTC = 14:05 in Bangkok.
  const instant = "2026-10-15T07:05:00.000Z";

  it("always uses Bangkok time regardless of server time zone", () => {
    expect(formatDateTime(instant)).toContain("14:05");
    expect(formatDateTime(instant)).toContain("2569");
    expect(formatDate(instant)).toContain("15");
    expect(formatDateTime(null)).toBe("-");
    expect(formatDateTime("not a date")).toBe("-");
  });

  it("adds day context for activity lists", () => {
    const now = new Date("2026-10-15T10:00:00.000Z"); // 17:00 Bangkok

    expect(formatActivityTime(instant, now)).toBe("วันนี้ 14:05");
    expect(
      formatActivityTime("2026-10-14T11:00:00.000Z", now),
    ).toBe("เมื่อวาน 18:00");
    expect(
      formatActivityTime("2026-10-12T11:00:00.000Z", now),
    ).toMatch(/^12 ต\.ค\. 18:00$/);
  });

  it("uses the Bangkok day boundary, not UTC", () => {
    // 2026-10-14 18:30 UTC is already 15 Oct 01:30 in Bangkok.
    const now = new Date("2026-10-15T03:00:00.000Z");

    expect(
      formatActivityTime("2026-10-14T18:30:00.000Z", now),
    ).toBe("วันนี้ 01:30");
  });
});

describe("roleLabel", () => {
  it("shows Thai role names and hides technical codes", () => {
    expect(roleLabel("OWNER")).toBe("เจ้าของร้าน");
    expect(roleLabel("STAFF")).toBe("พนักงาน");
    expect(roleLabel("UNKNOWN")).toBe("ผู้ใช้งาน");
    expect(roleLabel(null)).toBe("ผู้ใช้งาน");
  });
});
