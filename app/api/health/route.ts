import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json(
    { status: "ok", service: "tw-legal-rag-web" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
