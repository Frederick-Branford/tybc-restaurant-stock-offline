import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { readSupabaseServerConfig } from "@/lib/supabase/runtime-env";

export async function createClient() {
  const cookieStore = await cookies();
  const { url, publishableKey } =
    readSupabaseServerConfig();

  return createServerClient(
    url,
    publishableKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },

        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(
              ({ name, value, options }) => {
                cookieStore.set(
                  name,
                  value,
                  options,
                );
              },
            );
          } catch {
            // Server Components cannot always write cookies.
            // src/proxy.ts handles session refresh.
          }
        },
      },
    },
  );
}
