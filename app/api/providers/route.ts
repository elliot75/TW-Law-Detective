import { NextResponse } from "next/server";
import { PROVIDERS } from "@/lib/providers";

export function GET() {
  return NextResponse.json(PROVIDERS, {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
