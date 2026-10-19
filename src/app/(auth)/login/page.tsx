import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { LogIn } from "lucide-react";

import { BrandLogo } from "@/components/app/brand-logo";
import {
  BrandPattern,
  IngredientSprig,
} from "@/components/app/brand-pattern";
import { Field } from "@/components/app/form-controls";
import { Notice } from "@/components/app/notice";
import { SubmitButton } from "@/components/app/submit-button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { BRAND } from "@/lib/brand";
import { createClient } from "@/lib/supabase/server";

import { login } from "./actions";

export const metadata: Metadata = {
  title: "เข้าสู่ระบบ",
};

type LoginPageProps = {
  searchParams: Promise<{
    error?: string;
  }>;
};

function BrandHeading() {
  return (
    <div className="text-center lg:text-left">
      <p className="text-2xl font-bold tracking-[0.06em] text-foreground lg:text-3xl xl:text-4xl">
        {BRAND.name}
      </p>
      <p className="mt-1 text-sm font-semibold tracking-[0.3em] text-brand-deep">
        {BRAND.tagline}
      </p>
      <p className="mt-1 text-xs font-medium tracking-[0.24em] text-muted-foreground">
        {BRAND.since}
      </p>
    </div>
  );
}

function LoginCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full rounded-2xl border bg-card p-5 shadow-raised sm:p-7">
      <h1 className="text-xl font-semibold text-foreground">
        เข้าสู่ระบบ
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        กรอกอีเมลและรหัสผ่านเพื่อเข้าใช้งาน
      </p>
      <div className="mt-6">{children}</div>
    </div>
  );
}

async function LoginContent({
  searchParams,
}: LoginPageProps) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    return redirect("/dashboard");
  }

  const params = await searchParams;

  const errorMessage =
    params.error === "missing"
      ? "กรุณากรอกอีเมลและรหัสผ่าน"
      : params.error === "invalid"
        ? "อีเมลหรือรหัสผ่านไม่ถูกต้อง"
        : null;

  return (
    <LoginCard>
      <form action={login} className="space-y-5">
        <Field label="อีเมล" htmlFor="email">
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="name@example.com"
            required
            aria-invalid={errorMessage ? true : undefined}
          />
        </Field>

        <Field label="รหัสผ่าน" htmlFor="password">
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            aria-invalid={errorMessage ? true : undefined}
          />
        </Field>

        {errorMessage ? (
          <Notice tone="error">{errorMessage}</Notice>
        ) : null}

        <SubmitButton
          size="lg"
          className="w-full"
          pendingLabel="กำลังเข้าสู่ระบบ..."
        >
          <LogIn className="size-4" aria-hidden="true" />
          เข้าสู่ระบบ
        </SubmitButton>
      </form>
    </LoginCard>
  );
}

function LoginLoading() {
  return (
    <LoginCard>
      <div role="status" className="space-y-4">
        <span className="sr-only">
          กำลังตรวจสอบสถานะการเข้าสู่ระบบ...
        </span>
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    </LoginCard>
  );
}

export default function LoginPage(
  props: LoginPageProps,
) {
  return (
    <main className="relative flex min-h-dvh flex-1 overflow-hidden bg-background">
      <BrandPattern opacity={0.035} />
      <div
        className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[48rem] -translate-x-1/2 rounded-full bg-brand-soft opacity-70 blur-3xl"
        aria-hidden="true"
      />

      <div className="relative mx-auto grid w-full max-w-5xl content-center items-center gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:gap-14 lg:px-10">
        {/* Brand panel */}
        <section className="flex flex-col items-center gap-5 lg:items-start">
          <BrandLogo
            className="size-28 lg:size-44"
            sizes="(min-width: 1024px) 176px, 112px"
            priority
          />

          <BrandHeading />

          <div className="max-w-md text-center lg:text-left">
            <p className="text-base font-medium text-foreground lg:text-lg">
              {BRAND.product}
            </p>
            <p className="mt-2 hidden text-sm leading-relaxed text-muted-foreground lg:block">
              รู้สถานะวัตถุดิบ ของเสีย และการรับเข้าเบิกออกของร้านได้ในไม่กี่วินาที
            </p>
          </div>

          <IngredientSprig className="hidden h-24 w-32 text-brand-accent opacity-40 lg:block" />
        </section>

        {/* Form */}
        <div className="mx-auto w-full max-w-md">
          <Suspense fallback={<LoginLoading />}>
            <LoginContent {...props} />
          </Suspense>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            {BRAND.company}
          </p>
        </div>
      </div>
    </main>
  );
}
