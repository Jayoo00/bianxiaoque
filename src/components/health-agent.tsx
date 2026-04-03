"use client";

import { Fragment, useEffect, useEffectEvent, useRef, useState } from "react";

import styles from "./health-agent.module.css";

import type {
  AssessmentResult,
  AnswerStore,
  QuestionPayload,
  SeasonalContext,
  TurnResponse,
} from "@/lib/types";

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
};

type DateDraft = {
  year: string;
  month: string;
  day: string;
};

const WELCOME_NOTICE =
  "接下来我会根据中医五运六气理论，结合《GB/T 46939—2025 中医体质分类与判定》，为您提供个人体质辨识与健康建议。我们不会采集存储您的隐私信息，请截图保存结果报告。";

function createMessage(role: ChatMessage["role"], text: string): ChatMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    text,
  };
}

function formatDateLabel(value: string) {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!matched) {
    return value;
  }

  return `${matched[1]}年${matched[2]}月${matched[3]}日`;
}

function parseDateParts(value: string | undefined): DateDraft {
  const matched = value ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;

  if (!matched) {
    return {
      year: "",
      month: "",
      day: "",
    };
  }

  return {
    year: matched[1],
    month: String(Number(matched[2])),
    day: String(Number(matched[3])),
  };
}

function getDayCount(year: string, month: string) {
  if (!year || !month) {
    return 31;
  }

  return new Date(Number(year), Number(month), 0).getDate();
}

function buildNumberOptions(start: number, end: number, descending = false) {
  const options: string[] = [];

  if (descending) {
    for (let value = end; value >= start; value -= 1) {
      options.push(String(value));
    }

    return options;
  }

  for (let value = start; value <= end; value += 1) {
    options.push(String(value));
  }

  return options;
}

function getAllowedMonths(year: string, minDate?: string, maxDate?: string) {
  if (!year) {
    return [];
  }

  const minParts = parseDateParts(minDate);
  const maxParts = parseDateParts(maxDate);
  const selectedYear = Number(year);
  const minMonth = minParts.year === year && minParts.month ? Number(minParts.month) : 1;
  const maxMonth = maxParts.year === year && maxParts.month ? Number(maxParts.month) : 12;

  return buildNumberOptions(minMonth, maxMonth).filter((value) => Number(value) <= 12 && selectedYear >= 0);
}

function getAllowedDays(year: string, month: string, minDate?: string, maxDate?: string) {
  if (!year || !month) {
    return [];
  }

  const minParts = parseDateParts(minDate);
  const maxParts = parseDateParts(maxDate);
  const monthDayCount = getDayCount(year, month);
  const minDay = minParts.year === year && minParts.month === month && minParts.day ? Number(minParts.day) : 1;
  const maxDay =
    maxParts.year === year && maxParts.month === month && maxParts.day ? Number(maxParts.day) : monthDayCount;

  return buildNumberOptions(minDay, Math.min(maxDay, monthDayCount));
}

function buildDateValue(draft: DateDraft) {
  if (!draft.year || !draft.month || !draft.day) {
    return "";
  }

  return `${draft.year}-${draft.month.padStart(2, "0")}-${draft.day.padStart(2, "0")}`;
}

function formatAnswerLabel(question: QuestionPayload, value: string | string[]) {
  if (question.type === "date" && typeof value === "string") {
    return formatDateLabel(value);
  }

  const selectedIds = Array.isArray(value) ? value : [value];
  const labels = question.options
    .filter((option) => selectedIds.includes(option.id))
    .map((option) => option.label);

  return labels.join("、");
}

export function HealthAgent() {
  const [messages, setMessages] = useState<ChatMessage[]>(() => [createMessage("assistant", WELCOME_NOTICE)]);
  const [answers, setAnswers] = useState<AnswerStore>({});
  const [question, setQuestion] = useState<QuestionPayload | null>(null);
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [seasonalContext, setSeasonalContext] = useState<SeasonalContext | null>(null);
  const [progress, setProgress] = useState({ answered: 0, total: 9 });
  const [draftSelections, setDraftSelections] = useState<string[]>([]);
  const [draftDate, setDraftDate] = useState<DateDraft>({
    year: "",
    month: "",
    day: "",
  });
  const [isFetching, setIsFetching] = useState(false);
  const [pendingLabel, setPendingLabel] = useState("正在准备问答…");

  const transcriptTailRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const reportRef = useRef<HTMLElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  const scrollIntoView = useEffectEvent((target: HTMLElement | null, behavior: ScrollBehavior = "smooth") => {
    if (!target) {
      return;
    }

    window.requestAnimationFrame(() => {
      target.scrollIntoView({
        behavior,
        block: "end",
      });
    });
  });

  useEffect(() => {
    void fetch("/api/admin/visit", {
      method: "POST",
      cache: "no-store",
      keepalive: true,
    }).catch(() => undefined);

    void fetchTurn({}, "正在准备问答…");

    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    setDraftSelections([]);
    const draftValue = question ? answers[question.id] : undefined;
    const storedDate = question?.type === "date" && typeof draftValue === "string" ? parseDateParts(draftValue) : parseDateParts(undefined);
    setDraftDate(storedDate);
  }, [answers, question]);

  useEffect(() => {
    if (!isFetching) {
      return;
    }

    scrollIntoView(transcriptTailRef.current, messages.length > 2 ? "smooth" : "auto");
  }, [isFetching, messages.length, scrollIntoView]);

  useEffect(() => {
    if (!question || !composerRef.current) {
      return;
    }

    scrollIntoView(composerRef.current, messages.length > 2 ? "smooth" : "auto");
  }, [messages.length, question?.id, scrollIntoView]);

  useEffect(() => {
    if (!result || !reportRef.current) {
      return;
    }

    window.requestAnimationFrame(() => {
      reportRef.current?.scrollIntoView({
        behavior: messages.length > 2 ? "smooth" : "auto",
        block: "start",
      });
    });
  }, [messages.length, result]);

  async function fetchTurn(nextAnswers: AnswerStore, nextPendingLabel: string) {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    abortRef.current?.abort();

    const controller = new AbortController();
    abortRef.current = controller;
    setIsFetching(true);
    setPendingLabel(nextPendingLabel);

    try {
      const response = await fetch("/api/assessment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ answers: nextAnswers }),
        cache: "no-store",
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error("request_failed");
      }

      const payload = (await response.json()) as TurnResponse;

      if (requestId !== requestIdRef.current) {
        return;
      }

      setSeasonalContext(payload.seasonalContext);
      setProgress(payload.progress);

      if (payload.stage === "question") {
        setQuestion(payload.question);
        setResult(null);
      } else {
        setQuestion(null);
        setResult(payload.result);
      }
    } catch {
      if (controller.signal.aborted || requestId !== requestIdRef.current) {
        return;
      }

      setMessages((current) => [
        ...current,
        createMessage("assistant", "服务暂时有点忙，请稍后再试一次。"),
      ]);
    } finally {
      if (requestId === requestIdRef.current) {
        setIsFetching(false);
      }
    }
  }

  function submitAnswer(value: string | string[]) {
    if (!question || isFetching) {
      return;
    }

    const currentQuestion = question;
    const isReportStep = progress.answered + 1 >= progress.total;
    const nextAnswers: AnswerStore = {
      ...answers,
      [currentQuestion.id]: value,
    };

    setAnswers(nextAnswers);
    setQuestion(null);
    setDraftSelections([]);
    setDraftDate(parseDateParts(undefined));
    setMessages((current) => [
      ...current,
      createMessage("assistant", currentQuestion.prompt),
      createMessage("user", formatAnswerLabel(currentQuestion, value)),
    ]);
    void fetchTurn(nextAnswers, isReportStep ? "正在智能分析您的报告" : "正在整理下一题…");
  }

  function toggleDraftSelection(optionId: string) {
    if (!question || question.type !== "multi" || isFetching) {
      return;
    }

    setDraftSelections((current) => {
      if (current.includes(optionId)) {
        return current.filter((item) => item !== optionId);
      }

      const maxSelections = question.maxSelections ?? question.options.length;

      if (current.length >= maxSelections) {
        return current;
      }

      return [...current, optionId];
    });
  }

  function restart() {
    abortRef.current?.abort();

    setMessages([createMessage("assistant", WELCOME_NOTICE)]);
    setAnswers({});
    setQuestion(null);
    setResult(null);
    setSeasonalContext(null);
    setProgress({ answered: 0, total: 9 });
    setDraftSelections([]);
    setDraftDate(parseDateParts(undefined));
    setPendingLabel("正在准备问答…");

    void fetchTurn({}, "正在准备问答…");
  }

  const progressRatio = result ? 1 : progress.total === 0 ? 0 : progress.answered / progress.total;
  const topScores = result?.scores.slice(0, 3) ?? [];
  const yearOptions = question?.type === "date" ? buildNumberOptions(Number(question.minDate?.slice(0, 4) ?? "1900"), Number(question.maxDate?.slice(0, 4) ?? new Date().getFullYear()), true) : [];
  const monthOptions = question?.type === "date" ? getAllowedMonths(draftDate.year, question.minDate, question.maxDate) : [];
  const dayOptions = question?.type === "date" ? getAllowedDays(draftDate.year, draftDate.month, question.minDate, question.maxDate) : [];
  const birthDateValue = buildDateValue(draftDate);

  return (
    <main className={styles.page}>
      <div className={styles.glowOne} />
      <div className={styles.glowTwo} />

      <section className={styles.shell}>
        <header className={styles.header}>
          <div className={styles.brandWrap}>
            <h1 className={styles.brand}>
              扁小鹊<sup className={styles.mark}>®</sup>健康智能体
            </h1>
            <span className={styles.badge}>
              <span className={styles.badgeLabel}>五运六气</span>
              <strong>{seasonalContext?.badge ?? "载入中"}</strong>
            </span>
          </div>
        </header>

        <section className={styles.chatFrame}>
          <div className={styles.progressRow}>
            <div className={styles.progressText}>
              <span>{result ? "报告已生成" : "评估进度"}</span>
              <strong>
                {result ? "已完成" : `${Math.min(progress.answered, progress.total)}/${progress.total}`}
              </strong>
            </div>
            <div className={styles.progressBar}>
              <span className={styles.progressValue} style={{ width: `${progressRatio * 100}%` }} />
            </div>
          </div>

          <div className={styles.transcript}>
            {messages.map((message, index) => (
              <Fragment key={message.id}>
                <div className={message.role === "assistant" ? styles.assistantBubble : styles.userBubble}>
                  {message.text}
                </div>
                {index === 0 && seasonalContext ? (
                  <div className={styles.contextStrip}>
                    <span>{seasonalContext.formattedDate}</span>
                    <span>{seasonalContext.annualLabel}</span>
                  </div>
                ) : null}
              </Fragment>
            ))}

            {isFetching ? <div className={styles.pendingBubble}>{pendingLabel}</div> : null}
            <div ref={transcriptTailRef} className={styles.transcriptTail} />
          </div>

          {question ? (
            <div ref={composerRef} className={styles.composer}>
              <div className={styles.questionMeta}>
                <span className={styles.questionTag}>当前问题</span>
                {question.source ? <span className={styles.questionSource}>{question.source}</span> : null}
              </div>

              <h2 className={styles.questionTitle}>{question.prompt}</h2>
              {question.description ? <p className={styles.questionDescription}>{question.description}</p> : null}

              {question.type === "date" ? (
                <div className={styles.dateComposer}>
                  <p className={styles.dateHint}>请依次选择年、月、日</p>
                  <div className={styles.datePickerGrid}>
                    <label className={styles.dateField}>
                      <span>年份</span>
                      <select
                        className={styles.dateSelect}
                        value={draftDate.year}
                        disabled={isFetching}
                        onChange={(event) =>
                          setDraftDate({
                            year: event.target.value,
                            month: "",
                            day: "",
                          })
                        }
                      >
                        <option value="">请选择</option>
                        {yearOptions.map((year) => (
                          <option key={year} value={year}>
                            {year}年
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className={styles.dateField}>
                      <span>月份</span>
                      <select
                        className={styles.dateSelect}
                        value={draftDate.month}
                        disabled={isFetching || !draftDate.year}
                        onChange={(event) =>
                          setDraftDate((current) => ({
                            ...current,
                            month: event.target.value,
                            day: "",
                          }))
                        }
                      >
                        <option value="">请选择</option>
                        {monthOptions.map((month) => (
                          <option key={month} value={month}>
                            {month}月
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className={styles.dateField}>
                      <span>日期</span>
                      <select
                        className={styles.dateSelect}
                        value={draftDate.day}
                        disabled={isFetching || !draftDate.year || !draftDate.month}
                        onChange={(event) =>
                          setDraftDate((current) => ({
                            ...current,
                            day: event.target.value,
                          }))
                        }
                      >
                        <option value="">请选择</option>
                        {dayOptions.map((day) => (
                          <option key={day} value={day}>
                            {day}日
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <button
                    type="button"
                    className={styles.submitButton}
                    disabled={isFetching || !birthDateValue}
                    onClick={() => submitAnswer(birthDateValue)}
                  >
                    继续
                  </button>
                </div>
              ) : (
                <div className={styles.optionList}>
                  {question.options.map((option) => {
                    const isSelected = draftSelections.includes(option.id);

                    return (
                      <button
                        key={option.id}
                        type="button"
                        className={isSelected ? styles.optionSelected : styles.optionButton}
                        disabled={isFetching}
                        onClick={() => {
                          if (question.type === "single") {
                            submitAnswer(option.id);
                            return;
                          }

                          toggleDraftSelection(option.id);
                        }}
                      >
                        <span>{option.label}</span>
                        {option.detail ? <small>{option.detail}</small> : null}
                      </button>
                    );
                  })}
                </div>
              )}

              {question.type === "multi" ? (
                <div className={styles.multiFooter}>
                  <span>
                    已选 {draftSelections.length}/{question.maxSelections ?? question.options.length}
                  </span>
                  <button
                    type="button"
                    className={styles.submitButton}
                    disabled={isFetching || draftSelections.length === 0}
                    onClick={() => submitAnswer(draftSelections)}
                  >
                    继续
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        {result ? (
          <article ref={reportRef} className={styles.reportCard}>
            <div className={styles.resultHeader}>
              <div>
                <span className={styles.resultEyebrow}>评估结果</span>
                <h2 className={styles.resultTitle}>{result.narrative.headline}</h2>
              </div>
              <button type="button" className={styles.restartButton} onClick={restart}>
                重新评估
              </button>
            </div>

            <div className={styles.chips}>
              <span className={styles.chip}>{result.primary.label}</span>
              {result.secondary ? <span className={styles.chip}>{result.secondary.label}</span> : null}
              <span className={styles.chipSoft}>{result.seasonalContext.currentWindow.label}</span>
              <span className={styles.chipSoft}>{result.seasonalContext.nextWindow.label}</span>
            </div>

            <p className={styles.lead}>{result.narrative.constitutionSummary}</p>
            {result.birthTimingProfile ? (
              <section className={styles.section}>
                <h3>个人五运六气参考</h3>
                <p className={styles.paragraph}>{result.narrative.personalRhythmSummary}</p>
              </section>
            ) : null}
            <p className={styles.paragraph}>{result.narrative.seasonalSummary}</p>

            {topScores.length > 0 ? (
              <div className={styles.scoreBlock}>
                {topScores.map((item) => (
                  <div key={item.id} className={styles.scoreRow}>
                    <span>{item.label}</span>
                    <div className={styles.scoreBar}>
                      <span className={styles.scoreFill} style={{ width: `${item.score}%` }} />
                    </div>
                    <strong>{item.score}</strong>
                  </div>
                ))}
              </div>
            ) : null}

            <section className={styles.section}>
              <h3>八段锦核心动作推荐</h3>
              <p className={styles.paragraph}>{result.narrative.exerciseSummary}</p>
              <div className={styles.recommendationList}>
                {result.baduanjin.map((item) => (
                  <div key={item.id} className={styles.recommendationCard}>
                    <strong>{item.name}</strong>
                    <p>{item.reason}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className={styles.section}>
              <h3>“神气”本草香囊推荐</h3>
              <p className={styles.paragraph}>{result.narrative.sachetSummary}</p>
              <div className={styles.recommendationList}>
                {result.sachets.map((item) => (
                  <div key={item.id} className={styles.recommendationCard}>
                    <strong>{item.name}</strong>
                    <p>{item.reason}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className={styles.section}>
              <h3>最近先抓这一件事</h3>
              <p className={styles.tip}>{result.narrative.lifestyleTip}</p>
            </section>

            <footer className={styles.resultFooter}>
              <p className={styles.captureNotice}>请截图保存您的报告，我们不会采集存储您的隐私信息。</p>
              <p>{result.disclaimer}</p>
              <p>{result.sourceNote}</p>
            </footer>
          </article>
        ) : null}
      </section>
    </main>
  );
}
