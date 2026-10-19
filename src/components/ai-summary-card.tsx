"use client";

import {
  useState,
} from "react";

import {
  BrainCircuit,
  RefreshCw,
  Sparkles,
} from "lucide-react";

type AiSummaryResponse = {
  summary?: string;
  model?: string;
  generated_at?: string;
  error?: string;
};

export function AiSummaryCard() {
  const [
    summary,
    setSummary,
  ] =
    useState<string | null>(
      null,
    );

  const [
    model,
    setModel,
  ] =
    useState<string | null>(
      null,
    );

  const [
    generatedAt,
    setGeneratedAt,
  ] =
    useState<string | null>(
      null,
    );

  const [
    error,
    setError,
  ] =
    useState<string | null>(
      null,
    );

  const [
    loading,
    setLoading,
  ] =
    useState(false);

  async function analyze() {
    if (loading) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response =
        await fetch(
          "/api/ai/summary",
          {
            method:
              "POST",

            headers: {
              Accept:
                "application/json",
            },
          },
        );

      const data =
        (await response.json()) as AiSummaryResponse;

      if (
        !response.ok ||
        !data.summary
      ) {
        throw new Error(
          data.error ??
            "ไม่สามารถวิเคราะห์ข้อมูลได้",
        );
      }

      setSummary(
        data.summary,
      );

      setModel(
        data.model ??
          null,
      );

      setGeneratedAt(
        data.generated_at ??
          null,
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "เกิดข้อผิดพลาดในการวิเคราะห์ข้อมูล",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-2xl border bg-card p-4 sm:p-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div className="flex items-start gap-3">
          <div className="rounded-lg border p-2">
            <BrainCircuit className="size-5" />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-semibold">
                AI วิเคราะห์ร้าน
              </h2>

              <Sparkles className="size-4" />
            </div>

            <p className="mt-1 text-sm text-muted-foreground">
              วิเคราะห์ Stock, Movement,
              Waste และการจัดซื้อจากข้อมูลจริงของระบบ
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={analyze}
          disabled={loading}
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? (
            <>
              <RefreshCw className="size-4 animate-spin" />
              กำลังวิเคราะห์...
            </>
          ) : summary ? (
            <>
              <RefreshCw className="size-4" />
              วิเคราะห์ใหม่
            </>
          ) : (
            <>
              <Sparkles className="size-4" />
              วิเคราะห์ข้อมูลล่าสุด
            </>
          )}
        </button>
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {summary ? (
        <div className="mt-5 rounded-xl border bg-muted/20 p-4">
          <div className="whitespace-pre-wrap text-sm leading-7">
            {summary}
          </div>

          <div className="mt-4 border-t pt-3 text-xs text-muted-foreground">
            AI ใช้สำหรับช่วยวิเคราะห์เท่านั้น
            ตัวเลข Stock จริงยังยึดข้อมูลจากระบบเป็นหลัก

            {model ? (
              <>
                {" "}
                · {model}
              </>
            ) : null}

            {generatedAt ? (
              <>
                {" "}
                ·{" "}
                {new Date(
                  generatedAt,
                ).toLocaleString(
                  "th-TH",
                )}
              </>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="mt-5 rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
          กด “วิเคราะห์ข้อมูลล่าสุด”
          เพื่อให้ AI ช่วยสรุปสถานการณ์ Stock
          และสิ่งที่เจ้าของร้านควรสนใจ
        </div>
      )}
    </section>
  );
}