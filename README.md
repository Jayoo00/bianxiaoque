# 扁小鹊健康智能体

一个适合在微信里扫码打开的移动优先 H5。

它会通过性别、出生年月日和 9 个评估问题，完成一次健康管理型初筛，结合：

- 《GB/T 46939—2025 中医体质分类与判定》附录 A 的简化体质条目
- 用户出生日期对应的个人五运六气轻量参考
- 当前日期对应的年运与当前/下一阶段五运六气
- 用户的睡眠、压力、运动、饮食和通勤习惯
- 4 款香囊资料与八段锦动作映射
- 千问兼容接口生成更规范、简洁的结果文案
- 轻量运维面板用于观察访问量、生成量、错误日志和 AI 延迟

最终输出：

- 1 个主要体质倾向，必要时补 1 个兼夹倾向
- 1 段通俗的个人五运六气参考
- 2-3 个八段锦核心动作
- 1-2 款更适合当前状态的香囊
- 简洁、规范、可执行的调养提示

## 技术栈

- Next.js 16 App Router
- React 19
- 移动优先单页 H5 交互
- `/api/assessment` 服务端路由
- DashScope OpenAI 兼容接口接入千问 `qwen3.5-flash`
- `/ops` 轻量运维面板与运行指标采集

## 本地运行

1. 安装依赖

```bash
npm install
```

2. 配置环境变量

```bash
cp .env.example .env.local
```

填入：

- `DASHSCOPE_API_KEY`
- `DASHSCOPE_BASE_URL`
- `QWEN_MODEL`

3. 启动开发环境

```bash
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

## 生产构建

```bash
npm run lint
npm run build
npm run start
```

如果要使用 Next 的独立产物：

```bash
npm run build
npm run start:standalone
```

## PM2 部署

仓库内已附带 `ecosystem.config.cjs`：

```bash
pm2 start ecosystem.config.cjs
pm2 save
```

## Docker 部署

如果服务器没有合适的 Node 运行时，推荐直接容器化：

```bash
docker build -t bianxiaoque-h5:latest .
docker run -d \
  --name bianxiaoque-h5 \
  --restart unless-stopped \
  --env-file .env.production \
  -p 7509:3000 \
  bianxiaoque-h5:latest
```

## 目录说明

- `src/app/page.tsx`
- `src/components/health-agent.tsx`
- `src/components/ops-dashboard.tsx`
- `src/lib/assessment-engine.ts`
- `src/lib/seasonal-context.ts`
- `src/lib/qwen.ts`
- `src/lib/runtime-metrics.ts`
- `src/app/api/assessment/route.ts`
- `src/app/api/admin/metrics/route.ts`
- `src/app/ops/page.tsx`

## 说明

- 结果页属于健康管理型建议，不替代线下面诊和医疗诊断。
- 若未配置千问 API Key，系统会自动退回本地规则文案，不会影响主流程可用性。
