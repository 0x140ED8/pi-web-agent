# Pi（pi-coding-agent）项目分析与内嵌集成报告

> 信息来源：官方最新文档 <https://pi.dev/docs/latest> 及 GitHub 仓库 <https://github.com/earendil-works/pi>（2026-09 检索）
>
> 本报告目标：① 讲清 Pi 的项目组成与实现机制；② 给出将 Pi 作为其它项目"内嵌智能体"的完整可行方案与选型建议。

---

## 目录

1. [项目概述](#1-项目概述)
2. [仓库与包结构（项目组成）](#2-仓库与包结构项目组成)
3. [核心实现剖析](#3-核心实现剖析)
4. [内嵌 Pi 的四条路线](#4-内嵌-pi-的四条路线)
5. [路线 A：SDK 同进程嵌入（推荐，Node.js/TypeScript）](#5-路线-asdks-同进程嵌入推荐nodetypescript)
6. [路线 B：RPC 子进程模式（跨语言/进程隔离）](#6-路线-brpc-子进程模式跨语言进程隔离)
7. [路线 C：JSON 事件流 / Print 模式（一次性任务）](#7-路线-cjson-事件流--print-模式一次性任务)
8. [路线 D：只复用底层包自建 Agent](#8-路线-d只复用底层包自建-agent)
9. [Fork / 品牌化（深度定制）](#9-fork--品牌化深度定制)
10. [方案选型对比与建议](#10-方案选型对比与建议)
11. [集成注意事项与安全](#11-集成注意事项与安全)
12. [参考链接](#12-参考链接)

---

## 1. 项目概述

**Pi 是一个"极简终端编码代理（minimal terminal coding harness）"**，由 earendil-works 开源（npm 包 `@earendil-works/pi-coding-agent`）。设计哲学是：

- **核心保持小**：agent 循环、消息类型、provider 抽象等核心尽量精简；
- **一切通过扩展机制生长**：TypeScript 扩展、Skills、Prompt 模板、主题、pi 包（packages）；
- **官方明确支持"被嵌入"**：文档专门提供 SDK、RPC 模式、JSON 事件流三种编程化使用方式——这正贴合"作为其它项目的内嵌智能体"的需求。

安装：

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
pi   # 在项目目录运行
```

内置支持 Anthropic、OpenAI、Google、Mistral、AWS Bedrock、Azure、OpenRouter 等主流 Provider（API Key 或 OAuth 订阅登录），也支持 llama.cpp 本地模型与完全自定义 Provider。

---

## 2. 仓库与包结构（项目组成）

Pi 是 npm workspaces monorepo，四个运行时包 + 开发期实验代码：

```
pi/  (github.com/earendil-works/pi)
├── packages/
│   ├── ai/            # LLM Provider 抽象层（pi-ai）
│   ├── agent/         # Agent 循环与消息类型（pi-agent-core）
│   ├── tui/           # 终端 UI 组件库（pi-tui）
│   └── coding-agent/  # CLI 与交互模式（pi-coding-agent，即 "pi" 本体，也是 SDK 入口）
├── examples/          # 官方示例：examples/sdk/（01~11）、examples/extensions/
└── AGENTS.md / CONTRIBUTING.md 等
```

### 2.1 `packages/ai`（pi-ai）—— LLM Provider 抽象

- 定义 `Model`、`UserMessage`、`AssistantMessage`、`ToolResultMessage`、`Usage`、`Context` 等基础类型；
- 每种 API 一个流式实现（`src/api/`）：`anthropic-messages`、`openai-completions`、`openai-responses`、`google-generative-ai`、`google-vertex`、`bedrock-converse-stream`、`mistral-conversations`、`azure-openai-responses` 等；
- 统一的流式事件模型 `AssistantMessageEventStream`（`text_start/delta/end`、`thinking_*`、`toolcall_*`、`done/error`）；
- 模型目录（含成本/上下文窗口元数据）由脚本生成（`models.generated.ts`），支持从 pi.dev 远程刷新并本地缓存；
- 凭据存储抽象（`CredentialStore`，含 `InMemoryCredentialStore`）、OAuth 流抽象。

### 2.2 `packages/agent`（pi-agent-core）—— Agent 循环

- `Agent` 类：核心 LLM 交互循环（发送消息 → 流式接收 → 执行工具调用 → 回灌结果 → 循环直至停止）；
- `AgentState`：`messages` / `model` / `thinkingLevel` / `systemPrompt` / `tools` / `streamingMessage`；
- `AgentEvent`：agent/turn/message/tool 各层级生命周期事件（与 SDK/RPC 事件一一对应）；
- **不包含**任何 CLI、TUI、会话持久化——这层是"纯 agent 引擎"，单独可复用。

### 2.3 `packages/tui`（pi-tui）—— 终端 UI 组件库

编辑器、聊天历史渲染、对话框、自定义组件（带键盘输入）等，供交互模式与扩展使用。内嵌场景若自建 Web UI 可完全不用此包。

### 2.4 `packages/coding-agent`（pi-coding-agent）—— 本体 + SDK

源码结构（`src/`）：

| 目录/文件 | 职责 |
|---|---|
| `cli.ts` / `main.ts` | CLI 入口、参数解析 |
| `config.ts` | 包资产路径解析（支持 npm 安装/独立二进制/tsx 源码三种运行模式） |
| `index.ts` | **SDK 公共导出入口**（`createAgentSession` 等） |
| `rpc-entry.ts` | RPC 模式独立入口 |
| `core/` | 核心运行时（见下） |
| `modes/` | 四种运行模式：`interactive/`（TUI）、`rpc/`、`print-mode.ts`、`json-event.ts` |
| `extensions/`、`cli/`、`client/`、`experimental/`、`utils/`、`bun/` | 扩展加载、CLI 命令、实验性远程 harness 等 |

`core/` 关键模块（依据仓库文件）：

| 模块 | 职责 |
|---|---|
| `agent-session.ts`（约 12 万字符，最大文件） | **AgentSession**：会话生命周期、事件流、prompt 队列（steer/followUp）、压缩、自动重试的编排中枢 |
| `agent-session-runtime.ts` / `agent-session-services.ts` | AgentSessionRuntime：会话替换（new/switch/fork/clone/import）与 cwd 绑定服务 |
| `sdk.ts` | `createAgentSession()` 工厂 |
| `session-manager.ts` | JSONL 会话文件、树结构（id/parentId）、分支、compaction 重建上下文 |
| `settings-manager.ts` | 全局 + 项目设置合并（`~/.pi/agent/settings.json` + `.pi/settings.json`） |
| `model-runtime.ts` / `model-registry.ts` / `model-resolver.ts` / `provider-composer.ts` | 模型目录、凭据解析、Provider 组合（内置 + models.json + 扩展注册） |
| `resource-loader.ts` | **DefaultResourceLoader**：发现扩展/skills/prompts/themes/AGENTS.md 上下文文件 |
| `skills.ts` / `prompt-templates.ts` / `slash-commands.ts` | 资源类型实现 |
| `system-prompt.ts` | 系统提示词组装 |
| `extensions/`、`compaction/`、`export-html/` | 扩展运行时、上下文压缩、HTML 导出 |
| `package-manager.ts` | `pi install`（npm/git/本地路径 pi 包管理） |
| `project-trust.ts` | 项目信任（项目本地 `.pi/` 动态配置需信任后加载） |

### 2.5 资源与扩展生态（用户可见的"组成"）

| 资源 | 位置（全局 / 项目） | 作用 |
|---|---|---|
| 扩展 (Extensions) | `~/.pi/agent/extensions/`、`.pi/extensions/` | TypeScript 模块：注册工具/命令/事件钩子/自定义 UI |
| Skills | `~/.pi/agent/skills/`、`.pi/skills/`、`.agents/skills/` | SKILL.md 按需能力（`/skill:name` 调用） |
| Prompt 模板 | `~/.pi/agent/prompts/`、`.pi/prompts/` | `.md` 展开为斜杠命令 |
| 主题 | themes 目录 | 终端配色 |
| Pi 包 | `pi install npm:... / git:...` | 打包分发以上资源的 npm/git 包 |
| 上下文文件 | `AGENTS.md`（向上遍历） | 注入项目规范 |

---

## 3. 核心实现剖析

### 3.1 分层架构

```
┌──────────────────────────────────────────────────────┐
│ modes: interactive(TUI) / rpc / print / json-event    │  ← 表现层（可整体替换）
├──────────────────────────────────────────────────────┤
│ AgentSession / AgentSessionRuntime (coding-agent)    │  ← 编排层：队列/压缩/重试/会话替换
├──────────────────────────────────────────────────────┤
│ ResourceLoader / SettingsManager / ModelRuntime      │  ← 资源与配置层（全部可注入/覆盖）
├──────────────────────────────────────────────────────┤
│ Agent (pi-agent-core)：agent loop + 事件总线          │  ← 引擎层
├──────────────────────────────────────────────────────┤
│ pi-ai：Provider 抽象 + 各 API 流式实现 + 凭据         │  ← 模型接入层
└──────────────────────────────────────────────────────┘
```

关键点：**每一层都通过依赖注入解耦**（SessionManager、SettingsManager、ResourceLoader、ModelRuntime、tools 列表均可由宿主应用替换），这正是它适合被嵌入的原因。

### 3.2 Agent 循环与事件模型

一次 prompt 的处理流程（也是扩展/SDK 消费的事件序列）：

```
prompt
 → before_agent_start（可注入消息/改系统提示词）
 → agent_start
 → [turn 循环：turn_start → context(可改消息) → before_provider_headers
    → before_provider_request → after_provider_response
    → message_start/update/end（流式 text/thinking/toolcall 增量）
    → tool_execution_start → tool_call(可拦截) → tool_execution_update
    → tool_result(可改结果) → tool_execution_end → turn_end]
 → agent_end（本次底层运行结束，可能还会自动重试/压缩/续队列）
 → agent_settled（彻底安定，无任何自动后续）
```

消息队列机制：流式进行中可 `steer()`（本回合工具调用完后立即插入，改变方向）或 `followUp()`（等 agent 完全停下再发）。

### 3.3 会话格式：JSONL + 树

- 文件：`~/.pi/agent/sessions/--<path>--/<timestamp>_<uuid>.jsonl`，首行 header（版本 v3）；
- 每行一个 entry，`id`/`parentId` 构成**树**，支持原地分支（`/fork`、`/tree` 导航）而不复制文件；
- entry 类型：`message`（AgentMessage：user/assistant/toolResult/bashExecution/custom/branchSummary/compactionSummary）、`compaction`、`branch_summary`、`model_change`、`thinking_level_change`、`custom`（扩展状态，不入上下文）、`custom_message`（扩展注入，入上下文）、`label`、`session_info`；
- 上下文重建：`buildContextEntries()` 从叶到根回溯，遇到 compaction 用摘要替换 `firstKeptEntryId` 之前的消息——**上下文压缩/分支摘要直接内建在会话格式里**。

### 3.4 上下文压缩（Compaction）

- 手动（`/compact`）、阈值触发（threshold）、溢出恢复（overflow：请求超窗 → 压缩 → 自动重试一次）；
- 扩展可通过 `session_before_compact` 取消或**提供自定义摘要**。

### 3.5 工具系统

- 内置工具：`read`、`bash`、`powershell`、`edit`、`write`、`grep`、`find`、`ls`（默认启用前四个）；
- `tools` 白名单 / `excludeTools` 黑名单 / `noTools: "all"|"builtin"`；
- 自定义工具：`defineTool()`（TypeBox 参数 schema）或扩展内 `pi.registerTool()`；
- 工具执行支持并行（preflight 顺序 → 并发执行 → 按完成序回传）；
- `edit` 工具结果带 `details.diff`（TUI 显示）和 `details.patch`（标准 unified patch，供 SDK 消费）。

### 3.6 扩展系统（jiti 加载 TypeScript）

- 扩展 = 导出默认工厂函数的 TS 模块，经 jiti 免编译加载，拥有 `ExtensionAPI`（`pi.on/registerTool/registerCommand/registerShortcut/registerFlag/registerProvider/appendEntry/sendMessage/setModel/...`）；
- 事件钩子可拦截几乎一切环节（工具调用拦截/改参、结果改写、请求头/payload 改写、压缩接管、UI 交互）；
- 在 RPC 模式下，`ctx.ui.select/confirm/input/editor` 被翻译为 stdin/stdout 上的请求-响应子协议——宿主程序可实现自己的 UI 应答。

### 3.7 模型与凭据解析

认证优先级：运行时覆盖（`setRuntimeApiKey`，不落盘）→ `auth.json`（API Key/OAuth）→ 环境变量（`ANTHROPIC_API_KEY` 等）→ 自定义 provider 的 fallback 解析器。远程模型目录本地缓存（`models-store.json`），4 小时节流，`PI_OFFLINE` 可禁网。

---

## 4. 内嵌 Pi 的四条路线

官方为"把 pi 嵌入其它应用"提供了明确支持，按集成深度从低到高：

| 路线 | 方式 | 适用 |
|---|---|---|
| **A. SDK** | `import { createAgentSession } from "@earendil-works/pi-coding-agent"`，同进程 | Node.js/TS 宿主，需要类型安全、直接访问 agent 状态 |
| **B. RPC 模式** | 子进程 `pi --mode rpc`，stdin/stdout JSONL 双向协议 | 跨语言（Python/Go/Rust...）、要进程隔离、构建语言无关客户端 |
| **C. JSON 事件流 / Print** | `pi --mode json "prompt"` 或 `pi -p`，单向输出 | 一次性任务、CI、脚本 |
| **D. 底层包自建** | 直接用 `pi-ai`（+ `pi-agent-core`）组装 | 只想要 Provider 抽象/最小引擎，不要 CLI 资源生态 |

另有 **Fork/品牌化**（第 9 节）适合做自有产品分发。

官方选型口径：Node.js 同进程 → SDK；其它语言或要进程隔离 → RPC。

---

## 5. 路线 A：SDK 同进程嵌入（推荐，Node.js/TypeScript）

SDK 已包含在主包内，无需额外安装：

```bash
npm install @earendil-works/pi-coding-agent
```

### 5.1 最小可用示例

```typescript
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";

const modelRuntime = await ModelRuntime.create();
const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),  // 不落盘
  modelRuntime,
});

session.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

await session.prompt("当前目录有哪些文件？");
```

### 5.2 AgentSession 关键 API

```typescript
interface AgentSession {
  prompt(text, options?: PromptOptions): Promise<void>;   // 发送并等待完成
  steer(text): Promise<void>;      // 流式中插入转向指令
  followUp(text): Promise<void>;   // 流式结束后追加
  subscribe(listener): () => void; // 事件订阅（返回退订函数）
  setModel(model): Promise<void>;
  setThinkingLevel(level): void;   // off/minimal/low/medium/high/xhigh/max
  compact(customInstructions?): Promise<CompactionResult>;
  abort(): Promise<void>;
  navigateTree(targetId, options?): Promise<...>;  // 会话树导航
  agent: Agent;                    // state.messages/tools/systemPrompt
  messages: AgentMessage[];
  isStreaming: boolean;
  dispose(): void;
}
```

`PromptOptions`：`images`（多模态）、`streamingBehavior: "steer"|"followUp"`、`expandPromptTemplates`、`preflightResult` 回调。

### 5.3 常用嵌入选项

```typescript
const { session } = await createAgentSession({
  cwd: "/path/to/project",              // 工具的工作目录、资源发现起点
  agentDir: "/custom/agent-dir",        // 替换 ~/.pi/agent（凭据/设置/会话等全部指向自定义位置）

  model,                                // 不传则按 会话恢复→设置默认→首个可用 顺序回退
  thinkingLevel: "medium",
  modelRuntime,                         // 可自定义 authPath/modelsPath 或注入 InMemoryCredentialStore

  tools: ["read", "bash", "grep", "my_tool"],  // 白名单（含自定义工具名）
  customTools: [myTool],                // defineTool() 定义的内联工具
  excludeTools: ["ask_question"],
  // noTools: "all",

  resourceLoader: loader,               // DefaultResourceLoader 或完全自定义
  sessionManager: SessionManager.inMemory(),
  settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
});
```

### 5.4 资源注入（ResourceLoader）

`DefaultResourceLoader` 支持逐项覆盖，适合把 Pi "改造成你产品里的智能体"：

```typescript
import { DefaultResourceLoader, createEventBus } from "@earendil-works/pi-coding-agent";

const loader = new DefaultResourceLoader({
  cwd,
  agentDir,
  systemPromptOverride: () => "你是 XX 产品里的助手……",   // 换掉系统提示词
  extensionFactories: [                                  // 内联扩展（无需 .ts 文件）
    (pi) => {
      pi.on("tool_call", async (event, ctx) => {
        if (event.toolName === "bash" && event.input.command?.includes("rm -rf")) {
          return { block: true, reason: "策略禁止" };
        }
      });
    },
  ],
  additionalExtensionPaths: ["/path/to/ext.ts"],
  skillsOverride:       (cur) => ({ ...cur, skills: [...cur.skills, mySkill] }),
  promptsOverride:      (cur) => ({ ...cur, prompts: [...cur.prompts, myCommand] }),
  agentsFilesOverride:  (cur) => ({ ...cur, agentsFiles: [...cur.agentsFiles, { path: "/virtual/AGENTS.md", content: "# 规范" }] }),
  eventBus,                                              // 与扩展共享事件总线
});
await loader.reload();
```

### 5.5 凭据管理（产品化必备）

```typescript
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

// 方式一：运行时注入，不落盘
const rt = await ModelRuntime.create();
await rt.setRuntimeApiKey("anthropic", process.env.MY_KEY);

// 方式二：完全内存化（多租户/沙箱推荐）
const rt2 = await ModelRuntime.create({ credentials: new InMemoryCredentialStore() });

// 方式三：指向自定义文件
const rt3 = await ModelRuntime.create({ authPath: "/my/app/auth.json", modelsPath: "/my/app/models.json" });
```

### 5.6 会话持久化与多会话管理

```typescript
SessionManager.inMemory()                    // 内存（可传入 entries 从 DB 恢复）
SessionManager.create(cwd)                   // 新建持久会话
SessionManager.continueRecent(cwd)           // 续接最近
SessionManager.open(path)                    // 打开指定文件
await SessionManager.list(cwd) / listAll()   // 列表
```

需要 `/new`、`/resume`、`/fork`、`/clone`、导入等**会话替换**能力时，用 `createAgentSessionRuntime()`（内置交互/RPC/print 模式同款层）。注意：替换后 `runtime.session` 变化，事件订阅需重新挂接，扩展需重新 `bindExtensions`。

### 5.7 事件消费（自建 UI 的数据源）

事件类型速查：`agent_start/end/settled`、`turn_start/end`、`message_start/update/end`（`text_delta`/`thinking_delta`/`toolcall_*` 增量）、`tool_execution_start/update/end`、`queue_update`、`compaction_start/end`、`auto_retry_start/end`、`extension_error`。`message_end.message` 是权威最终消息。

### 5.8 完整能力示例

官方在 `examples/sdk/` 提供 01~11 号示例：minimal、custom-model、custom-prompt、skills、tools、extensions、context-files、prompt-templates、api-keys-and-oauth、settings、sessions。嵌入开发时直接对照即可。

---

## 6. 路线 B：RPC 子进程模式（跨语言/进程隔离）

```bash
pi --mode rpc [--provider anthropic] [--model "anthropic/claude-opus-4-5:high"] [--no-session] [--session-dir <path>] [--name <name>]
```

### 6.1 协议要点

- **纯 JSONL over stdin/stdout**，LF 分隔（客户端注意：Node `readline` 因会按 U+2028/U+2029 分行而不合规，需自行按 `\n` 切分并容忍结尾 `\r`）；
- 命令（stdin，可带 `id` 用于关联）：`prompt`（含 `images`、`streamingBehavior`）、`steer`、`follow_up`、`abort`、`clear_queue`、`new_session`、`get_state`、`get_messages`、`set_model`、`cycle_model`、`get_available_models`、`set_thinking_level`、`compact`、`set_auto_compaction`、`set_auto_retry`、`bash`（宿主直接执行 shell 并入上下文）、`get_session_stats`、`switch_session`、`fork`、`clone`、`get_entries`（游标增量拉取）、`get_tree`、`get_last_assistant_text`、`get_commands`、`export_html`、`set_session_name` 等；
- 响应（stdout）：`{"type":"response","command":...,"success":...,"data":...}`；
- 事件（stdout）：与 SDK 事件同构（`message_update` 为 delta-only，需自行按 `contentIndex` 组装）；
- **扩展 UI 子协议**：`extension_ui_request`（select/confirm/input/editor 阻塞等待；notify/setStatus/setWidget/setTitle/set_editor_text 即发即弃）↔ `extension_ui_response`——宿主可用自己的 GUI 应答扩展发起的交互。

### 6.2 Python 客户端骨架（官方示例）

```python
import subprocess, json

proc = subprocess.Popen(
    ["pi", "--mode", "rpc", "--no-session"],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)

def send(cmd):
    proc.stdin.write(json.dumps(cmd) + "\n"); proc.stdin.flush()

send({"type": "prompt", "message": "Hello!"})

for line in proc.stdout:
    ev = json.loads(line)
    if ev.get("type") == "message_update":
        d = ev.get("assistantMessageEvent", {})
        if d.get("type") == "text_delta":
            print(d["delta"], end="", flush=True)
    if ev.get("type") == "agent_end":
        break
```

Node.js 侧可参考仓库内 `src/modes/rpc/rpc-client.ts`（带类型的完整客户端）与 `test/rpc-example.ts`。

### 6.3 何时选 RPC

- 宿主不是 Node.js（Python/Go/Rust/Java/Electron 外部进程…）；
- 需要进程隔离/沙箱（配合容器：Gondolin、Docker、OpenShell）；
- 希望与 pi 版本解耦、独立升级。

---

## 7. 路线 C：JSON 事件流 / Print 模式（一次性任务）

```bash
# 结构化事件流（第一行 session header，随后逐事件 JSON 行）
pi --mode json "List files" 2>/dev/null | jq -c 'select(.type == "message_end")'

# 单次问答
pi -p "解释这段代码"
```

适合 CI、批处理、无交互集成。SDK 中对应 `runPrintMode(runtime, {...})`。

---

## 8. 路线 D：只复用底层包自建 Agent

如果只需要 Pi 的**引擎与 Provider 抽象**，不要它的资源生态（扩展/skills/会话），可以直接依赖底层包：

- `@earendil-works/pi-ai`：`getModel`、各 API 的 `stream()`/`streamSimple()`、类型系统、凭据抽象；
- `@earendil-works/pi-agent-core`：`Agent` 循环与 `AgentEvent`。

代价：需要自己实现会话持久化、压缩、steer/followUp 队列、自动重试等（这些都在 coding-agent 层）。**除非有极强的瘦身需求，否则直接用 `createAgentSession({ noTools: ..., sessionManager: inMemory })` 关闭不用的部分更划算**——SDK 层本身就是可裁剪的。

---

## 9. Fork / 品牌化（深度定制）

想把 Pi 变成"自有品牌智能体 CLI/产品"分发，官方支持 rebrand：

```jsonc
// package.json
{
  "piConfig": {
    "name": "my-agent",       // CLI banner、环境变量前缀等
    "configDir": ".my-agent"  // 配置目录名（默认 .pi）
  },
  "bin": { "my-agent": "..." }
}
```

配合 SDK 覆盖 systemPrompt、内置资源与扩展，即可得到一个行为完全受控的自有 agent。注意遵守上游开源协议。

---

## 10. 方案选型对比与建议

| 维度 | A. SDK | B. RPC | C. JSON/Print | D. 底层包 |
|---|---|---|---|---|
| 语言 | Node.js/TS | 任意 | 任意（shell） | Node.js/TS |
| 进程 | 同进程 | 子进程隔离 | 子进程 | 同进程 |
| 类型安全 | 强（直接 TS 类型） | 弱（JSON 协议） | 无 | 强 |
| 状态访问 | 直接（messages/tools/state） | 协议查询 | 快照 | 直接 |
| 扩展/资源生态 | 完整 | 完整（含 UI 子协议） | 部分 | 无（自建） |
| 自定义 UI | 自由（订阅事件渲染） | 自由 | 有限 | 自由 |
| 实现成本 | 低 | 中（需写协议客户端） | 极低 | 高 |

**建议**：

- **Node.js 桌面/Web 后端内嵌** → 路线 A（SDK）+ `SessionManager.inMemory()` + 自定义 ResourceLoader/系统提示词 + 工具白名单；多用户场景用 `InMemoryCredentialStore` 或独立 `authPath` 隔离凭据；
- **Python/Go 等技术栈，或要做进程沙箱** → 路线 B（RPC）；
- **只是定时/CI 调用** → 路线 C；
- **要完全控制循环逻辑、只要 Provider 层** → 路线 D；
- **要发独立产品** → Fork/品牌化 + SDK 定制。

---

## 11. 集成注意事项与安全

1. **扩展与 pi 包以完整系统权限运行**，可执行任意代码；只加载可信来源。项目本地 `.pi/` 资源默认需通过 project trust。
2. **bash/写文件类工具**建议：生产嵌入用 `tools` 白名单（如只读 `["read","grep","find","ls"]`），并通过 `tool_call` 钩子或沙箱（容器/Gondolin/OpenShell）兜底。
3. **凭据**：优先 `setRuntimeApiKey`（内存）或 `InMemoryCredentialStore`；避免共享 `~/.pi/agent/auth.json`。凭据同步失败会抛 `CredentialSynchronizationError`（含 `providerId/operation/credential/cause`），不要盲目重试。
4. **并发**：一个 `AgentSession` 同时只跑一个 agent run；多用户请为每会话/每租户建独立 session（inMemory 或独立 sessionDir）。
5. **会话替换后**必须重新订阅事件、重新绑定扩展（`runtime.session` 已换新实例）。
6. **模型目录网络刷新**：`ModelRuntime.create()` 默认不联网；需刷新用 `allowModelNetwork: true` + `modelRefreshTimeoutMs`，或 `PI_OFFLINE` 强制离线。SDK 应用应自设 deadline（`AbortSignal.timeout`）。
7. **RPC 分帧**：严格按 `\n` 切分、容忍 `\r`，勿用会把 U+2028/2029 当换行的通用行读取器。
8. **Windows**：用 `powershell` 工具替代 `bash`；参见官方 Windows 平台说明。
9. **升级兼容**：SDK 主入口导出面较广（见 sdk.md "Exports" 一节），但内部文件路径/类型可能随版本变化，嵌入代码尽量只依赖公共导出。

---

## 12. 参考链接

- 官方文档总入口：<https://pi.dev/docs/latest>
- SDK：<https://pi.dev/docs/latest/sdk> ｜ RPC：<https://pi.dev/docs/latest/rpc> ｜ JSON 模式：<https://pi.dev/docs/latest/json>
- 扩展：<https://pi.dev/docs/latest/extensions> ｜ 自定义 Provider：<https://pi.dev/docs/latest/custom-provider>
- 会话格式：<https://pi.dev/docs/latest/session-format> ｜ 包生态：<https://pi.dev/docs/latest/packages>
- 开发/结构：<https://pi.dev/docs/latest/development>
- GitHub：<https://github.com/earendil-works/pi>（`examples/sdk/`、`examples/extensions/`、`src/modes/rpc/rpc-client.ts`）
