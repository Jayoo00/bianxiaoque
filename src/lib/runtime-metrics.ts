import type {
  DailyRuntimeStat,
  RuntimeErrorEntry,
  RuntimeMetricsSnapshot,
  RuntimeRecord,
} from "@/lib/types";

type RequestStage = RuntimeRecord["stage"];
type ErrorSource = RuntimeErrorEntry["source"];
type AiOutcome = "success" | "failed" | "timeout";

type RequestToken = {
  id: string;
  startedAt: number;
};

type AiToken = {
  startedAt: number;
};

type RuntimeStore = {
  startedAt: number;
  requests: {
    total: number;
    inFlight: number;
    questionTurns: number;
    resultTurns: number;
    failed: number;
    lastLatencyMs: number;
    latencies: number[];
  };
  ai: {
    total: number;
    inFlight: number;
    success: number;
    failed: number;
    timedOut: number;
    skipped: number;
    lastLatencyMs: number;
    latencies: number[];
  };
  records: RuntimeRecord[];
  errors: RuntimeErrorEntry[];
  daily: Record<string, DailyRuntimeStat>;
};

const MAX_HISTORY = 80;
const MAX_LATENCIES = 200;

declare global {
  var __BXQ_RUNTIME_METRICS__: RuntimeStore | undefined;
}

function createStore(): RuntimeStore {
  return {
    startedAt: Date.now(),
    requests: {
      total: 0,
      inFlight: 0,
      questionTurns: 0,
      resultTurns: 0,
      failed: 0,
      lastLatencyMs: 0,
      latencies: [],
    },
    ai: {
      total: 0,
      inFlight: 0,
      success: 0,
      failed: 0,
      timedOut: 0,
      skipped: 0,
      lastLatencyMs: 0,
      latencies: [],
    },
    records: [],
    errors: [],
    daily: {},
  };
}

function getStore() {
  if (!globalThis.__BXQ_RUNTIME_METRICS__) {
    globalThis.__BXQ_RUNTIME_METRICS__ = createStore();
  }

  return globalThis.__BXQ_RUNTIME_METRICS__;
}

function pushLimited<T>(list: T[], item: T, limit = MAX_HISTORY) {
  list.unshift(item);

  if (list.length > limit) {
    list.length = limit;
  }
}

function pushLatency(list: number[], value: number) {
  list.push(value);

  if (list.length > MAX_LATENCIES) {
    list.shift();
  }
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function summarizeError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "unknown_error";
}

const DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function getDateKey(date = new Date()) {
  const parts = DATE_FORMATTER.formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.year}-${values.month}-${values.day}`;
}

function getDailyEntry(store: RuntimeStore, dateKey = getDateKey()) {
  if (!store.daily[dateKey]) {
    store.daily[dateKey] = {
      date: dateKey,
      visits: 0,
      requests: 0,
      results: 0,
      errors: 0,
      aiCalls: 0,
    };
  }

  return store.daily[dateKey];
}

export function recordVisit() {
  const store = getStore();

  getDailyEntry(store).visits += 1;
}

export function beginAssessmentRequest(): RequestToken {
  const store = getStore();

  store.requests.total += 1;
  store.requests.inFlight += 1;
  getDailyEntry(store).requests += 1;

  return {
    id: crypto.randomUUID(),
    startedAt: Date.now(),
  };
}

export function finishAssessmentRequest(
  token: RequestToken,
  payload: {
    stage: RequestStage;
    answered: number;
  },
) {
  const store = getStore();
  const latencyMs = Math.max(1, Date.now() - token.startedAt);

  store.requests.inFlight = Math.max(0, store.requests.inFlight - 1);
  store.requests.lastLatencyMs = latencyMs;
  pushLatency(store.requests.latencies, latencyMs);

  if (payload.stage === "question") {
    store.requests.questionTurns += 1;
  } else if (payload.stage === "result") {
    store.requests.resultTurns += 1;
    getDailyEntry(store).results += 1;
  } else {
    store.requests.failed += 1;
  }

  pushLimited(store.records, {
    id: token.id,
    at: new Date().toISOString(),
    stage: payload.stage,
    answered: payload.answered,
    latencyMs,
  });
}

export function recordRuntimeError(source: ErrorSource, error: unknown) {
  const store = getStore();
  getDailyEntry(store).errors += 1;

  pushLimited(store.errors, {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    source,
    message: summarizeError(error),
  });
}

export function beginAiRequest() {
  const store = getStore();

  store.ai.total += 1;
  store.ai.inFlight += 1;
  getDailyEntry(store).aiCalls += 1;

  return {
    startedAt: Date.now(),
  } satisfies AiToken;
}

export function getCurrentAiInFlight() {
  return getStore().ai.inFlight;
}

export function finishAiRequest(token: AiToken, outcome: AiOutcome) {
  const store = getStore();
  const latencyMs = Math.max(1, Date.now() - token.startedAt);

  store.ai.inFlight = Math.max(0, store.ai.inFlight - 1);
  store.ai.lastLatencyMs = latencyMs;
  pushLatency(store.ai.latencies, latencyMs);

  if (outcome === "success") {
    store.ai.success += 1;
  } else if (outcome === "timeout") {
    store.ai.timedOut += 1;
  } else {
    store.ai.failed += 1;
  }
}

export function recordAiSkipped() {
  const store = getStore();

  store.ai.total += 1;
  store.ai.skipped += 1;
}

export function getRuntimeMetricsSnapshot(): RuntimeMetricsSnapshot {
  const store = getStore();

  return {
    uptimeSeconds: Math.round((Date.now() - store.startedAt) / 1000),
    requests: {
      total: store.requests.total,
      inFlight: store.requests.inFlight,
      questionTurns: store.requests.questionTurns,
      resultTurns: store.requests.resultTurns,
      failed: store.requests.failed,
      avgLatencyMs: average(store.requests.latencies),
      lastLatencyMs: store.requests.lastLatencyMs,
    },
    ai: {
      total: store.ai.total,
      inFlight: store.ai.inFlight,
      success: store.ai.success,
      failed: store.ai.failed,
      timedOut: store.ai.timedOut,
      skipped: store.ai.skipped,
      avgLatencyMs: average(store.ai.latencies),
      lastLatencyMs: store.ai.lastLatencyMs,
    },
    records: store.records,
    errors: store.errors,
    daily: Object.values(store.daily).sort((left, right) => right.date.localeCompare(left.date)),
  };
}
