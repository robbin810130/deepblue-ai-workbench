# 后端核心模块（平台重构 M1/M2）

> 对应《07_后端服务拆分设计》的 `catalog` 与 `providers` 两个模块，以及《03_API接口规范》的 `/api/v1` 接口层。
> **原则：只新增，不改存量** —— server.js 仅增加 4 行接入代码，其余全部在本目录内自洽。

## 目录结构

```
server/
├── modules/
│   ├── catalog/                # M1 技能目录（业务场景 + 技能注册表）
│   │   ├── scenes.js           # 场景封闭枚举：6 业务场景 + 1 系统分类（唯一权威）
│   │   ├── skillTypes.js       # Manifest 字段规范：枚举常量 + 类型模式
│   │   ├── validator.js        # 启动期校验：key 唯一/snake_case/schema 必填/binding 存在
│   │   ├── registry.js         # 运行时注册表：查询/筛选/统计/输入校验/toApiShape
│   │   ├── index.js            # 模块出口
│   │   └── skills/             # 39 条 Skill Manifest（按场景分 7 文件）
│   │       ├── marketCustomer.js      市场与客户 (7)
│   │       ├── contractTender.js      合同与招投标 (5)
│   │       ├── productSupply.js       商品与供应链 (9)
│   │       ├── contentMarketing.js    内容与营销 (6)
│   │       ├── enterpriseKnowledge.js 企业知识 (6)
│   │       ├── businessAnalysis.js    经营分析 (2)
│   │       └── system.js              系统类 (4)
│   ├── providers/              # M2 Provider 适配层（AI 供应商唯一出口）
│   │   ├── bindings.js         # WorkflowBinding 注册表：workflowKey → env/版本/超时
│   │   ├── difyClient.js       # Dify HTTP 客户端（全平台唯一出口，重试按文档 04 §8）
│   │   ├── normalizer.js       # 输出归一化：收敛 N 种 outputs 写法 → 标准结果
│   │   ├── difyProvider.js     # WorkflowProvider 接口实现
│   │   ├── arkProvider.js      # 火山方舟（电商生图等非 Dify 能力）
│   │   └── index.js            # 统一入口 + 绑定体检 healthCheck()
│   ├── common/
│   │   ├── errors.js           # 标准错误码（文档 03 §11）
│   │   └── apiResponse.js      # 标准响应体 + trace_id + asyncHandler + v1 错误中间件
│   └── selftest.js             # 模块自检（24 项断言）
└── routes/v1/
    └── catalogRoutes.js        # /api/v1 场景与技能接口（文档 03 §4）
```

## 接入方式（server.js 中的全部改动）

```js
// 1) import 区新增 2 行
import catalogRoutesV1 from './routes/v1/catalogRoutes.js';
import { v1ErrorHandler } from './modules/common/apiResponse.js';

// 2) 全局鉴权之后新增 2 行
app.use('/api/v1', catalogRoutesV1);
app.use('/api/v1', v1ErrorHandler());
```

## /api/v1 接口一览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/scenes?with_skills=&business_only=` | 场景清单 |
| GET | `/api/v1/scenes/:sceneKey` | 场景详情 + 技能 |
| GET | `/api/v1/skills?scene=&query=&live=&business_only=` | 技能检索 |
| GET | `/api/v1/skills/:skillKey` | 技能定义 + Schema + 权限状态 |
| POST | `/api/v1/skills/:skillKey/prepare` | 提交前输入校验（缺什么当场告诉前端） |
| GET | `/api/v1/health/skills` | 注册表统计 + 校验结果（运维用） |

响应统一为 `{ success, data, trace_id, meta }` / `{ success: false, error: { code, message, detail }, trace_id }`。
错误码：`VALIDATION_FAILED`(422) / `RESOURCE_NOT_FOUND`(404) / `PROVIDER_TIMEOUT`(504) 等，见 `common/errors.js`。

鉴权：挂载在全局 `authenticateToken` 之后，所有接口天然要求登录。

## 关键设计决策

1. **Skill Key 一律 snake_case**（文档 09 §7 原文，如 `contract_review`），与旧草案的 kebab-case 不同，以文档为准。
2. **场景是封闭枚举**（S1 决策）：第 7 个业务场景出现即启动报错，防止绕过目录私挂功能。
3. **幽灵技能显式登记 `live: false`**：5 个做完未开放的技能（物料报价/会议纪要/数字员工/文档起草/制度问答）在册但不可见，开放时改一个布尔值。
4. **多 Provider 支持**：电商生图走火山方舟（`ARK_API_KEY`）而非 Dify，bindings 里如实登记，不假装一切皆 Dify。
5. **`base_url` 自动归一 + 补 `/v1`**：环境变量带不带 `/chat-messages`、带不带 `/v1` 都能正确拼路径（现状同一变量两种写法的根治）。
6. **pending 绑定显式暴露**：4 个绑定待确认（bid_assistant / order_recognition / doc_copywriting / order_suggestion），`healthCheck()` 里可见，不静默失败。
7. **权限状态不假装**：`permission_status: 'not_evaluated'`，待 M6 技能表接管权限语义后再启用真实判定。

## 自检与验证

```bash
# 模块自检（无需数据库，24 项断言）
node server/modules/selftest.js

# 真实 HTTP 冒烟（曾验证：无 token 401 / 场景清单 / live=false 筛出 5 幽灵 /
# 404 标准错误体 / prepare 422 / X-Trace-Id 透传 / health 统计）
```

## 下一步（M3+）

- 任务中心（tasks 模块）：任务八态状态机 + prepare → create → execute 链路
- 文件暂存层：平台先存自身对象存储再上传 Dify（文档 04 §7）
- M6 权限模型：permission_code + 数据范围，替换 `not_evaluated` 占位

---

## M3 任务中心（server/modules/tasks/）

- **states.js** 八态状态机唯一权威：draft → queued → running → waiting_confirmation → succeeded → archived，异常分支 failed/cancelled；迁移走一张表，业务代码禁止散落字符串比较。
- **taskStore.js** 四表自建 DDL：`tasks / task_runs / task_events / task_artifacts`（启动时 `ensureTasksTables()`，无需迁移工具）；任务编号 `AI-YYYYMMDD-XXXXXX`。
- **taskService.js** 编排：execute / cancel / confirm / reject / retry / rerun / archive；重试新建 run_no+1 不覆盖旧 Run；async 技能后台执行（HTTP 立即返回）、blocking 同步等待；越权 403。

接口（12 端点）：`GET /api/v1/tasks`（状态/场景筛选 + q 搜索）、`GET /api/v1/tasks/:id`（含事件时间线 + Run 记录）、`POST /api/v1/tasks`（execute_now 直通 queued）、`POST .../{execute,cancel,confirm,reject,retry,rerun,archive}`、`PATCH/DELETE`（草稿）、`GET /api/v1/tasks/metrics`（PRD §11 指标）。

---

## M4 文件暂存 + 通知 + 权限先行版

- **files/fileStore.js**：上传暂存（multer → `TASK_STORAGE_DIR`，默认 `<repo>/server/storage/tasks`）→ `staged_files` 表登记；执行时 `loadStagedBuffers()` 水合进 Provider；产物落 `task_artifacts` + 磁盘。**签名下载**：`GET /api/v1/files/download?kind&id&exp&sig`（HMAC-SHA256 + 10 分钟有效期，PRD §9），挂在 JWT 白名单里（签名即凭证）；`assertCanAccessFile` 做归属校验（创建人/被分配人/admin）。
- **notifications/notify.js**：`task_notifications` 表；PRD §8 四类事件（完成/失败/待确认+待办/被分配+待办）在 taskService 挂钩；接口 `GET /api/v1/notifications`、`unread-count`、`/:id/read`、`read-all`、`/:id/complete-todo`。
- **permissions/evaluator.js**（M6 先行版）：`LEGACY_APP_MAP` 把 34 个技能映射回旧版权限模型 `sys_roles.permissions`（appId 数组，`*` 全量）；admin 直接放行；无映射/读取失败诚实返回 `not_evaluated`，不假装判定。

## 自检与验证（更新）

```bash
node server/modules/selftest.js   # 42 项断言：注册表/归一化/状态机/签名URL/权限映射
```

真实 HTTP 冒烟（内嵌 PostgreSQL 18 @ 127.0.0.1:5599，20 项全过）：上传 → 签发 URL → 无 JWT 签名下载 → 篡改 403 → 带文件任务创建即执行 → BINDING_INCOMPLETE 失败+事件流 → 失败通知+未读 → 重试新 Run（旧 Run 保留）→ 确认 → 归档 → 驳回原因必填 → 取消 → rerun 克隆 → 越权 403 → 指标端点 → admin 权限 granted。

## 下一步

- M6 正式权限模型：permission_code + 数据范围，替换 LEGACY_APP_MAP 映射
- 5 个幽灵技能的 WorkflowBinding 补齐与开放流程
- 存量化技能（34 应用旧路由）迁移到任务中心链路
