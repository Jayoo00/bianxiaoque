import { NextResponse } from "next/server";

import { recordVisit } from "@/lib/runtime-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  recordVisit();

  return new NextResponse(null, {
    status: 204,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
