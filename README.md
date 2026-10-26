# 神谕 · 世界平衡台

当前产品迭代为 **0.2.0-alpha.1 · 本地内测**。新玩家使用 [玩家入口](http://localhost:3000/play)，开发调试使用 [六人模拟器](http://localhost:3000/mobile)，原世界平衡台仍保留。玩家入口提供玩法说明、角色选择、房间码加入/复制、刷新恢复和本机参与记录；上帝核心流程不变。

发行前本地质量检查：`npm run release:check`。这不等于公开发行验收，当前仍缺少账号鉴权、房间访问控制及微信真机验证。后续分阶段验收见 [发行路线与内测边界](docs/RELEASE_PLAN.md)。

新增 **Noah’s Rescue 微信小程序本地版 + 六人手机模拟器**。原世界平衡台保留不变，新入口是 [http://localhost:3000/mobile](http://localhost:3000/mobile)。小程序源码在 `miniprogram/`；详见 [手机端开发、测试与迭代手册](docs/MOBILE_LOCAL.md)。

手机端已实现固定六角色 3v3、六人准备开局、两队及世界三维分数、五类神谕任务、汇报与驳斥、人工确认奖惩、重复召唤、退出重连、结束归档与历史详情。`npm run dev:mock` 可完全离线演示，`npm run test:multiplayer` 可隔离运行六人 HTTP 流程测试。原上帝流程继续复用，提示词仍由专用数据后端管理。

现在可直接点击 **“一键测试开局”**：自动安排六个独立测试身份、加入同一局、全部准备并开始游戏。再次点击会续接未结束的测试局，手动游戏不受影响。浏览器和原生小程序均已加入本地方舟角色、神谕插画。快速回归运行 `npm run test:quick`；详见 [快速试玩与本轮迭代](docs/QUICK_START.md) 和 [图片素材及生成提示词](docs/ART_ASSETS.md)。

一个可在 localhost 运行的世界状态模拟器。玩家可拖动经济、环境、社会三条属性（1—19），系统根据阈值触发或解除灾难，并通过可反驳的“上帝 Agent Loop”给出最终奖惩。

当前版本已提供 MiniMax Coding Plan 的 LLM 裁决适配器。未填写 API Key 时自动使用本地规则引擎；填写后仅把当前状态、随机上帝、RAG 证据和玩家反驳发送给 MiniMax。环保知识检索与 JSON 存档始终在本地完成。

## 当前可用功能

- 三条可鼠标拖动、触摸和键盘操作的属性条，值域固定为 1—19。
- 2 / 6 进入负向灾难区，14 / 18 进入正向灾难区；离开对应区间后灾难自动解除。
- 阈值状态会同步改变颜色、文案、边框与脉冲效果。
- 上帝 Agent Loop：读取状态 → 随机选择上帝 → 本地 RAG → 初步裁决 → 玩家反驳 → 最终奖惩 → JSON 归档。
- 上帝审判只由玩家点击界面按钮触发；完成裁决后可再次点击触发，每次都会创建独立会话并保留旧档案。
- 三种上帝人格：激进型、普通型、保守型；运行时 Prompt 来自独立的服务端数据后端，`god.md` 仅保留原始设计说明。
- 新版灾难目录依据 `卡牌.docx` 的 12 张卡，存于 `server/data/disasters.json`；旧版额外规则已移除。阈值仍为 2 / 6 / 14 / 18，每个维度每个非稳定分档当前对应一张卡。
- 灾难触发后同时展示卡图与完整效果，网页和微信小程序均可点击放大。卡图直接提取 Word 内嵌原图，保持原始约 5:7 比例，不沿用 Word 的拉伸尺寸。
- 审判档案保存状态快照、上帝、检索证据、初判、反驳、最终裁决和执行轨迹。
- 提供前端可调用的 HTTP API、MiniMax 模型适配层和 WebMCP 操作入口。

## 快速开始

要求 Node.js 22.13 或更高版本。

首次运行时安装前端依赖：

```bash
npm --prefix app install
```

仅在尚无 `.env` 时复制环境变量模板；已有文件不要覆盖：

```bash
cp .env.example .env
```

如需启用 MiniMax，在本地 `.env` 中只填写自己的密钥：

```dotenv
MINIMAX_API_KEY=你的_API_Key
```

`.env` 已加入 `.gitignore`，不会被 Git 提交；`.env.example` 只保留空值和非敏感配置。未填写密钥也可以完整运行和测试，此时上帝裁决自动使用确定性规则。

同时启动网站和本地 API：

```bash
npm run dev
```

然后访问 [http://localhost:3000](http://localhost:3000)。本地 API 默认为 `http://localhost:8787`。

如果需要分别调试：

```bash
npm run dev:web
npm run dev:api
```

## 测试与构建

```bash
npm test       # 原有引擎、房间规则、六人HTTP流程、小程序接线等
npm run test:multiplayer # 六人真实本地 HTTP 流程（模型模拟）
npm run typecheck # TypeScript 检查
npm run build  # 构建前端
npm run check  # 测试 + 类型检查 + 构建
npm run test:e2e # 真实浏览器操作（首次先在根目录 npm ci）
npm run test:quick # 一键开局专项：接口、失败重试、刷新续接、图片加载
npm run check:all # 全部检查，含浏览器
npm run release:check # 版本/忽略规则/已追踪敏感文件检查 + 全部回归
```

自动测试不依赖外网、外部数据库或真实 LLM，适合持续集成和快速回归；首次安装测试依赖需要网络，浏览器测试使用本地 HTTP 服务。

浏览器测试使用临时 API 和独立存档，不操作用户现有游戏；详细结果与修复说明见 [2026-09-19 测试迭代记录](docs/TEST_ITERATION_2026-09-19.md)。

## 架构

```text
玩家界面（Vinext / React / TypeScript）
  ├─ 属性控制与即时特效
  ├─ 灾难监测与审判档案
  └─ API Client / WebMCP
             │ HTTP JSON
本地 API（Node.js）
  ├─ World State + Disaster Engine
  ├─ God Router（随机人格）
  ├─ God Data Repository（每次读取最新 Prompt）
  ├─ Local RAG（Hash-256 embedding）
  ├─ MiniMax Verdict Adapter（Anthropic-compatible）
  ├─ Deterministic Verdict Fallback
  ├─ Rebuttal Loop
  └─ JSON Repository（原子替换写入）
```

关键目录：

```text
app/                    前端项目
  app/page.tsx          主工作台与交互
  app/globals.css       视觉主题、响应式与阈值特效
  lib/api.ts            类型化 API 客户端
server/
  src/server.js         HTTP API
  src/agent-loop.js     上帝编排、初判与反驳回路
  src/god-repository.js 上帝人格与 Prompt 数据仓库
  src/catalog.js        灾难规则、阈值引擎与旧存档卡牌刷新
  data/disasters.json   新版 12 张灾难卡名称、效果、分档（编辑后重启 API）
  data/disaster-art.json 卡图尺寸、文档图片索引与校验哈希
  src/rag.js            可替换的本地嵌入/检索接口
  src/llm/minimax.js    MiniMax 请求、结构化解析和安全降级
  src/storage.js        JSON 原子读写
  data/knowledge.json   测试环保知识
  data/gods.json        上帝人格与 Prompt 文件映射
  data/god-prompts/     三位上帝的完整运行时 Prompt
  data/state.json       当前世界状态
  data/judgments.json   完整审判档案
  test/                 功能测试
god.md                  原始上帝设定
disaster.md             新版灾难卡分档、效果与执行边界
```

## Agent Loop 设计

一次审判是一个有状态会话：

1. `read_state`：读取已保存的三属性和当前灾难。
2. `select_god`：随机选取激进、普通或保守上帝。
3. `load_god_prompt`：由 God Repository 从 `server/data/god-prompts/` 读取所选上帝的最新完整提示词。
4. `retrieve_knowledge`：把上帝价值观和世界状态组成查询，由本地检索器召回 3 条证据。
5. `initial_verdict`：把完整上帝提示词放入 System Prompt；有密钥时调用 MiniMax，失败时使用确定性规则。
6. `await_rebuttal`：等待玩家提交一次反驳。
7. `evaluate_rebuttal`：识别是否提出修复、补偿、合作等可核验方案。
8. `final_verdict`：重新从数据后端读取同一位上帝的最新完整提示词评估反驳；措辞和减免条件可变化，但最终奖惩永远存在。
9. `archive_json`：保存游戏交互会话，不把 Prompt 原文、文件路径或哈希复制进审判快照。

`trace` 字段保留每一步的状态与关键输出，未来接入真正的 agent runtime 后可以直接映射为可观测事件。

### 上帝 Prompt 数据后端

`god.md` 是设计文档，不参与运行时解析。实际 Prompt 分别保存在：

- `server/data/god-prompts/radical.txt`
- `server/data/god-prompts/balanced.txt`
- `server/data/god-prompts/conservative.txt`

`server/data/gods.json` 负责把上帝 ID 映射到 Prompt 文件。God Repository 在每次初判和终判前重新读取这些文件，因此修改数据后端中的 Prompt 后，下一次模型调用会立即使用新内容，不需要重启 API。Prompt 原文、文件路径和哈希都不会进入审判档案或前端 API。

## 本地 RAG

`LocalHashEmbeddingModel` 是当前的离线测试模型：把中英文词元和中文二元组散列为 256 维向量，再用余弦相似度排序。它的目标是先跑通“建索引—查询—召回—证据进入裁决—证据归档”的完整数据链路，不代表生产级语义质量。

升级时只需保持 retriever 的最小接口：

```js
{
  model: 'model-name',
  size: 123,
  search(query, limit) => [{ id, title, content, score }]
}
```

推荐的后续本地方案：Ollama embedding 模型 + SQLite/向量扩展，或独立的本地向量库。裁决模型也可以通过相同接口接入 Ollama；HTTP API 和前端不需要改变。

## MiniMax LLM 配置

适配器直接调用 MiniMax 的 Anthropic-compatible Messages API，不增加 SDK 依赖。默认配置适合国内账号：

```dotenv
MINIMAX_BASE_URL=https://api.minimaxi.com/anthropic
MINIMAX_MODEL=MiniMax-M3.0
MINIMAX_TIMEOUT_MS=60000
```

国际账号可将 `MINIMAX_BASE_URL` 改为 `https://api.minimax.io/anthropic`，模型名称也可通过 `MINIMAX_MODEL` 更新。服务启动时会从根目录 `.env` 读取配置。

模型适配器的最小职责是：

```js
{
  enabled: true,
  generateInitial(context) => Promise<InitialVerdict>,
  generateFinal(context) => Promise<FinalVerdict>
}
```

两个阶段都要求结构化 JSON，并校验标题、语气、陈述、分类和奖惩数组。请求失败不会中断游戏，而是记录不含密钥的失败原因并回退到规则裁决。最终裁决在服务端强制 `unavoidable: true`，保证玩家能反驳但上帝一定给出奖惩。

## HTTP API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 本地引擎、RAG 及 MiniMax 配置状态（不含密钥） |
| `GET` | `/api/state` | 当前世界状态和活动灾难 |
| `PUT` | `/api/state` | 保存三属性并重新计算灾难 |
| `GET` | `/api/judgments` | 按时间倒序读取审判档案 |
| `POST` | `/api/judgments` | 触发一次新审判，进入等待反驳状态 |
| `POST` | `/api/judgments/:id/rebuttal` | 提交反驳并生成最终裁决 |

属性更新请求示例：

```json
{
  "attributes": {
    "economy": 14,
    "environment": 8,
    "society": 11
  }
}
```

## JSON 数据与安全

- `state.json` 保存原工作台状态；`judgments.json` 保存原工作台审判；`rooms.json` 独立保存多人游戏、角色、完整神谕交互与分数事件。三者都是被 Git 忽略的运行数据。
- 写入采用“临时文件 + rename”的原子替换，降低进程中断造成半个 JSON 文件的风险。
- API Key 只从本地环境变量读取，不进入请求日志、响应或审判 JSON；`.env` 与 `server/.env` 均被 Git 忽略。
- 审判档案只保存模型名、是否成功使用模型及安全化的回退原因，便于调试而不泄露凭证。
- 可用 `GAME_DATA_DIR` 把运行数据放到其他绝对路径，方便测试隔离和服务器挂载持久卷。
- 当前是单机单进程原型。部署到多实例服务器前应把 repository 替换为 SQLite/PostgreSQL，并增加事务、鉴权和并发控制。
- 当前 CORS 只允许 `http://localhost:3000`。正式部署时应改为实际可信域名。

## 敏捷开发路线

### Sprint 0（已完成）：可运行骨架

- 项目结构、开发命令、视觉主题、本地 API、JSON repository。

### Sprint 1（已完成）：核心纵向切片

- 三属性交互、阈值灾难、上帝随机路由、本地 RAG、反驳、最终奖惩、档案查看与自动测试。

### Sprint 2（本地版已实现）：游戏行为与多人状态

- 六角色房间、最近行为、双方及世界分数、五类任务、确认结算、历史和重连。
- 小程序 + 共用控制器的六人手机模拟器；并发、幂等与完整 HTTP 流程测试。
- 地块、资源实体、灾难副作用自动扣分与事件重放仍待正式玩法定义。

### Sprint 2.5（已完成）：MiniMax 裁决接口

- Anthropic-compatible MiniMax 适配器、结构化输出校验、超时和规则降级。
- 初判与反驳后终判均经过同一个 Agent Loop，调用信息写入本地档案但不保存密钥。

### Sprint 3（建议）：本地模型与增强检索

- Ollama embedding 与本地向量库。
- Ollama 裁决适配器，与 MiniMax/规则引擎运行时切换。
- 检索证据与模型参数可追溯；Prompt 继续由数据后端管理，不复制原文或哈希到审判快照。

### Sprint 4（建议）：服务器化

- 数据库迁移、账号/房间权限、服务端事件流、审计日志。
- Docker/部署配置、健康检查、备份恢复和负载测试。

每个 Sprint 都保持 `npm run check` 可通过，并先交付一条可演示的端到端路径，再扩展规则覆盖面。

## 已知边界

- MiniMax 输出依赖网络和账号额度；未配置或调用失败时会明确降级为规则引擎。
- 玩家行为历史尚未建模，初判只使用当前三属性和灾难快照；接口中已保留 `stateSnapshot` 与 `player`。
- 灾难文本已结构化，但资源、手牌、移动等效果尚未连接到完整桌游状态机。
- JSON 适合本地原型和单用户调试，不适合多实例并发写入。
