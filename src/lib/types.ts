export type ConstitutionId =
  | "balanced"
  | "qiDeficiency"
  | "yangDeficiency"
  | "yinDeficiency"
  | "phlegmDamp"
  | "dampHeat"
  | "bloodStasis"
  | "qiStagnation"
  | "specialDiathesis";

export type AnswerValue = string | string[];
export type AnswerStore = Record<string, AnswerValue>;
export type QuestionType = "single" | "multi" | "date";

export type QuestionOption = {
  id: string;
  label: string;
  detail?: string;
};

export type QuestionPayload = {
  id: string;
  prompt: string;
  description?: string;
  type: QuestionType;
  options: QuestionOption[];
  maxSelections?: number;
  source?: string;
  minDate?: string;
  maxDate?: string;
};

export type ClimateWindow = {
  id: string;
  label: string;
  range: string;
  qi: string;
  summary: string;
  tags: string[];
};

export type SeasonalContext = {
  formattedDate: string;
  annualLabel: string;
  annualSummary: string;
  currentWindow: ClimateWindow;
  nextWindow: ClimateWindow;
  badge: string;
};

export type BirthTimingProfile = {
  birthDate: string;
  yearLabel: string;
  annualMovement: string;
  sitian: string;
  zaiquan: string;
  birthWindow: ClimateWindow;
  summary: string;
  tags: string[];
};

export type Recommendation = {
  id: string;
  name: string;
  reason: string;
};

export type NarrativeBlocks = {
  headline: string;
  constitutionSummary: string;
  personalRhythmSummary: string;
  seasonalSummary: string;
  exerciseSummary: string;
  sachetSummary: string;
  lifestyleTip: string;
};

export type ConstitutionSummary = {
  id: ConstitutionId;
  label: string;
  score: number;
  description: string;
  reasons: string[];
};

export type AssessmentResult = {
  profileTitle: string;
  summary: string;
  primary: ConstitutionSummary;
  secondary?: ConstitutionSummary;
  scores: Array<{ id: ConstitutionId; label: string; score: number }>;
  seasonalContext: SeasonalContext;
  birthTimingProfile?: BirthTimingProfile;
  baduanjin: Recommendation[];
  sachets: Recommendation[];
  habits: string[];
  disclaimer: string;
  sourceNote: string;
  narrative: NarrativeBlocks;
};

export type TurnResponse =
  | {
      stage: "question";
      assistantMessage: string;
      question: QuestionPayload;
      progress: {
        answered: number;
        total: number;
      };
      seasonalContext: SeasonalContext;
    }
  | {
      stage: "result";
      assistantMessage: string;
      result: AssessmentResult;
      progress: {
        answered: number;
        total: number;
      };
      seasonalContext: SeasonalContext;
    };

export type RuntimeRecord = {
  id: string;
  at: string;
  stage: "question" | "result" | "error";
  answered: number;
  latencyMs: number;
};

export type RuntimeErrorEntry = {
  id: string;
  at: string;
  source: "assessment" | "qwen";
  message: string;
};

export type DailyRuntimeStat = {
  date: string;
  visits: number;
  requests: number;
  results: number;
  errors: number;
  aiCalls: number;
};

export type RuntimeMetricsSnapshot = {
  uptimeSeconds: number;
  requests: {
    total: number;
    inFlight: number;
    questionTurns: number;
    resultTurns: number;
    failed: number;
    avgLatencyMs: number;
    lastLatencyMs: number;
  };
  ai: {
    inFlight: number;
    total: number;
    success: number;
    failed: number;
    timedOut: number;
    skipped: number;
    avgLatencyMs: number;
    lastLatencyMs: number;
  };
  records: RuntimeRecord[];
  errors: RuntimeErrorEntry[];
  daily: DailyRuntimeStat[];
};
