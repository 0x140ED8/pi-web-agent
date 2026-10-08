# pi-agent-server · 内嵌 Pi 编码智能体 HTTP 服务

基于 **Pi（`@earendil-works/pi-coding-agent`）SDK 同进程嵌入**（参见 `../pi-embedding-report.md` 路线 A）实现的编码智能体服务：把 Pi 的 agent 循环、工具执行、模型/思考切换与会话持久化包装成 **HTTP + SSE**，供浏览器前端、脚本或其他应用接入。后端为 Node 原生 `http`（**零 Web 框架**）+ TypeScript（`tsx` 直跑，无构建步骤），全部运行时状态隔离在本地 `data/`，不读写 `~/.pi/agent`。

## 功能特性

### 会话与对话

- 多会话管理（`src/agent-manager.ts`）：新建 / 列出 / 详情 / 删除；会话以 Pi 原生 **JSONL 树结构**落盘 `data/sessions/`，重启后可按 id 重新打开续聊
- `POST /api/sessions/:id/prompt` **SSE 流式**：文本与思考增量、工具执行开始/更新/结束、turn/agent 生命周期事件全程可见；`stream:false` 时同步返回最终消息 JSON
- 运行控制：`abort` 中止、`compact` 上下文压缩、`rename` 重命名（持久化为 `session_info`）、`stats` token/成本统计
- 忙闲保护：同一会话同一时刻只跑一个 run，繁忙返回 409；可传 `streamingBehavior: "steer" | "followUp"` 排队
- 客户端断开 SSE 即中止当前 run，避免后台空跑

### 模型与供应商

- `config/providers.json` 采用 Pi `models.json` 原生格式，**不使用环境变量**；`PUT/PATCH/DELETE /api/providers/:id` 写入后热重载，**无需重启**（与 pi 的 `/model` 同机制）
- 模型切换同 pi `/model`（`{provider, id}`），`{action:"cycle"}` 同 Ctrl+P；选择持久化到 `data/agent/settings.json` 并同步到所有已打开会话
- 思考等级 `off/minimal/low/medium/high/xhigh/max`，按当前模型支持动态过滤
- `GET /api/models` 返回全部模型（含 Pi 内置目录）：可用性 `available` 与来源 `source`（`providers.json` / `builtin`）
- `POST /api/chat`：一次性、无工具、内存会话；不加载扩展/技能/上下文，用于会话自动命名等辅助任务
- API 响应中 Key 一律脱敏（`sk-3c...b9ee`）；`apiKey` 支持 Pi 值语法：字面量、`$ENV_VAR` 环境引用、`!command` 命令执行

### 工作区与技能

- `GET /api/files`：广度优先索引 `workspaceDir`（跳过 `node_modules`、`dist` 等，10s 缓存、上限 5000 条），供前端 `@` 文件提及
- `GET /api/skills`：列出 Pi 发现的技能（`agentDir`、`~/.agents/skills`、项目 `.pi/skills`）
- `PATCH /api/skills`：切换 SKILL.md frontmatter 的 `disable-model-invocation`，并热重载空闲会话使改动立即生效

### 知识库（RAG）

- 代理外部检索服务（`D:\MyAPP\rag`，FastAPI `:8100`）：`autoStart` 时自动拉起（首次预热 40–60s，期间接口可轮询状态）；`GET/POST /api/kb/config` 透传与合并服务配置
- 知识库 CRUD、激活、文档上传/删除、`ingest` 摄取（返回 job id 可轮询进度）、`refresh` 增量检查
- 同一时刻服务只服务一个 KB：`ensureActive` 把该库的绝对路径与参数合入 RAG 服务配置
- prompt 携带 `knowledgeBaseId` 时：先改写问题为独立检索查询 → 检索 → 把 `<<<KB_CONTEXT>>>…<<<END_KB_CONTEXT>>>` 上下文块拼在**用户问题之后**（问题在前保证会话列表预览可读；前后端展示时剥离标记块）
- `kb_context` SSE 事件携带命中摘要与**完整原始命中** `results`（text/source/heading_path/page/score），供前端按需展示“知识库搜索结果”
- 内置技能 `rag-knowledge-base`（`data/agent/skills/`，gitignored，删除后自动重建）

## 技术栈

| 层       | 技术                                                          | 版本                 |
| -------- | ------------------------------------------------------------- | -------------------- |
| 运行时   | Node.js                                                       | >= 18（开发 23.11）  |
| 语言     | TypeScript（ESM / NodeNext）                                  | ^5.7                 |
| 运行器   | tsx（无构建步骤，`tsx watch` 开发）                           | ^4.19                |
| Web 框架 | 无（Node 原生 `http` + 手写 SSE）                             | —                    |
| Agent 引擎 | `@earendil-works/pi-coding-agent`（SDK 同进程嵌入）         | 0.85.1               |
| 会话存储 | Pi 原生 JSONL（`data/sessions/*.jsonl`，树结构、可 fork）     | —                    |
| 配置     | JSON（`config/server.json`、`config/providers.json`）         | —                    |
| RAG 服务 | 外部 FastAPI 检索服务（可选，`:8100`）                        | —                    |
| 类型检查 | `tsc --noEmit`                                                | —                    |

## 目录结构

```
pi-agent-server/
├── config/
│   ├── server.json              # 服务配置（端口/工作目录/默认模型/工具/RAG）
│   └── providers.json           # 供应商 / 模型 / Key（Pi models.json 原生格式）
├── data/                        # 运行时数据（自动生成，gitignored）
│   ├── agent/                   # auth.json、models-store.json、settings.json、skills/
│   ├── sessions/                # 会话 JSONL 落盘文件
│   └── knowledge-bases/         # registry.json + 各库 data/index/parsed
├── src/
│   ├── server.ts                # HTTP 路由 + SSE 事件转发 + provider 管理 API
│   ├── agent-manager.ts         # 多会话生命周期、模型切换、one-shot、热重载
│   ├── knowledge.ts             # RAG 服务代理 + KB 注册表 + 检索上下文注入
│   ├── providers.ts             # providers.json 读写、校验、Key 脱敏
│   ├── skills.ts                # 技能发现 + disable-model-invocation 编辑
│   ├── files.ts                 # 工作区文件索引（@ 提及）
│   └── config.ts                # server.json 加载 + 路径解析
├── package.json / tsconfig.json
├── README.md                    # 本文件
├── 项目文档.md                  # 完整接口文档（含更多示例）
└── AGENTS.md                    # 开发约定（给 AI 协作者）
```

分层依赖（自下而上）：

```
Pi SDK (createAgentSession / ModelRuntime / SessionManager)
   └─ AgentManager        多会话生命周期、模型切换、供应商热重载
        └─ server.ts      HTTP 路由 + SSE 事件转发 + provider / skills / KB API
```

`workspaceDir` 默认 `".."`，即 agent 工具作用域为本仓库根目录；`sessionDir` / `agentDir` 相对路径均基于项目根解析。

## 环境准备

| 软件            | 要求                    | 说明                                                                 |
| --------------- | ----------------------- | -------------------------------------------------------------------- |
| Node.js         | >= 18（建议 20+）       | `tsx` 直接运行 TypeScript，无构建                                     |
| 网络            | 可访问所配置供应商 API  | 如 `api.deepseek.com`；离线时 `ModelRuntime` 不会联网                 |
| RAG 检索服务    | 可选                    | 不使用知识库可忽略 `rag` 配置；启用需 `D:\MyAPP\rag` 与对应 Python 环境 |
| Windows / Linux | 跨平台                  | 内置工具 Windows 用 `powershell`，Linux/macOS 用 `bash`               |

## 快速开始

启动顺序：**填写供应商 Key → 启动服务 →（可选）启动 RAG 服务 → 启动前端**。

### 1. 安装依赖

```bash
cd pi-agent-server
npm install
```

### 2. 配置供应商（首次必做）

编辑 `config/providers.json`（或启动后走 `/api/providers` 接口），至少填入一个可用的 `apiKey`：

```jsonc
{
	"providers": {
		"deepseek": {
			"baseUrl": "https://api.deepseek.com",
			"api": "openai-completions",        // OpenAI 兼容中转站均用此值
			"apiKey": "sk-...",
			"compat": { "supportsDeveloperRole": false, "supportsReasoningEffort": false, "maxTokensField": "max_tokens" },
			"models": [
				{ "id": "deepseek-chat", "reasoning": false, "input": ["text"] },
				{ "id": "deepseek-reasoner", "reasoning": true, "input": ["text"] }
			]
		}
	}
}
```

### 3. 启动服务（端口 8787）

```bash
npm start        # 前台启动（tsx src/server.ts）
npm run dev      # 监听模式，代码/配置变更自动重启
npm run typecheck # 类型检查（tsc --noEmit）
```

启动成功后输出：

```
pi-agent-server listening on http://127.0.0.1:8787
  workspace : D:\MyAPP\agent
  sessions  : ...\data\sessions
  providers : config/providers.json (edit + auto hot-reload via /api/providers)
```

后台运行（Windows PowerShell）：

```powershell
Start-Process -FilePath "cmd" -ArgumentList "/c npm start > server.log 2>&1" `
  -WorkingDirectory "pi-agent-server" -WindowStyle Hidden
```

### 4. 验证

```bash
curl http://127.0.0.1:8787/api/health          # => {"ok":true,"uptime":...}
curl -X POST localhost:8787/api/sessions -H "Content-Type: application/json" -d '{"name":"demo"}'
```

### 5. 启动前端

```bash
cd ../pi-agent-web
npm install
npm run dev      # http://127.0.0.1:5173
```

## 配置项

### `config/server.json` — 服务配置

| 字段           | 类型             | 默认值                                            | 说明                                                         |
| -------------- | ---------------- | ------------------------------------------------- | ------------------------------------------------------------ |
| `host`         | string           | `127.0.0.1`                                       | 监听地址                                                     |
| `port`         | number           | `8787`                                            | 监听端口                                                     |
| `workspaceDir` | string           | `..`                                              | agent 工具的**工作目录**（文件操作作用域），相对路径基于项目根 |
| `sessionDir`   | string           | `data/sessions`                                   | 会话 JSONL 落盘目录                                          |
| `agentDir`     | string           | `data/agent`                                      | 隔离的 Pi 配置目录（凭据/模型缓存/设置/技能）                |
| `defaultModel` | `{provider, id}` | —                                                 | 新会话默认模型；不配置则取「最近一次 UI 选择 → 首个可用模型」 |
| `thinkingLevel`| string           | `off`                                             | 默认思考等级：`off/minimal/low/medium/high/xhigh/max`        |
| `tools`        | string[]         | `read, powershell, edit, write, grep, find, ls`   | 工具白名单（仅这些工具对模型可见）                           |
| `rag.baseUrl`  | string           | `http://127.0.0.1:8100`                           | RAG 服务地址                                                 |
| `rag.projectDir` | string         | `D:\MyAPP\rag`                                    | RAG 项目根（拉起服务的 cwd）                                 |
| `rag.python`   | string           | conda 环境 python 路径                            | 自动拉起服务所用解释器                                       |
| `rag.autoStart`| boolean          | `true`                                            | 服务不在线时是否自动拉起并等待预热                           |

### `config/providers.json` — 供应商 / 模型 / Key

采用 Pi 原生 `models.json` 格式，**不使用环境变量**。直接编辑文件或通过 HTTP API 增删改，两者等价；改动即时热生效（无需重启，与 pi 的 `/model` 相同机制）。

字段说明：

- `baseUrl`：API 端点地址；OpenAI 兼容中转站填其根地址（如 `https://relay.example.com/v1`）
- `api`：流式实现类型，OpenAI 兼容一律用 `openai-completions`
- `apiKey`：支持字面量 `sk-...`、环境引用 `$VAR` / `${VAR}`、命令执行 `!command`
- `compat`：兼容开关，常用 `supportsDeveloperRole: false`（强制 `system` 角色）、`supportsReasoningEffort: false`、`maxTokensField: "max_tokens"`
- `models`：模型列表，`id` 必填；`reasoning` / `input` / `contextWindow` / `maxTokens` / `cost` 可选

> 安全提示：Key 明文存于该文件，注意文件与仓库权限；服务端 API 响应中 Key 一律脱敏。DeepSeek 是 Pi 内置供应商，此处配置的模型与内置 DeepSeek 模型**合并**（而非替换）。

## HTTP API

Base URL：`http://127.0.0.1:8787`；所有响应为 JSON，错误统一 `{error: string}`。CORS 已放开（`Access-Control-Allow-Origin: *`）。

### 通用

| 方法 | 路径            | 说明                                    |
| ---- | --------------- | --------------------------------------- |
| GET  | `/`             | API 概览（名称、嵌入方式、workspace、端点清单） |
| GET  | `/api/health`   | 健康检查 `{ok, uptime}`                 |

### 供应商 / 模型

| 方法   | 路径                    | 说明                                                                 |
| ------ | ----------------------- | -------------------------------------------------------------------- |
| GET    | `/api/providers`        | 供应商列表（Key 脱敏，含 `hasApiKey`、`apiKeyMasked`）               |
| PUT    | `/api/providers/:id`    | 新增/整体替换，体：`{name?, baseUrl, api?, apiKey?, compat?, models[]}` |
| PATCH  | `/api/providers/:id`    | 部分更新（如只换 `apiKey`）；`apiKey: null` 删除 key                 |
| DELETE | `/api/providers/:id`    | 删除供应商                                                           |
| GET    | `/api/models`           | 全部模型 + `available`（是否已配置可用 key）+ `source`（`providers.json`/`builtin`） |

> 供应商 `id` 仅允许 `[a-zA-Z0-9][a-zA-Z0-9_-]*`。PUT/PATCH/DELETE 写入后立即热重载，无需重启。

### 会话

| 方法   | 路径                         | 说明                                                                 |
| ------ | ---------------------------- | -------------------------------------------------------------------- |
| POST   | `/api/sessions`              | 新建会话，体：`{name?}`；返回 `{id, name, file, model, thinkingLevel, availableThinkingLevels}` |
| GET    | `/api/sessions`              | 会话列表（落盘文件：`id/name/file/created/modified/messageCount/firstMessage/isOpen`） |
| GET    | `/api/sessions/:id`          | 会话详情（模型、思考等级、工具、空闲态）；未打开时按 id 从磁盘重新打开 |
| DELETE | `/api/sessions/:id`          | 删除会话（释放内存并移除落盘 JSONL 文件）                            |
| GET    | `/api/sessions/:id/messages` | 完整消息历史（含 `model`、`thinkingLevel`、`availableThinkingLevels`、`isIdle`） |
| GET    | `/api/sessions/:id/stats`    | token / 成本统计                                                     |

### 对话与运行控制

| 方法 | 路径                          | 说明                                                                                     |
| ---- | ----------------------------- | ---------------------------------------------------------------------------------------- |
| POST | `/api/sessions/:id/prompt`    | 发送消息。默认 **SSE 流式**；体：`{message, stream?, streamingBehavior?, knowledgeBaseId?}` |
| POST | `/api/sessions/:id/model`     | 切换模型（同 pi `/model`）：`{provider, id, thinkingLevel?}` 或 `{action:"cycle"}`（同 Ctrl+P） |
| POST | `/api/sessions/:id/thinking`  | 设置思考等级 `{level}`；仅接受当前模型支持的等级                                         |
| POST | `/api/sessions/:id/compact`   | 上下文压缩，体：`{instructions?}`                                                        |
| POST | `/api/sessions/:id/abort`     | 中止当前 run                                                                             |
| POST | `/api/sessions/:id/rename`    | 重命名会话 `{name}`（持久化为 session_info）                                             |

`prompt` 请求体说明：

```jsonc
{
  "message": "列出当前目录的文件",
  "stream": true,                 // 默认 true（SSE）；false 则同步返回 JSON
  "streamingBehavior": "steer",   // 繁忙时排队：steer（插队）/ followUp（等待）
  "knowledgeBaseId": "kb-xxx"     // 可选：检索该知识库并注入上下文（slash 命令不注入）
}
```

- 会话空闲时无 `streamingBehavior` 直接执行；繁忙时缺省返回 `409`
- `stream:false` 返回：`{sessionId, model, messages, lastAssistantText, kb?}`
- 前端非流式请求 / 命令行也可用 `?stream=false` 查询参数关闭流式

### 辅助

| 方法  | 路径           | 说明                                                                             |
| ----- | -------------- | -------------------------------------------------------------------------------- |
| POST  | `/api/chat`    | 一次性无工具对话 `{message, systemPrompt?, provider?, id?}` → `{text, model?}`    |
| GET   | `/api/files`   | 工作区文件索引 `{workspace, files[], truncated}`，供前端 `@` 提及                 |
| GET   | `/api/skills`  | 技能列表（含 `filePath`、`source`、`scope`、`disableModelInvocation`）            |
| PATCH | `/api/skills`  | `{filePath, disableModelInvocation}` 切换禁用标记；返回 `{ok, skill, reloadedSessions}` |

### 知识库（RAG）

| 方法   | 路径                               | 说明                                                                 |
| ------ | ---------------------------------- | -------------------------------------------------------------------- |
| GET    | `/api/kb`                          | 概览：服务状态 `{online, starting, health}`、`activeId`、KB 列表（含 `docCount`） |
| POST   | `/api/kb`                          | 新建知识库 `{name, description?}`                                    |
| PATCH  | `/api/kb/:id` / DELETE `/api/kb/:id` | 更新 / 删除知识库（managed 目录一并移除）                           |
| POST   | `/api/kb/:id/activate`             | 激活（把该库路径与参数合入 RAG 服务配置，返回 warnings）             |
| GET    | `/api/kb/:id/documents`            | 文档列表                                                             |
| POST   | `/api/kb/:id/documents`            | 上传文档 `{name, contentBase64}`                                     |
| DELETE | `/api/kb/:id/documents/:name`      | 删除文档                                                             |
| POST   | `/api/kb/:id/ingest`               | 触发摄取，返回 `{job_id, status, detail}`                            |
| POST   | `/api/kb/:id/refresh`              | 增量刷新（dry-run 检查：新增/删除/参数变化）                          |
| GET    | `/api/kb/jobs/:jobId`              | 摄取任务进度                                                         |
| POST   | `/api/kb/query`                    | 直接检索 `{query, kbId?, rewrite?, topK?, rerank?}` → `{kbId, kbName, query, rewrittenQuery, hits[], took_ms}` |
| POST   | `/api/kb/service/start`            | 手动拉起 RAG 服务                                                    |
| GET/POST | `/api/kb/config`                 | 读取 / 合并更新 RAG 服务配置（返回 `applied`、`warnings`、`backup`） |

## SSE 事件流

`POST /api/sessions/:id/prompt`（未关闭 stream）返回 `text/event-stream`，每条帧为 `event:<类型>\ndata:<JSON>\n\n`：

```
open                  # 服务端发起，{sessionId}
kb_context            # 可选，知识库命中摘要 + results 原始命中
agent_start
message_start
message_update        # 增量：text_delta / thinking_delta / toolcall_start/delta/end
tool_execution_start  # 工具开始（工具名 + 入参）
tool_execution_update # 工具流式输出
tool_execution_end    # 工具结束（结果 + isError）
message_end           # message 为权威最终消息
turn_end
agent_end
agent_settled         # 彻底安定（无任何自动后续）
done                  # 服务端发起，{sessionId, settled}
```

- 事件名等于 JSON 内 `type` 字段，客户端按 `type` 分发即可
- `message_update` 已剔除 `partial` 大对象，仅保留 `{type, contentIndex, delta?, content?}`
- 其余事件（`turn_start`、`queue_update`、`compaction_*`、`auto_retry_*`、`thinking_level_changed` 等）原样透传
- **客户端断开连接会中止当前 run**

## 调用示例

```bash
# 新建会话
curl -s -X POST localhost:8787/api/sessions \
  -H "Content-Type: application/json" -d '{"name":"demo"}'
# => {"id":"xxx","model":"deepseek/deepseek-chat",...}

# SSE 流式对话（-N 禁用缓冲，工具调用全程可见）
curl -N -X POST localhost:8787/api/sessions/<id>/prompt \
  -H "Content-Type: application/json" \
  -d '{"message":"列出当前目录的文件"}'

# 非流式（取最终回复）
curl -s -X POST localhost:8787/api/sessions/<id>/prompt \
  -H "Content-Type: application/json" \
  -d '{"message":"用一句话总结","stream":false}'

# 切到 DeepSeek R1 并开思考
curl -s -X POST localhost:8787/api/sessions/<id>/model \
  -H "Content-Type: application/json" \
  -d '{"provider":"deepseek","id":"deepseek-reasoner","thinkingLevel":"medium"}'

# 循环切换（同 Ctrl+P）
curl -s -X POST localhost:8787/api/sessions/<id>/model \
  -H "Content-Type: application/json" -d '{"action":"cycle"}'

# 新增一个 OpenAI 兼容中转站（立即生效）
curl -s -X PUT localhost:8787/api/providers/my-relay \
  -H "Content-Type: application/json" -d '{
    "baseUrl": "https://relay.example.com/v1",
    "api": "openai-completions",
    "apiKey": "sk-xxx",
    "compat": {"supportsDeveloperRole": false},
    "models": [{"id": "gpt-4o", "reasoning": false}]
  }'

# 只换 Key / 删 Key
curl -s -X PATCH localhost:8787/api/providers/my-relay \
  -H "Content-Type: application/json" -d '{"apiKey":"sk-new"}'
curl -s -X PATCH localhost:8787/api/providers/my-relay \
  -H "Content-Type: application/json" -d '{"apiKey":null}'

# 会话历史与统计
curl -s localhost:8787/api/sessions/<id>/messages
curl -s localhost:8787/api/sessions/<id>/stats
```

## 注意事项

1. **并发**：一个会话同一时刻只跑一个 agent run；多用户请各用独立会话。
2. **SSE 断连即中止**：客户端断开（关闭页面/网络中断）会 abort 当前 run，这是刻意设计；需要长任务请保持连接或在服务端另做任务队列。
3. **Key 安全**：Key 明文存于 `config/providers.json`，务必管控文件与仓库权限；接口响应已脱敏。服务默认只监听 `127.0.0.1`，并对所有来源开放 CORS（`*`），如需对外暴露请自行加鉴权层。
4. **供应商热重载**：接口写入即时生效；**手工编辑 `providers.json` 不会立即生效**，需重启服务或通过接口再改一次。
5. **工具权限**：`tools` 为白名单，生产环境建议只给只读工具（`read/grep/find/ls`）或配合沙箱；`workspaceDir` 即工具作用域，默认覆盖本仓库全部文件。
6. **`data/` 为生成目录**（gitignored）：包含会话历史、凭据缓存、KB 数据，删除即丢失会话历史，但服务可正常重建。
7. **端口占用**：默认 `8787`，`EADDRINUSE` 表示已有旧实例在跑，先找到并结束监听进程再重启。
8. **会话持久化跨重启**：`GET /api/sessions/:id` 会按 id 从 `data/sessions/` 重新打开 JSONL 会话；支持跨供应商续聊（Pi 原生能力）。
9. **升级兼容**：依赖 `@earendil-works/pi-coding-agent` 公共导出（`createAgentSession` / `ModelRuntime` / `SessionManager` / `SettingsManager`），升级时留意大版本 API 变化。

## 相关文档

- [项目文档.md](项目文档.md) — 完整接口文档与更多示例
- [../pi-embedding-report.md](../pi-embedding-report.md) — Pi 内嵌集成调研（四条路线对比，本项目采用路线 A）
- [../pi-agent-web/README.md](../pi-agent-web/README.md) — 配套浏览器前端
- Pi 官方文档：<https://pi.dev/docs/latest> · SDK 文档：<https://pi.dev/docs/latest/sdk>
