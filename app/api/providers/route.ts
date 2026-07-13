import { NextResponse } from "next/server";
import { LLAMA_PROVIDER, PROVIDERS } from "@/lib/providers";
import { getLlamaChatEndpoint } from "@/lib/server-explain";

export const dynamic = "force-dynamic";

export function GET() {
  const providers = getLlamaChatEndpoint()
    ? [...PROVIDERS.slice(0, 2), LLAMA_PROVIDER, ...PROVIDERS.slice(2)]
    : PROVIDERS;
  return NextResponse.json(providers, {
    headers: { "Cache-Control": "no-store" },
  });
}
