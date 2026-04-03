"use client";

import { useEffect, useState } from "react";

import styles from "./ops-dashboard.module.css";

import type { RuntimeMetricsSnapshot } from "@/lib/types";

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getTodayStats(metrics: RuntimeMetricsSnapshot | null) {
  return metrics?.daily[0] ?? null;
}

export function OpsDashboard() {
  const [metrics, setMetrics] = useState<RuntimeMetricsSnapshot | null>(null);
  const [error, setError] = useState("");
  const todayStats = getTodayStats(metrics);

  useEffect(() => {
    let isMounted = true;

    async function loadMetrics() {
      try {
        const response = await fetch("/api/admin/metrics", {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error("metrics_failed");
        }

        const payload = (await response.json()) as RuntimeMetricsSnapshot;

        if (isMounted) {
          setMetrics(payload);
          setError("");
        }
      } catch {
        if (isMounted) {
          setError("后台指标暂时读取失败。");
        }
      }
    }

    void loadMetrics();
    const timer = window.setInterval(() => {
      void loadMetrics();
    }, 3000);

    return () => {
      isMounted = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <main className={styles.page}>
      <section className={styles.shell}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>扁小鹊运维面板</p>
            <h1 className={styles.title}>运行指标</h1>
          </div>
          <p className={styles.note}>每 3 秒自动刷新一次，仅保留简要记录。</p>
        </header>

        {error ? <div className={styles.errorBanner}>{error}</div> : null}

        <section className={styles.grid}>
          <article className={styles.card}>
            <span className={styles.label}>今日访问量</span>
            <strong className={styles.metric}>{todayStats?.visits ?? 0}</strong>
            <p className={styles.helper}>按页面打开次数累计，不记录身份信息</p>
          </article>

          <article className={styles.card}>
            <span className={styles.label}>今日生成报告</span>
            <strong className={styles.metric}>{todayStats?.results ?? 0}</strong>
            <p className={styles.helper}>今日成功落到结果页的次数</p>
          </article>

          <article className={styles.card}>
            <span className={styles.label}>当前并发</span>
            <strong className={styles.metric}>{metrics?.requests.inFlight ?? 0}</strong>
            <p className={styles.helper}>当前正在处理的接口请求</p>
          </article>

          <article className={styles.card}>
            <span className={styles.label}>问答请求总数</span>
            <strong className={styles.metric}>{metrics?.requests.total ?? 0}</strong>
            <p className={styles.helper}>
              追问 {metrics?.requests.questionTurns ?? 0} 次，结果 {metrics?.requests.resultTurns ?? 0} 次
            </p>
          </article>

          <article className={styles.card}>
            <span className={styles.label}>接口延迟</span>
            <strong className={styles.metric}>{metrics?.requests.avgLatencyMs ?? 0} ms</strong>
            <p className={styles.helper}>最近一次 {metrics?.requests.lastLatencyMs ?? 0} ms</p>
          </article>

          <article className={styles.card}>
            <span className={styles.label}>AI 并发 / 跳过</span>
            <strong className={styles.metric}>
              {(metrics?.ai.inFlight ?? 0)} / {(metrics?.ai.skipped ?? 0)}
            </strong>
            <p className={styles.helper}>高峰时会直接退回规则文案，避免阻塞</p>
          </article>

          <article className={styles.card}>
            <span className={styles.label}>AI 延迟</span>
            <strong className={styles.metric}>{metrics?.ai.avgLatencyMs ?? 0} ms</strong>
            <p className={styles.helper}>最近一次 {metrics?.ai.lastLatencyMs ?? 0} ms</p>
          </article>

          <article className={styles.card}>
            <span className={styles.label}>异常计数</span>
            <strong className={styles.metric}>
              {(metrics?.requests.failed ?? 0) + (metrics?.ai.failed ?? 0) + (metrics?.ai.timedOut ?? 0)}
            </strong>
            <p className={styles.helper}>
              接口失败 {metrics?.requests.failed ?? 0}，AI 失败 {metrics?.ai.failed ?? 0}，超时 {metrics?.ai.timedOut ?? 0}
            </p>
          </article>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2>分日期统计</h2>
            <span>访问量、请求量、结果量与错误量</span>
          </div>

          <div className={styles.table}>
            <div className={styles.tableHeadDaily}>
              <span>日期</span>
              <span>访问量</span>
              <span>请求量</span>
              <span>结果量</span>
              <span>错误量</span>
            </div>

            {metrics?.daily.length ? (
              metrics.daily.map((entry) => (
                <div key={entry.date} className={styles.tableRowDaily}>
                  <span>{entry.date}</span>
                  <span>{entry.visits}</span>
                  <span>{entry.requests}</span>
                  <span>{entry.results}</span>
                  <span>{entry.errors}</span>
                </div>
              ))
            ) : (
              <div className={styles.empty}>暂时还没有日期统计。</div>
            )}
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2>最近填写记录</h2>
            <span>运行 {metrics?.uptimeSeconds ?? 0} 秒</span>
          </div>

          <div className={styles.table}>
            <div className={styles.tableHead}>
              <span>时间</span>
              <span>阶段</span>
              <span>已答</span>
              <span>耗时</span>
            </div>

            {metrics?.records.length ? (
              metrics.records.map((record) => (
                <div key={record.id} className={styles.tableRow}>
                  <span>{formatTime(record.at)}</span>
                  <span>{record.stage}</span>
                  <span>{record.answered}</span>
                  <span>{record.latencyMs} ms</span>
                </div>
              ))
            ) : (
              <div className={styles.empty}>暂时还没有记录。</div>
            )}
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2>错误日志</h2>
            <span>仅保留最近错误</span>
          </div>

          <div className={styles.errorList}>
            {metrics?.errors.length ? (
              metrics.errors.map((entry) => (
                <div key={entry.id} className={styles.errorItem}>
                  <strong>
                    {entry.source} · {formatTime(entry.at)}
                  </strong>
                  <p>{entry.message}</p>
                </div>
              ))
            ) : (
              <div className={styles.empty}>当前没有错误日志。</div>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
