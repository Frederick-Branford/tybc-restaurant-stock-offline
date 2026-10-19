export type SupabaseRuntimeEnv = Readonly<
  Record<string, string | undefined>
>;

function setting(
  env: SupabaseRuntimeEnv,
  primary: string,
  fallback: string,
): string | undefined {
  const primaryValue = env[primary]?.trim();

  if (primaryValue) {
    return primaryValue;
  }

  const fallbackValue = env[fallback]?.trim();

  return fallbackValue || undefined;
}

export function readSupabaseServerConfig(
  env: SupabaseRuntimeEnv = process.env,
) {
  const url = setting(
    env,
    "TYBC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
  );

  const publishableKey = setting(
    env,
    "TYBC_SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  );

  if (!url) {
    throw new Error(
      "TYBC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is not configured.",
    );
  }

  if (!publishableKey) {
    throw new Error(
      "TYBC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not configured.",
    );
  }

  return {
    url,
    publishableKey,
  } as const;
}

export function readSupabaseAdminConfig(
  env: SupabaseRuntimeEnv = process.env,
) {
  const server = readSupabaseServerConfig(env);
  const serviceRoleKey =
    env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured.",
    );
  }

  return {
    ...server,
    serviceRoleKey,
  } as const;
}
