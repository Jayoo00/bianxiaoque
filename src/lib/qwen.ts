import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

import {
  beginAiRequest,
  finishAiRequest,
  getCurrentAiInFlight,
  recordAiSkipped,
  recordRuntimeError,
} from "@/lib/runtime-metrics";
import type {
  BirthTimingProfile,
  ConstitutionSummary,
  NarrativeBlocks,
  Recommendation,
  SeasonalContext,
} from "@/lib/types";

type NarrativeSeed = {
  profileTitle: string;
  summary: string;
  seasonalContext: SeasonalContext;
  birthTimingProfile?: BirthTimingProfile;
  primary: ConstitutionSummary;
  secondary?: ConstitutionSummary;
  baduanjin: Recommendation[];
  sachets: Recommendation[];
  habits: string[];
};

const DEFAULT_OPENAI_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DEFAULT_OPENAI_MODEL = "qwen3.5-flash";
const DEFAULT_ANTHROPIC_BASE_URL = "https://api.minimaxi.com/anthropic";
const DEFAULT_ANTHROPIC_MODEL = "MiniMax-M2.7-highspeed";
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_CONCURRENCY = 8;

function parsePositiveNumber(rawValue: string | undefined, fallback: number) {
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isTimeoutError(error: unknown) {
  return error instanceof Error && /timeout|timed out|ETIMEDOUT/i.test(error.message);
}

function extractJsonObject(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  try {
    return JSON.parse(text.slice(start, end + 1)) as Partial<NarrativeBlocks>;
  } catch {
    return null;
  }
}

function sanitizeNarrative(payload: Partial<NarrativeBlocks> | null) {
  if (!payload) {
    return null;
  }

  const narrative: Partial<NarrativeBlocks> = {};

  if (payload.headline?.trim()) {
    narrative.headline = payload.headline.trim().slice(0, 24);
  }

  if (payload.constitutionSummary?.trim()) {
    narrative.constitutionSummary = payload.constitutionSummary.trim();
  }

  if (payload.personalRhythmSummary?.trim()) {
    narrative.personalRhythmSummary = payload.personalRhythmSummary.trim();
  }

  if (payload.seasonalSummary?.trim()) {
    narrative.seasonalSummary = payload.seasonalSummary.trim();
  }

  if (payload.exerciseSummary?.trim()) {
    narrative.exerciseSummary = payload.exerciseSummary.trim();
  }

  if (payload.sachetSummary?.trim()) {
    narrative.sachetSummary = payload.sachetSummary.trim();
  }

  if (payload.lifestyleTip?.trim()) {
    narrative.lifestyleTip = payload.lifestyleTip.trim();
  }

  return Object.keys(narrative).length > 0 ? narrative : null;
}

function buildNarrativePayload(seed: NarrativeSeed) {
  return JSON.stringify(
    {
      task: "请基于以下结构化信息，生成适合微信 H5 结果页展示的 7 段短文案。",
      constraints: {
        style: "简洁、规范、温和、执行导向",
        eachField: "1-2句，避免堆砌术语",
        avoid: [
          "替代诊断",
          "夸大疗效",
          "超过两句的长段落",
          "与输入事实不一致",
        ],
        mustInclude: [
          "八段锦和香囊建议都要给出明确理由",
          "措辞要像正式健康建议，不要口语化散乱",
          "结论必须与输入的体质和症状信号一致",
          "个人五运六气分析要通俗，不要神秘化，不要像算命",
        ],
      },
      data: seed,
    },
    null,
    2,
  );
}

function getProviderConfig() {
  const provider =
    process.env.NARRATIVE_API_PROTOCOL ??
    process.env.AI_API_PROTOCOL ??
    (process.env.ANTHROPIC_BASE_URL || process.env.ANTHROPIC_API_KEY ? "anthropic" : "openai");

  if (provider === "anthropic") {
    return {
      provider: "anthropic" as const,
      apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.AI_API_KEY ?? "",
      baseURL: process.env.ANTHROPIC_BASE_URL ?? process.env.AI_BASE_URL ?? DEFAULT_ANTHROPIC_BASE_URL,
      model: process.env.ANTHROPIC_MODEL ?? process.env.AI_MODEL ?? DEFAULT_ANTHROPIC_MODEL,
    };
  }

  return {
    provider: "openai" as const,
    apiKey: process.env.DASHSCOPE_API_KEY ?? process.env.AI_API_KEY ?? "",
    baseURL: process.env.DASHSCOPE_BASE_URL ?? process.env.AI_BASE_URL ?? DEFAULT_OPENAI_BASE_URL,
    model: process.env.QWEN_MODEL ?? process.env.AI_MODEL ?? DEFAULT_OPENAI_MODEL,
  };
}

export async function generateQwenNarrative(seed: NarrativeSeed) {
  const providerConfig = getProviderConfig();
  const maxConcurrency = parsePositiveNumber(process.env.QWEN_MAX_CONCURRENCY, DEFAULT_MAX_CONCURRENCY);
  const timeout = parsePositiveNumber(process.env.QWEN_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);

  if (!providerConfig.apiKey) {
    recordAiSkipped();
    return null;
  }

  if (getCurrentAiInFlight() >= maxConcurrency) {
    recordAiSkipped();
    return null;
  }

  const token = beginAiRequest();
  const userPrompt = buildNarrativePayload(seed);
  const systemPrompt =
    "你是“扁小鹊健康智能体”的文案助手。请把规则引擎已经算好的结果整理成规范、简洁、专业但不吓人的健康建议。不要夸张，不要承诺疗效，不要扩写成医学诊断。出生日期只用于个人五运六气的轻量参考，请写得通俗、克制。必须输出 JSON 对象，字段仅限 headline、constitutionSummary、personalRhythmSummary、seasonalSummary、exerciseSummary、sachetSummary、lifestyleTip。";

  try {
    let text = "";

    if (providerConfig.provider === "anthropic") {
      const client = new Anthropic({
        apiKey: providerConfig.apiKey,
        baseURL: providerConfig.baseURL,
        timeout,
        maxRetries: 0,
      });

      const response = await client.messages.create({
        model: providerConfig.model,
        max_tokens: 900,
        temperature: 0.35,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: userPrompt,
              },
            ],
          },
        ],
      });

      text = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
    } else {
      const client = new OpenAI({
        apiKey: providerConfig.apiKey,
        baseURL: providerConfig.baseURL,
        timeout,
        maxRetries: 0,
      });

      const completion = await client.chat.completions.create({
        model: providerConfig.model,
        temperature: 0.35,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: userPrompt,
          },
        ],
      });

      text = completion.choices[0]?.message?.content ?? "";
    }

    finishAiRequest(token, "success");
    return sanitizeNarrative(extractJsonObject(text));
  } catch (error) {
    finishAiRequest(token, isTimeoutError(error) ? "timeout" : "failed");
    recordRuntimeError("qwen", error);
    return null;
  }
}
