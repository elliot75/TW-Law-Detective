import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ExplanationValidationError,
  TLRBundleSchema,
  validateExplanation,
} from "@/lib/contracts";
import { getServerProvider } from "@/lib/providers";
import {
  callGemini,
  callLlama,
  callOpenAI,
  getLlamaChatEndpoint,
  ProviderRequestError,
} from "@/lib/server-explain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 256 * 1024;

const ExplainRequestSchema = z
  .object({
    providerId: z.enum(["openai", "gemini", "llama"]),
    modelId: z.string().min(1).max(120),
    bundle: TLRBundleSchema,
  })
  .strict();

function errorResponse(code: string, status: number) {
  return NextResponse.json(
    { error: code },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const declaredSize = Number(request.headers.get("content-length") ?? 0);
  if (declaredSize > MAX_BODY_BYTES) {
    return errorResponse("payload_too_large", 413);
  }

  const apiKey = request.headers.get("x-provider-api-key")?.trim();
  if (!apiKey || apiKey.length > 512) {
    return errorResponse("missing_api_key", 401);
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return errorResponse("invalid_request", 400);
  }
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return errorResponse("payload_too_large", 413);
  }

  const parsed = ExplainRequestSchema.safeParse(
    (() => {
      try {
        return JSON.parse(rawBody);
      } catch {
        return null;
      }
    })(),
  );
  if (!parsed.success) return errorResponse("invalid_request", 400);

  const { providerId, modelId, bundle } = parsed.data;
  const llamaEndpoint = getLlamaChatEndpoint();
  if (!getServerProvider(providerId, modelId, Boolean(llamaEndpoint))) {
    return errorResponse("unsupported_model", 400);
  }
  if (bundle.allowed_citations.length === 0) {
    return errorResponse("no_citable_judgments", 400);
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180_000);
    try {
      let candidate: unknown;
      if (providerId === "openai") {
        candidate = await callOpenAI(
          apiKey,
          modelId,
          bundle,
          attempt === 1,
          controller.signal,
        );
      } else if (providerId === "gemini") {
        candidate = await callGemini(
          apiKey,
          modelId,
          bundle,
          attempt === 1,
          controller.signal,
        );
      } else {
        if (!llamaEndpoint) return errorResponse("unsupported_model", 400);
        candidate = await callLlama(
          llamaEndpoint,
          apiKey,
          modelId,
          bundle,
          attempt === 1,
          controller.signal,
        );
      }
      const explanation = validateExplanation(candidate, bundle);
      return NextResponse.json(explanation, {
        headers: { "Cache-Control": "no-store" },
      });
    } catch (error) {
      if (error instanceof ProviderRequestError) {
        return errorResponse(error.code, error.status);
      }
      if (error instanceof Error && error.name === "AbortError") {
        return errorResponse("provider_timeout", 504);
      }
      const validationFailure =
        error instanceof ExplanationValidationError || error instanceof z.ZodError;
      if (!validationFailure || attempt === 1) {
        return errorResponse("unverified_model_output", 422);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  return errorResponse("unverified_model_output", 422);
}
