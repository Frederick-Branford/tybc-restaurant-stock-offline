import { connection } from "next/server";
import { Suspense } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

async function AuthRedirect() {
  await connection();
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return redirect(user ? "/dashboard" : "/login");
}

function AuthLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <p className="text-sm text-muted-foreground">
        กำลังตรวจสอบการเข้าสู่ระบบ...
      </p>
    </main>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={<AuthLoading />}>
      <AuthRedirect />
    </Suspense>
  );
}
