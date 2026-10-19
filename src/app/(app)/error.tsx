"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";

// Branded fallback for unexpected errors inside the app shell. The error
// message is never shown: in production it is generic, and in development
// it may contain internal details.
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <div
      role="alert"
      className="mx-auto flex max-w-lg flex-col items-center rounded-xl border bg-card px-6 py-12 text-center shadow-card"
    >
      <span className="flex size-14 items-center justify-center rounded-2xl bg-danger-soft text-danger">
        <TriangleAlert className="size-7" aria-hidden="true" />
      </span>

      <h1 className="mt-5 text-xl font-semibold text-foreground">
        ไม่สามารถโหลดหน้านี้ได้
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        ข้อมูลในระบบไม่ได้รับผลกระทบ กรุณาลองใหม่อีกครั้ง
        หากยังพบปัญหา ให้แจ้งผู้ดูแลระบบ
      </p>

      {error.digest ? (
        <p className="mt-3 text-xs text-muted-foreground">
          รหัสอ้างอิง: <span className="font-mono">{error.digest}</span>
        </p>
      ) : null}

      <div className="mt-6 flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
        <Button type="button" onClick={() => retry()}>
          <RotateCcw className="size-4" aria-hidden="true" />
          ลองใหม่
        </Button>
        <Link
          href="/dashboard"
          className={buttonVariants({ variant: "outline" })}
        >
          กลับหน้าแรก
        </Link>
      </div>
    </div>
  );
}
