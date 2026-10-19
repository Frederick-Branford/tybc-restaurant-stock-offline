"use client";

import { useId, useRef, useState } from "react";

import {
  Cpu,
  Info,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type {
  LocalAiSummaryResponse,
  LocalAiUiFactItem,
} from "@/lib/ai/local/api-contract";
import type { LocalAiSignal } from "@/lib/ai/local/digest";
import {
  LOCAL_AI_EMPTY_TEXT,
  LOCAL_AI_SUMMARY_ENDPOINT,
  buildAttentionRows,
  buildFactRows,
  buildLocalAiFooter,
  describeLocalAiAvailability,
  describeLocalAiFailure,
  describeOpenPurchaseOrder,
  describeReorderPosition,
  describeServerDataLimit,
  invalidLocalAiResponseFailure,
  otherFactItems,
  parseLocalAiSummaryResponse,
  type LocalAiAvailability,
  type LocalAiFailure,
} from "@/lib/ai/local/ui-view";

// Local AI summary card for /reports.
//
// Calls only POST /api/ai/local/summary. There is no fallback to any other
// AI provider. Numbers come from response.facts; model text is shown as
// plain text. Error messages are fixed client-side strings.

type LocalAiOutcome =
  | { ok: true; summary: LocalAiSummaryResponse }
  | { ok: false; failure: LocalAiFailure };

async function requestLocalAiSummary(): Promise<LocalAiOutcome> {
  let response: Response;

  try {
    response = await fetch(LOCAL_AI_SUMMARY_ENDPOINT, {
      method: "POST",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    return { ok: false, failure: describeLocalAiFailure(null) };
  }

  if (!response.ok) {
    return {
      ok: false,
      failure: describeLocalAiFailure(response.status),
    };
  }

  let body: unknown;

  try {
    body = await response.json();
  } catch {
    return { ok: false, failure: invalidLocalAiResponseFailure() };
  }

  const summary = parseLocalAiSummaryResponse(body);

  return summary
    ? { ok: true, summary }
    : { ok: false, failure: invalidLocalAiResponseFailure() };
}

const SIGNAL_BADGE_VARIANTS: Record<
  LocalAiSignal,
  "destructive" | "secondary" | "outline"
> = {
  OUT_OF_STOCK: "destructive",
  LOW_STOCK: "secondary",
  BELOW_MINIMUM: "secondary",
  WASTE: "outline",
  ADJUSTMENT: "outline",
};

type LocalAiSummaryCardProps = {
  availability: LocalAiAvailability;
};

export function LocalAiSummaryCard({
  availability,
}: LocalAiSummaryCardProps) {
  const [summary, setSummary] =
    useState<LocalAiSummaryResponse | null>(null);
  const [failure, setFailure] = useState<LocalAiFailure | null>(null);
  const [loading, setLoading] = useState(false);

  // Synchronous guard: a second click in the same tick, before React
  // re-renders the disabled button, must not start another request.
  const inFlight = useRef(false);

  const headingId = useId();
  const enabled = availability === "enabled";
  const availabilityNotice = describeLocalAiAvailability(availability);

  async function analyze() {
    if (!enabled || inFlight.current) {
      return;
    }

    inFlight.current = true;
    setLoading(true);
    setFailure(null);

    try {
      const outcome = await requestLocalAiSummary();

      if (outcome.ok) {
        setSummary(outcome.summary);
      } else {
        // The previous result, if any, stays visible.
        setFailure(outcome.failure);
      }
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  const statusText = loading
    ? "Local AI กำลังวิเคราะห์ข้อมูล"
    : summary && !failure
      ? "ผลวิเคราะห์จาก Local AI พร้อมแล้ว"
      : "";

  return (
    <section
      aria-labelledby={headingId}
      aria-busy={loading}
      className="rounded-xl border bg-card p-4 shadow-card md:p-5"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
            <Cpu className="size-5" aria-hidden="true" />
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id={headingId} className="text-base font-semibold">
                AI วิเคราะห์ร้าน
              </h2>

              <Badge
                variant="secondary"
                className="border-brand-soft-strong bg-brand-soft text-brand-deep"
              >
                Local AI
              </Badge>
            </div>

            <p className="mt-1 break-words text-sm text-muted-foreground">
              วิเคราะห์ Stock ของเสีย และการจัดซื้อด้วย AI
              ที่ประมวลผลบนเครื่องนี้
              ตัวเลขทั้งหมดมาจากข้อมูลในระบบ
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={analyze}
          disabled={!enabled || loading}
          className="inline-flex h-11 w-full shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs transition-colors outline-none hover:bg-brand-hover focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto md:h-10"
        >
          {loading ? (
            <>
              <RefreshCw
                className="size-4 animate-spin"
                aria-hidden="true"
              />
              กำลังวิเคราะห์...
            </>
          ) : (
            <>
              <Cpu className="size-4" aria-hidden="true" />
              วิเคราะห์ด้วย Local AI
            </>
          )}
        </button>
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {statusText}
      </p>

      {availabilityNotice ? (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-dashed bg-surface-warm px-4 py-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p className="min-w-0 break-words">{availabilityNotice}</p>
        </div>
      ) : null}

      {failure ? (
        <div
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-xl border border-danger-border bg-danger-soft px-4 py-3 text-sm text-danger"
        >
          <TriangleAlert
            className="mt-0.5 size-4 shrink-0"
            aria-hidden="true"
          />

          <div className="min-w-0 break-words">
            <p>{failure.message}</p>

            {failure.signIn ? (
              <a
                href="/login"
                className="mt-1 inline-block rounded-sm font-medium underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                ไปหน้าเข้าสู่ระบบ
              </a>
            ) : null}
          </div>
        </div>
      ) : null}

      {loading ? (
        <p className="mt-4 break-words text-sm text-muted-foreground">
          {summary
            ? "กำลังวิเคราะห์รอบใหม่ ผลด้านล่างเป็นของรอบก่อนหน้า"
            : "กำลังอ่านข้อมูลและวิเคราะห์บนเครื่องนี้ อาจใช้เวลาสักครู่"}
        </p>
      ) : null}

      {summary ? (
        <LocalAiSummaryView summary={summary} />
      ) : enabled && !loading ? (
        <div className="mt-5 rounded-xl border border-dashed bg-surface-warm/70 p-5 text-sm text-muted-foreground">
          กด “วิเคราะห์ด้วย Local AI”
          เพื่อสรุปสถานการณ์ Stock จากข้อมูลล่าสุดในระบบ
        </div>
      ) : null}
    </section>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold">{children}</h3>;
}

function LocalAiSummaryView({
  summary,
}: {
  summary: LocalAiSummaryResponse;
}) {
  const rows = buildAttentionRows(summary);
  const others = otherFactItems(summary);
  const windowDays = summary.facts.movement_window_days;
  const { overview, actions, server_data_limits } = summary.result;

  return (
    <div className="mt-5 space-y-5" data-testid="local-ai-result">
      <section className="space-y-2">
        <SectionHeading>ภาพรวม</SectionHeading>

        <p className="whitespace-pre-line break-words text-sm leading-7">
          {overview ?? LOCAL_AI_EMPTY_TEXT.OVERVIEW}
        </p>
      </section>

      <section className="space-y-2">
        <SectionHeading>จุดที่ควรสนใจ</SectionHeading>

        {rows.length > 0 ? (
          <ul className="space-y-3" data-testid="local-ai-attention">
            {rows.map((row) => (
              <li
                key={row.key}
                className="min-w-0 rounded-xl border bg-surface p-3 sm:p-4"
              >
                <ItemHeader
                  name={row.name}
                  sku={row.sku}
                  badge={
                    <Badge variant={SIGNAL_BADGE_VARIANTS[row.signal]}>
                      {row.signalLabel}
                    </Badge>
                  }
                />

                <p className="mt-2 break-words text-sm leading-6">
                  <span className="text-muted-foreground">
                    หมายเหตุจาก AI:{" "}
                  </span>
                  {row.note}
                </p>

                {row.item ? (
                  <ItemFacts item={row.item} windowDays={windowDays} />
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {LOCAL_AI_EMPTY_TEXT.ITEM_FACTS}
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            {LOCAL_AI_EMPTY_TEXT.ATTENTION}
          </p>
        )}
      </section>

      <section className="space-y-2">
        <SectionHeading>คำแนะนำ</SectionHeading>

        {actions.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-sm leading-6">
            {actions.map((action, index) => (
              <li key={`${index}:${action}`} className="break-words">
                {action}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            {LOCAL_AI_EMPTY_TEXT.ACTIONS}
          </p>
        )}
      </section>

      {server_data_limits.length > 0 ? (
        <section className="space-y-2">
          <SectionHeading>ข้อจำกัดของข้อมูล</SectionHeading>

          <ul className="space-y-1 text-sm text-muted-foreground">
            {server_data_limits.map((limit) => (
              <li key={limit} className="flex items-start gap-2">
                <Info
                  className="mt-1 size-3.5 shrink-0"
                  aria-hidden="true"
                />
                <span className="min-w-0 break-words">
                  {describeServerDataLimit(limit, summary.facts)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {others.length > 0 ? (
        <details
          className="group rounded-xl border bg-surface-warm/40"
          open={rows.length === 0}
        >
          <summary className="cursor-pointer rounded-xl px-3 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-4">
            รายการอื่นที่ระบบตรวจพบ ({others.length} รายการ)
          </summary>

          <ul className="space-y-3 border-t p-3 sm:p-4">
            {others.map((item) => (
              <li key={item.sku} className="min-w-0">
                <ItemHeader
                  name={item.name}
                  sku={item.sku}
                  badge={null}
                />
                <ItemFacts item={item} windowDays={windowDays} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="space-y-1 border-t pt-3 text-xs text-muted-foreground">
        <p className="break-words" data-testid="local-ai-footer">
          {buildLocalAiFooter(summary.meta)}
        </p>

        <p className="break-words">
          ตัวเลขทั้งหมดมาจากข้อมูลในระบบโดยตรง
          ข้อความจาก AI ใช้ประกอบการตัดสินใจเท่านั้น
        </p>
      </div>
    </div>
  );
}

function ItemHeader({
  name,
  sku,
  badge,
}: {
  name: string;
  sku: string;
  badge: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="break-words font-medium">{name}</p>
        <p className="break-all text-xs text-muted-foreground">
          SKU: {sku}
        </p>
      </div>

      {badge}
    </div>
  );
}

function ItemFacts({
  item,
  windowDays,
}: {
  item: LocalAiUiFactItem;
  windowDays: number;
}) {
  const facts = buildFactRows(item, windowDays);
  const position = describeReorderPosition(item);
  const openPurchaseOrder = describeOpenPurchaseOrder(item);

  return (
    <div
      className="mt-3 rounded-lg bg-surface-warm p-3"
      data-testid={`local-ai-facts-${item.sku}`}
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
        {facts.map((fact) => (
          <div key={fact.label} className="min-w-0">
            <dt className="text-xs text-muted-foreground">
              {fact.label}
            </dt>
            <dd className="break-words font-medium tabular-nums">
              {fact.value}
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-2 break-words text-xs text-muted-foreground">
        {position.text}
        {openPurchaseOrder ? ` · ${openPurchaseOrder}` : null}
      </p>
    </div>
  );
}
