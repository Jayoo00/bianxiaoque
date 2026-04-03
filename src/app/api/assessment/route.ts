import { NextResponse } from "next/server";

import { buildAssessmentTurn } from "@/lib/assessment-engine";
import { beginAssessmentRequest, finishAssessmentRequest, recordRuntimeError } from "@/lib/runtime-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const token = beginAssessmentRequest();

  try {
    const body = await request.json().catch(() => ({}));
    const response = await buildAssessmentTurn(body?.answers ?? {}, new Date());
    finishAssessmentRequest(token, {
      stage: response.stage,
      answered:
        typeof body?.answers === "object" && body?.answers
          ? Object.keys(body.answers as Record<string, unknown>).length
          : 0,
    });
    return NextResponse.json(response, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    finishAssessmentRequest(token, {
      stage: "error",
      answered: 0,
    });
    recordRuntimeError("assessment", error);
    return NextResponse.json(
      {
        message: "服务暂时有点忙，请稍后再试。",
      },
      { status: 500 },
    );
  }
}
