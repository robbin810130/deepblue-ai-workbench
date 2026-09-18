# AGENTS.md

This file provides guidance to Qoder (qoder.com) when working with code in this repository.

## 项目概述

**深蓝企业智慧中枢 (WebOS Pro)** — 单仓双端的企业级 Web 应用。前端 React + TypeScript + Vite，后端 Node.js + Express，数据库 PostgreSQL。通过 Dify 平台集成 20+ 个 AI 工作流，覆盖市场洞察、营销预测、客户分析、合同审核、物料报价、电商生图、会议纪要、发票校验、风险检测等业务场景。

## 常用命令

```bash
# 安装依赖
npm install

# 开发模式（前端 8081 + 后端 3001 同时启动）
npm run dev:all

# 单独启动
npm run dev       # 仅前端 (Vite, port 8081)
npm run server    # 仅后端 (Express, port 3001)

# 数据库初始化（执行 database/ 下的 SQL 文件）
npm run db:init

# 生产构建
npm run build     # TypeScript 编译 + Vite 打包

# PM2 生产部署
pm2 start ecosystem.config.cjs

# 代码检查
npm run lint
```

## 环境配置

1. 复制 `.env.example` 为 `.env`
2. **必须配置** PostgreSQL 连接：`PG_HOST`, `PG_PORT`, `PG_DATABASE`, `PG_USER`, `PG_PASSWORD`（或直接使用 `DATABASE_URL`）
3. **按需配置** Dify API 密钥：每个 AI 模块有独立的 `DIFY_*_API_KEY` 和 `DIFY_*_API_URL`
4. **可选** 阿里云百炼 (DashScope)、百度智能云等第三方密钥

### 首次启动注意

- `npm run db:init` 只创建业务表（基础资料、AI 生图、知识库、报价模拟、种子数据）
- **用户表** (`sys_users`, `sys_roles`, `sys_user_sessions` 等) 由后端 `server.js` 的 `runInitDDL()` 函数在首次启动时自动创建（幂等 DDL）
- 如果 `runInitDDL()` 因 `sys_users` 不存在而失败，需先手动执行迁移：
  ```bash
  # 先创建用户表
  node -e "import pool from './server/db.js'; import fs from 'fs'; pool.query(fs.readFileSync('./server/migrations/001_create_sys_users.sql','utf8')).then(()=>pool.query(fs.readFileSync('./server/migrations/002_create_sys_roles.sql','utf8'))).then(()=>{console.log('done');pool.end()})"
  # 重启后端即可触发 runInitDDL() 完成剩余表创建
  ```
- 默认登录账号：`admin` / `123123`（管理员），`user` / 对应密码（普通用户）

## 架构说明

### 前端架构

- **入口链路**: `src/main.tsx` → `src/App.tsx`（唯一路由壳，按 AppState 切换 login / system / sysadmin）
- **模块懒加载**: `SystemInterface.tsx` 中通过 `React.lazy()` 动态导入各业务模块组件
- **权限 Context**: `src/context/RoleContext.tsx` 全局管理角色与模块访问权限
  - `admin` 角色自动获得全量权限 `['*']`
  - 其他角色从后端 `/api/admin/my-permissions` 动态加载允许访问的 appId 列表
- **认证机制**: JWT Token 存于 `localStorage('blue_os_token')`，`src/utils/authFetch.ts` 统一封装请求鉴权与 401/403 自动登出
- **API 端点集中声明**: `src/config.ts` 定义所有 `/api/*` 代理端点，前端不直接调用外部 AI 服务
- **权限元数据**: `src/config/permissionConfig.ts` 的 `APP_META` 声明所有模块的 label 和 category
- **类型定义**: `src/types/index.ts` 定义 `ModuleType`（所有模块标识）和 `AppState`

### 后端架构

- **主服务**: `server/server.js`（5000+ 行单文件），包含所有内联路由和 DDL 初始化
- **数据库连接**: `server/db.js` 导出 PostgreSQL 连接池（优先 `DATABASE_URL`，回退分项配置），强制 `PGTZ=Asia/Shanghai`
- **独立路由模块**:
  - `server/userAdminRoutes.js` → `/api/admin/*` 用户与角色管理
  - `server/configAdminRoutes.js` → 系统配置中心
  - `server/hazardDetectionRoutes.js` → `/api/hazard-detection/*` 隐患检测
  - `server/knowledgeAdminRoutes.js` → `/api/knowledge/*` 知识库管理
- **服务层**:
  - `server/services/pricingAnalysisService.js` — 物料报价分析
  - `server/services/difyKnowledgeService.js` — Dify 知识库对接
  - `server/utils/aiUtils.js` — 智能品牌提取
  - `server/utils/maskingUtils.js` — 姓名/金额/手机/品牌脱敏工具

### 关键设计模式

1. **AI 代理转发**: 前端 → 后端 `/api/*` → Dify/DashScope/百度 API，密钥仅存后端 `.env`
2. **数据脱敏**: 非 admin 访问 `sales_analysis_matrix.json` 等敏感数据时，后端自动调用品牌字典遮罩
3. **文件上传**: multer 磁盘存储，临时目录 `tmp/uploads`，最终目录 `public/uploads/{module}/`
4. **速率限制**: 全局 120次/分钟 (`globalLimiter`)，AI 服务 20次/分钟 (`coreServicesLimiter`)
5. **会话管理**: JWT 内嵌 `jti`，配合 `sys_user_sessions` 表实现会话吊销、并发限制（上限 5 个活跃会话）
6. **自动 DDL**: `runInitDDL()` 在服务启动时幂等创建所有业务表（sessions、brand_dictionary、qualifications、audit_logs、meeting_minutes、doc_drafting、beauty_rnd_versions 等）
7. **审计日志**: `logAudit()` 函数记录登录/操作日志到 `sys_audit_logs` 表

### Dify 工作流集成模式

所有 Dify 工作流遵循统一对接模式：
- **文件上传中转**: 前端上传文件到后端 → 后端转发至 Dify `/v1/files/upload` → 提取 `upload_file_id` → 传入工作流
- **工作流调用**: 后端携带 API Key 调用 Dify `/v1/chat-messages` 或 `/v1/workflows/run`
- **文件参数格式**: `inputs` 中的文件字段必须直接为文件对象数组，**不能**包裹在 `{value: [...]}` 结构中（否则 400 错误）
- **多文件参数**: 如发票校验需同时传 `invoice_files` 和 `statement_files`，二者独立为 `file` 类型字段

### 数据库表结构

| 类别 | 主要表 |
|------|--------|
| 系统 | `sys_users`, `sys_roles`, `sys_user_sessions`, `sys_audit_logs` |
| 业务参考 | `ref_news_keywords`, `ref_product_types`, `ref_target_markets`, `ref_certifications`, `ref_platforms`, `ref_marketing_styles`, `ref_pain_point_tags`, `ref_languages` |
| AI/内容 | `app_news_history`, `app_news_preferences`, `brand_dictionary` |
| 资质管理 | `sys_qual_categories`, `sys_qualifications` |
| 会议纪要 | `sys_meeting_minutes` |
| 文档起草 | `sys_doc_drafting` |
| 美妆研发 | `sys_beauty_rnd_versions` |
| 报价模拟 | `mock_quote_*` 系列表 |
| 知识库 | Dify 远程管理，本地无表 |

### Python 脚本

`scripts/` 下的 Python 脚本由后端通过 `child_process.spawn` 调用：
- `a2_integrated_forecasting.py` — 综合预测
- `a3_customer_analysis.py` — 客户分析
- `a4_marketing_analysis.py` — 营销分析
- `generate_image.py` — 豆包 Seedream 图像生成
- `import_excel_to_pg.py` — Excel 数据导入 PostgreSQL

## 新增模块开发流程

添加新业务模块需修改以下文件（固定模式）：

1. **前端组件**: 在 `src/components/` 创建 `XxxModule.tsx`，导出命名组件
2. **模块注册**: 在 `src/config/permissionConfig.ts` 的 `APP_META` 中添加模块元信息（label + category）
3. **类型声明**: 在 `src/types/index.ts` 的 `ModuleType` 联合类型中添加模块标识
4. **懒加载挂载**: 在 `src/components/SystemInterface.tsx` 中添加 `React.lazy()` 导入和渲染逻辑
5. **API 端点**: 在 `src/config.ts` 中声明后端代理端点
6. **后端路由**: 在 `server/server.js` 中添加路由处理（内联或新建路由文件）
7. **Dify 配置**: 在 `.env.example` 中添加对应的 `DIFY_*_API_KEY` 和 `DIFY_*_API_URL`

## 需求文档规范

需求文档位于 `require/` 目录，以 `layout_compare_require.txt` 为标准模板，包含四个固定章节：
1. 功能描述
2. 核心流程
3. 视觉优化需求
4. 技术实现

## 开发注意事项

1. **端口**: 前端 8081，后端 3001；Vite 代理将 `/api` 转发到 `http://127.0.0.1:3001`
2. **时区**: 后端强制 `PGTZ=Asia/Shanghai`，日志时间戳使用 UTC+8
3. **大文件**: 音频上传最大 400MB，使用磁盘存储（非内存）
4. **静态资源**: 生产环境同时服务 `public/` 和 `dist/` 目录
5. **日志**: winston 输出到 `logs/error.log` 和 `logs/combined.log`
6. **ESM 模块**: 项目使用 `"type": "module"`，所有 `.js` 文件使用 `import/export` 语法，不可使用 `require()`
7. **Windows 兼容**: 开发环境为 Windows，PowerShell 中不能用 `&&` 连接命令，用 `;` 代替
8. **Token 生命周期**: 2 小时过期，刷新/关闭浏览器时通过 `sendBeacon` 自动吊销会话
