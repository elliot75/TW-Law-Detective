import { NextResponse } from "next/server";
import { LLAMA_PROVIDER, PROVIDERS } from "@/lib/providers";
import { getLlamaConfiguration } from "@/lib/server-explain";

export const dynamic = "force-dynamic";

export function GET() {
  const llamaConfiguration = getLlamaConfiguration();
  const providers = llamaConfiguration
    ? [
        ...PROVIDERS.slice(0, 2),
        { ...LLAMA_PROVIDER, models: llamaConfiguration.models },
        ...PROVIDERS.slice(2),
      ]
    : PROVIDERS;
  return NextResponse.json(providers, {
    headers: { "Cache-Control": "no-store" },
  });
}
