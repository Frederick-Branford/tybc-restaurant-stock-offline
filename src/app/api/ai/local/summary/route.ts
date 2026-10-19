import { NextResponse } from "next/server";

import { buildBusinessSnapshotV2 } from "@/lib/ai/business-snapshot-v2";

import {
  LOCAL_AI_ROUTE_ERRORS,
  localAiSummaryResponseSchema,
  type LocalAiErrorResponse,
  type LocalAiRouteErrorCode,
  type LocalAiSummaryResponse,
} from "@/lib/ai/local/api-contract";

import { buildLocalDigest } from "@/lib/ai/local/digest";
import { buildLocalAiUiFacts } from "@/lib/ai/local/ui-facts";

import {
  generateLocalAiSummary,
  isLocalAiInFlight,
  readLocalAiConfig,
} from "@/lib/ai/providers/ollama";

import { checkApiPermission } from "@/lib/auth/check-api-permission";

// POST /api/ai/local/summary
//
// Notebook-only Local AI summary. The request body is never read: every
// fact, the digest, the prompt, the model and the Ollama URL are decided on
// the server. There is no GET handler (GET answers 405).
//
// Order: availability/config -> authentication -> ai.use -> busy check ->
// Business Snapshot V2 -> LocalDigest -> Ollama provider -> validated JSON.
// Nothing from OpenAI is used. Responses are never cached.
//
// Runs on the default Node.js runtime. No `runtime` segment export: Next 16
// rejects route segment config "runtime" when cacheComponents is enabled.

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
} as const;

function errorResponse(
  status: number,
  body: LocalAiErrorResponse,
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

function routeError(
  code: keyof typeof LOCAL_AI_ROUTE_ERRORS,
): NextResponse {
  const { status, error } = LOCAL_AI_ROUTE_ERRORS[code];

  return errorResponse(status, { code, error });
}

// Server-side diagnostics only: fixed codes, never prompt, digest, model
// text, URLs or credentials.
function logFailure(code: LocalAiRouteErrorCode, reason?: string) {
  console.error(
    `[local-ai] ${code}${reason ? `/${reason}` : ""}`,
  );
}

export async function POST(): Promise<NextResponse> {
  const started = performance.now();

  // 1. Local AI must be enabled and correctly configured on this machine.
  const config = readLocalAiConfig();

  if (!config.ok) {
    if (config.error.code === "LOCAL_AI_DISABLED") {
      return routeError("LOCAL_AI_DISABLED");
    }

    logFailure(
      "LOCAL_AI_CONFIGURATION_ERROR",
      config.error.reason,
    );

    return routeError("LOCAL_AI_CONFIGURATION_ERROR");
  }

  // 2-3. Signed-in user with ai.use.
  const permission = await checkApiPermission("ai.use");

  if (!permission.ok) {
    return errorResponse(permission.status, {
      code: permission.code,
      error: permission.error,
    });
  }

  // Fail fast before reading the database if an inference is running.
  if (isLocalAiInFlight()) {
    return routeError("LOCAL_AI_BUSY");
  }

  // 4-5. Authoritative facts, built on the server.
  let snapshot: Awaited<
    ReturnType<typeof buildBusinessSnapshotV2>
  >;

  let digest: ReturnType<typeof buildLocalDigest>;

  try {
    snapshot = await buildBusinessSnapshotV2();
    digest = buildLocalDigest(snapshot);
  } catch {
    logFailure("SNAPSHOT_FAILED");

    return routeError("SNAPSHOT_FAILED");
  }

  // 6. Local inference on the digest only.
  let result: Awaited<
    ReturnType<typeof generateLocalAiSummary>
  >;

  try {
    result = await generateLocalAiSummary(digest);
  } catch {
    logFailure("INTERNAL_ERROR");

    return routeError("INTERNAL_ERROR");
  }

  if (!result.ok) {
    logFailure(result.error.code, result.error.reason);

    return routeError(result.error.code);
  }

  // 7. Only validated model text, server facts and server metadata.
  let body: LocalAiSummaryResponse;

  try {
    body = localAiSummaryResponseSchema.parse({
      result: {
        overview: result.output.overview,
        attention: result.output.attention,
        actions: result.output.actions,
        server_data_limits:
          result.output.server_data_limits,
      },
      facts: buildLocalAiUiFacts(snapshot, digest),
      meta: {
        provider: result.meta.provider,
        model: result.meta.model,
        generated_at: snapshot.generated_at,
        duration_ms: Math.max(
          0,
          Math.round(performance.now() - started),
        ),
      },
    });
  } catch {
    logFailure("INTERNAL_ERROR");

    return routeError("INTERNAL_ERROR");
  }

  return NextResponse.json(body, {
    status: 200,
    headers: NO_STORE_HEADERS,
  });
}
