import { NextResponse } from "next/server";

import { getRuntimeMetricsSnapshot } from "@/lib/runtime-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getRuntimeMetricsSnapshot(), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
