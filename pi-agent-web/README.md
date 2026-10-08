# pi-agent-web · Pi Agent 浏览器界面

模仿 [pi-web](https://github.com/agegr/pi-web) 的浏览器前端，连接 **pi-agent-server**（本仓库 `../pi-agent-server`，默认 `http://127.0.0.1:8787`）使用。前端**不依赖 Pi SDK**，只消费服务端的 REST + 每 prompt 一条的 SSE 流；Vite + React 19 + TypeScript + Tailwind v4，单页应用，无外部状态库。

## 功能特性

### 会话管理

- 侧栏会话列表：消息数、更新时间、运行态，支持搜索、新建、删除、重命名、切换
- 会话落盘在服务端（JSONL），刷新页面/重启服务后历史仍在

### 对话与消息渲染

- **流式渲染**：SSE 增量拼接文本与思考过程（思考折叠展示），运行结束后以服务端历史为准回填
- **Markdown（GFM）**、代码高亮（highlight.js）、**KaTeX 数学公式**、**Mermaid 图表**（动态加载、跟随主题切换重绘）
- **工具调用卡片**：日志行样式（状态节点 + 工具名 + 一行摘要，工作区前缀自动省略），同轮多个调用以 run rail 串起真实执行顺序；参数与结果可折叠
- 运行控制：`停止`（abort）、`压缩`（compact）

### 模型与上下文

- 模型下拉切换、模型选择器循环切换（等价 pi 的 Ctrl+P）、思考等级切换（按模型支持过滤）
- 顶栏统计：token 输入/输出、成本、上下文占用

### 供应商配置

- 可视化增删改 `config/providers.json`：Base URL、API 类型、API Key 掩码、模型列表、兼容开关；保存后服务端热重载即时生效
- 内置常见中转站预设（`providerPresets.ts`），Key 只由服务端读写，前端仅显示 `hasApiKey` / `apiKeyMasked`

### 技能与知识库

- **技能面板**：列出 Pi 发现的技能，一键切换 `disable-model-invocation`（服务端会热重载空闲会话）
- **知识库面板**：RAG 服务状态轮询（starting/online）、知识库 CRUD、文档上传/删除、摄取任务进度、刷新；`RagConfigSection` 可直接编辑 RAG 服务参数
- 输入框旁知识库开关（持久化）：发送时附带 `knowledgeBaseId`，服务端检索并注入上下文；助手回答下方出现“点击获取知识库搜索结果”按钮，弹窗展示每条命中的索引路径（`[文档/标题 1/标题 2/...]`）、页码、分值与原文

### 输入与交互

- `@` 文件提及（工作区文件模糊搜索）、`/` 技能提及，支持多行输入（Enter 发送，Shift+Enter 换行）
- **自动命名**：首轮对话时调用服务端一次性接口生成会话标题（可关闭或自定义提示词）
- 浅色/深色主题（无闪烁切换）、中英双语、移动端侧栏

## 技术栈

| 层          | 技术                                                                 | 版本        |
| ----------- | -------------------------------------------------------------------- | ----------- |
| 框架        | React + TypeScript                                                   | 19.2 / 5.9  |
| 构建        | Vite（`@vitejs/plugin-react`），dev 代理 `/api` → `:8787`            | ^6.3        |
| 样式        | Tailwind CSS v4（`@tailwindcss/vite`，CSS-first `@theme` 设计令牌）  | ^4.1        |
| Markdown    | react-markdown + remark-gfm + remark-math + rehype-highlight + rehype-katex | 10.x / 4.x / 6.x |
| 代码/公式/图表 | highlight.js · KaTeX · Mermaid（动态 import）                     | 11.x / 0.16 / 11.x |
| 状态        | React Context（`src/state/agent.tsx`），无外部状态库                 | —           |
| 字体        | Instrument Sans（界面/正文）+ IBM Plex Mono（机器文本），Google Fonts + 系统回退 | — |
| 工具        | clsx                                                                 | ^2.1        |

## 目录结构

```
pi-agent-web/
├── index.html                  # 主题/语言早期初始化（防闪烁）、字体、标题
├── vite.config.ts              # dev 代理 /api → 8787（PI_AGENT_SERVER_URL 可覆盖）
├── src/
│   ├── main.tsx / App.tsx      # 入口与页面组装
│   ├── components/
│   │   ├── AppShell.tsx        # 布局 + 弹窗状态 + 移动端侧栏
│   │   ├── Sidebar.tsx         # 会话列表/搜索/新建/删除/重命名 + 供应商/技能入口
│   │   ├── TopBar.tsx          # 标题/重命名、统计、主题、设置
│   │   ├── ChatWindow.tsx      # 滚动区、错误条、流式工具卡片
│   │   ├── MessageView.tsx     # 用户气泡 / 助手块（文本/思考/工具调用）
│   │   ├── MarkdownBody.tsx    # react-markdown + GFM + KaTeX + 高亮 + Mermaid
│   │   ├── MermaidBlock.tsx    # Mermaid 动态渲染（主题联动）
│   │   ├── ToolCallCard.tsx    # 工具日志行（状态节点 + 摘要，可展开参数/结果）
│   │   ├── ChatInput.tsx       # 输入框 + @ 文件 + / 技能 + 模型/思考/KB 选择器
│   │   ├── ProvidersPanel.tsx  # providers.json 可视化编辑
│   │   ├── SkillsPanel.tsx     # 技能列表 + disable-model-invocation 开关
│   │   ├── KnowledgePanel.tsx  # 知识库管理（服务状态/CRUD/文档/摄取）
│   │   ├── RagConfigSection.tsx# RAG 服务参数编辑
│   │   ├── KbResultsModal.tsx  # 知识库命中结果弹窗
│   │   ├── SettingsPanel.tsx   # 自动命名、命名提示词、语言、主题
│   │   └── Modal.tsx / ConfirmDialog.tsx / ConfirmPopover.tsx / icons.tsx
│   ├── state/agent.tsx         # 全局状态：会话/消息/流式/模型/统计/动作
│   ├── lib/                    # api sse types normalize format settings
│   │                           # fileFuzzy providerPresets thinking
│   ├── i18n/                   # index.tsx zh-CN.ts en.ts
│   ├── hooks/useTheme.ts
│   └── styles/theme.css        # 设计令牌（浅/深）+ Markdown/KaTeX/Mermaid/代码样式
├── dist/                       # 构建产物（npm run build）
├── package.json / tsconfig.json
├── AGENTS.md                   # 开发约定（给 AI 协作者）
└── README.md                   # 本文件
```

## 环境准备

| 软件             | 要求          | 说明                                                         |
| ---------------- | ------------- | ------------------------------------------------------------ |
| Node.js          | 22+           | 开发环境 23.11                                               |
| pi-agent-server  | 已启动 :8787  | `cd ../pi-agent-server && npm start`；否则前端无数据可展示    |
| 浏览器           | 现代浏览器    | 需要 `fetch` + `ReadableStream`（用于解析 SSE）              |

## 快速开始

### 开发

```bash
cd pi-agent-web
npm install        # 仅首次
npm run dev        # http://127.0.0.1:5173
```

Vite 开发服务器将 `/api` 代理到 `http://127.0.0.1:8787`（SSE 响应禁用缓冲，增量即时到达），可用环境变量 `PI_AGENT_SERVER_URL` 覆盖代理目标：

```powershell
$env:PI_AGENT_SERVER_URL = "http://127.0.0.1:9000"; npm run dev
```

### 校验与构建

```bash
npm run typecheck  # tsc --noEmit
npm run build      # tsc --noEmit && vite build → dist/
npm run preview    # 本地预览构建产物
```

### 前后端不同源时

生产构建若不走同源代理，用 `VITE_API_BASE` 指定 API 源前缀（服务端已开启 `Access-Control-Allow-Origin: *`，可直接跨域）：

```bash
VITE_API_BASE=http://127.0.0.1:8787 npm run build
```

## 与 pi-agent-server 的对接

| 前端动作                     | 服务端端点                                                        |
| ---------------------------- | ----------------------------------------------------------------- |
| 会话列表/新建/删除           | `GET/POST /api/sessions`、`DELETE /api/sessions/:id`              |
| 会话详情/历史消息            | `GET /api/sessions/:id`、`GET /api/sessions/:id/messages`         |
| 统计                         | `GET /api/sessions/:id/stats`                                     |
| 发送消息（SSE）              | `POST /api/sessions/:id/prompt`                                   |
| 切换模型 / 思考等级          | `POST /api/sessions/:id/model`、`/thinking`                       |
| 压缩 / 停止                  | `POST /api/sessions/:id/compact`、`/abort`                        |
| 重命名                       | `POST /api/sessions/:id/rename`                                   |
| 一次性命名对话               | `POST /api/chat`                                                  |
| 供应商                       | `GET /api/providers`、`PUT/PATCH/DELETE /api/providers/:id`       |
| 模型列表                     | `GET /api/models`                                                 |
| 工作区文件索引（@ 提及）     | `GET /api/files`                                                  |
| 技能列表 / 开关              | `GET /api/skills`、`PATCH /api/skills`                            |
| 知识库（RAG）                | `GET/POST /api/kb`、`/api/kb/:id/*`、`/api/kb/query`、`/api/kb/service/start`、`/api/kb/config` |

> 注意：服务端的 prompt SSE 是「一次请求一条流」，客户端断开会导致该 run 被中止，因此本前端用 `fetch` + `ReadableStream` 手动解析，而不使用 `EventSource`（它也无法发送 POST）。

## 配置项

### 环境变量

| 变量                   | 作用范围     | 说明                                              |
| ---------------------- | ------------ | ------------------------------------------------- |
| `PI_AGENT_SERVER_URL`  | 仅 dev 代理  | Vite 代理目标，默认 `http://127.0.0.1:8787`       |
| `VITE_API_BASE`        | 构建/运行    | API 源前缀，默认空（同源）；服务端做 CORS         |

### 浏览器本地存储

| Key                     | 内容                                                             |
| ----------------------- | ---------------------------------------------------------------- |
| `pi-agent-web:settings` | `{autoRename, namingPrompt, kbEnabled, kbId}`（设置面板）        |
| `pi-agent-web:theme`    | `light` / `dark`                                                 |
| `pi-agent-web:lang`     | `zh-CN` / `en`                                                   |

### 代码内关键配置

- `src/lib/settings.ts`：默认设置与 `DEFAULT_NAMING_PROMPT`（自动命名提示词）
- `src/lib/providerPresets.ts`：供应商预设（Base URL / API 类型 / 模型模板）
- `vite.config.ts`：dev 端口 `5173`、`/api` 代理与 `cache-control: no-store`（保证 SSE 不被缓冲）

## 设计说明（实现要点）

- **SSE 是逐 prompt 的**：`POST /prompt` 在响应体上流式返回事件；因此用 `fetch` + `body.getReader()` 解析（`lib/sse.ts`），仅在用户点击停止时 abort，run 进行中不要卸载组件；单调递增的 run id 防止上一轮迟到事件串台。
- **流式装配**：`message_start` 创建占位消息，`message_update` 追加 `text_delta` / `thinking_delta`，`message_end.message` 为权威消息并替换占位；`tool_execution_start/update/end` 驱动临时工具卡片；流结束后 `reloadMessages()` 整体回填服务端历史。
- **工具调用字段归一化**：Pi 存 `{type:"toolCall", id, name, arguments}`，UI 用 `{toolCallId, toolName, input}`，由 `lib/normalize.ts` 在历史加载与流式处理中统一转换。
- **自动命名**：首轮用户消息时并行调用 `/api/chat`（用户文本 + 命名提示词），清洗回复后调用 `/rename`；失败不影响主对话。
- **主题令牌**：设计令牌在 `src/styles/theme.css` 的 `@theme` 中（`bg-panel` / `text-muted` / `border-border` / `bg-btn-accent` 等）；`[data-theme]` 切换浅/深色，`index.html` 内联脚本提前恢复避免闪烁。浅色为“冷纸 + 赭石”、深色为“暖石墨 + 荧光琥珀”的 Run Ledger 视觉。
- **Mermaid / KaTeX 陷阱**：Mermaid 动态 import 且把块内 div 作为渲染容器（避免临时测量 DOM 挂到 `<body>`）；渲染后强制自然尺寸、容器横向滚动；`prefers-reduced-motion` 下不能对 Mermaid 后代施加全局 `transition-duration: 0.01ms`（会破坏其标签测量）。
- **供应商面板语义**：`PUT` 要求 `{baseUrl, models[]}`；`PATCH` 合并顶层字段（传 `models` 即整体替换，`apiKey: null` 清除）；任何变更后刷新 `/api/models`。
- **知识库上下文**：发送时附带 `knowledgeBaseId`，服务端在用户问题后注入 `<<<KB_CONTEXT>>>…` 标记块；用户气泡通过 `stripKbContext` 隐藏该块，实时命中来自 `kb_context` SSE 事件，历史命中则回读持久化块重新解析——不重复检索、不重复注入。

## 当前边界

- 仅实现服务端已有能力：文件浏览器、Git worktree、fork/分支、导出、终端等暂未纳入。
- `config/providers.json` 中的 API Key 只由服务端读写，前端仅显示掩码。
- 单窗口单 run 交互模型：同一会话运行中不能再次发送（可停止或等待）。

## 构建与部署

`npm run build` 产物为纯静态文件（`dist/`），可托管在任意静态服务器：

1. **同源部署**：把 `dist/` 交给 Nginx 等静态服务器，并将 `/api` 反向代理到 `pi-agent-server`（默认 `127.0.0.1:8787`）。反向代理需**关闭响应缓冲**（如 Nginx `proxy_buffering off;` 或透传 `X-Accel-Buffering: no`），否则 SSE 增量会被攒住。
2. **分离部署**：构建时设置 `VITE_API_BASE=https://api.example.com` 直连服务端（服务端已放开 CORS）。

## 相关文档

- [../pi-agent-server/README.md](../pi-agent-server/README.md) — 后端服务与完整 HTTP API
- [AGENTS.md](AGENTS.md) — 开发约定与文件地图（给 AI 协作者）
- [pi-web（上游参考）](https://github.com/agegr/pi-web)
