# 深智蓝智能体平台 (WebOS) 前端系统架构与页面功能手册

本文档为接手 **深智蓝智能体平台（AI-System）** 前端工程的系统级说明文档，重点阐述系统“路由/窗口调度机制”以及全部核心业务功能页面的详细说明。

---

## 1. 前端技术栈概览

* **核心框架**：React 19 (`react` + `react-dom`)
* **开发语言**：TypeScript (`strict` 模式)
* **构建工具**：Vite 7
* **样式方案**：Tailwind CSS 4
* **UI 组件与图标**：`lucide-react` 图标库、原生定制玻璃拟态 (Glassmorphism) 组件
* **图表可视化**：`recharts`
* **文档与多媒体**：`react-markdown`, `remark-gfm`, `rehype-raw`, `docx-preview`, `react-pdf`, `xlsx`, `exceljs`
* **鉴权机制**：JWT Token (`localStorage` 驱动，结合 `RoleContext` 动态鉴权)

---

## 2. 路由与桌面窗口调度机制 (Router & Windowing)

本项目不同于传统的 URL 路径路由（如 `react-router-dom` 的多级页面跳转），而是采用了 **WebOS 仿真桌面操作系统架构**，提供沉浸式、多任务并行的窗口管理与标签页交互体验。

### 2.1 核心路由与状态管理文件
* **顶层状态机**：[`src/App.tsx`](file:///D:/zfz/ai-system/src/App.tsx)
  * 控制全局三态：`'login'` (登录页) $\leftrightarrow$ `'system'` (WebOS桌面) $\leftrightarrow$ `'sysadmin'` (独立系统配置中心)。
  * 集中管理全局 Token 监听与注销事件（`auth-unauthorized`、登出清理）。
* **桌面与窗口调度中心**：[`src/components/SystemInterface.tsx`](file:///D:/zfz/ai-system/src/components/SystemInterface.tsx)
  * **多窗口管理器 (Window Manager)**：支持多任务同时打开、窗口拖拽、最小化、最大化、多标签（Tab）横向合并与跨窗口拖拽分拆。
  * **分类文件夹 (Desktop Folders)**：桌面提供“系统配置”、“核心业务”、“产业赋能”、“专业工具”等分类卡片组。
  * **任务栏 (Mac Dock + Win11 Taskbar)**：支持常用应用固定 (Pin)、窗口快速切换与上下文右键菜单。
  * **桌面组件 (Widgets)**：集成时钟、天气、日历等实时小组件。
* **权限与角色分发 Context**：[`src/context/RoleContext.tsx`](file:///D:/zfz/ai-system/src/context/RoleContext.tsx) 与 [`src/config/permissionConfig.ts`](file:///D:/zfz/ai-system/src/config/permissionConfig.ts)
  * 从后端动态拉取当前登录角色的可访问模块列表 (`allowedApps`)，自动过滤用户桌面上无权限的应用图标。

---

## 3. 全量页面与模块功能说明清单

系统模块按业务分类组织，全部页面均支持在 WebOS 多窗口中以懒加载 (`React.lazy`) 方式独立运行：

### 一、 核心业务板块 (Core Business)

| 模块名称 | 标识符 (`id`) | 源码文件 | 功能详细说明 |
| :--- | :--- | :--- | :--- |
| **市场洞察** | `market` | [`src/components/MarketInsightModule.tsx`](file:///D:/zfz/ai-system/src/components/MarketInsightModule.tsx) | 基于 AI 工作流对美妆护肤品类、行业热度、飙升概念、消费者痛点及竞品趋势进行全方位分析，生成结构化洞察报告。 |
| **营销预测** | `prediction` | [`src/components/PredictionModule.tsx`](file:///D:/zfz/ai-system/src/components/PredictionModule.tsx) | 包含基线数据矩阵、月度与季度销量预测、偏差预警分析（[`DeviationAlertPanel.tsx`](file:///D:/zfz/ai-system/src/components/DeviationAlertPanel.tsx)）以及智能产销预测模型。 |
| **客户分析** | `customer` | [`src/components/CustomerAnalysisModule.tsx`](file:///D:/zfz/ai-system/src/components/CustomerAnalysisModule.tsx) | 客户画像沉淀、客群分层分级（RFM模型）、生命周期价值分析、高价值客户流失预警及定向维系策略建议。 |
| **营销分析** | `marketing_analysis` | [`src/components/MarketingAnalysisModule.tsx`](file:///D:/zfz/ai-system/src/components/MarketingAnalysisModule.tsx) | 营销大盘监控、各投放渠道 ROI 效果对比分析、活动转化跟踪，并支持基于经营数据的 AI 智能对话分析。 |
| **复盘搭子** | `review_partner` | [`src/components/ReviewPartnerModule.tsx`](file:///D:/zfz/ai-system/src/components/ReviewPartnerModule.tsx) | 涵盖广告位复盘、小程序留存复盘、订单转化漏斗、流水对账以及 AI 驱动的阶段性经营复盘总结。 |
| **业务看板** ⭐ *(本次新增)* | `business_dashboard` | [`src/components/BusinessDashboardModule.tsx`](file:///D:/zfz/ai-system/src/components/BusinessDashboardModule.tsx) | 全景业务经营大盘，集成 GMV、订单量、客单价、转化率等核心 KPI，支持营收走势、品类结构、转化漏斗、渠道贡献排行与 AI 智能经营诊断。 |

---

### 二、 产业赋能板块 (Industrial Empowerment)

| 模块名称 | 标识符 (`id`) | 源码文件 | 功能详细说明 |
| :--- | :--- | :--- | :--- |
| **每日推送** | `news` | [`src/components/DailyNewsModule.tsx`](file:///D:/zfz/ai-system/src/components/DailyNewsModule.tsx) | 每日自动抓取美妆个护行业早报、前沿资讯、竞品动态，通过大模型提炼核心要点并进行桌面角标与通知提醒。 |
| **电商生图** | `aiimage` | [`src/components/AIImageModule.tsx`](file:///D:/zfz/ai-system/src/components/AIImageModule.tsx) | 文生图、商品一键换背景、商拍场景图渲染、AI 模特试衣与批量商品主图/详情图智能生成。 |
| **出海营销** | `seamarketing` | [`src/components/SEAMarketingModule.tsx`](file:///D:/zfz/ai-system/src/components/SEAMarketingModule.tsx) | 面向跨境出海业务，提供多语言商品详情文案生成、海外社交媒体（TikTok/Instagram等）营销脚本与本地化策略。 |
| **美妆研发** | `beautyrnd` | [`src/components/BeautyRnDModule.tsx`](file:///D:/zfz/ai-system/src/components/BeautyRnDModule.tsx) | 化妆品配方智能分析、成分安全性检测、功效宣称合规校验、打样进度跟踪及研发知识库检索。 |

---

### 三、 专业工具板块 (Professional Tools)

| 模块名称 | 标识符 (`id`) | 源码文件 | 功能详细说明 |
| :--- | :--- | :--- | :--- |
| **知识库** | `rules` | [`src/components/KnowledgeBaseModule.tsx`](file:///D:/zfz/ai-system/src/components/KnowledgeBaseModule.tsx) | 企业制度与知识库检索系统，支持制度问答、RAG 向量检索与智能公文规范问答。 |
| **版式对比** | `layoutcompare` | [`src/components/LayoutCompareModule.tsx`](file:///D:/zfz/ai-system/src/components/LayoutCompareModule.tsx) | 包装盒打样、说明书设计稿与合规稿的图像/PDF差异比对，智能标记图文修改点。 |
| **合同审核** | `contractaudit` | [`src/components/ContractAuditModule.tsx`](file:///D:/zfz/ai-system/src/components/ContractAuditModule.tsx) | 智能解析合同文本，自动审查风险条款、违约责任漏洞、账期风险并给出合规修改建议。 |
| **订单识别** | `orderrecognition` | [`src/components/OrderRecognitionModule.tsx`](file:///D:/zfz/ai-system/src/components/OrderRecognitionModule.tsx) | 基于 OCR 与结构化大模型，识别出货单、纸质订单、采购单，自动解析并提取字段录入。 |
| **资质管理** | `qualification` | [`src/components/QualificationModule.tsx`](file:///D:/zfz/ai-system/src/components/QualificationModule.tsx) | 生产许可证、检测报告、授权证明等资质电子化建档与到期自动预警。 |
| **文档文案** | `doccopywriting` | [`src/components/DocCopywritingModule.tsx`](file:///D:/zfz/ai-system/src/components/DocCopywritingModule.tsx) | 营销公文、产品软文、活动策划案一键起草与润色。 |
| **风险检测** | `riskdetection` | [`src/components/RiskDetectionModule.tsx`](file:///D:/zfz/ai-system/src/components/RiskDetectionModule.tsx) | 广告法违禁词检测、极限词过滤与全平台宣称合规性检测。 |
| **视频生成** | `videogen` | [`src/components/VideoGenerationModule.tsx`](file:///D:/zfz/ai-system/src/components/VideoGenerationModule.tsx) | 根据文案或脚本快速生成商品短视频、分镜脚本与口播视频素材。 |
| **隐患检测** | `hazarddetection` | [`src/components/HazardDetectionModule.tsx`](file:///D:/zfz/ai-system/src/components/HazardDetectionModule.tsx) | 生产车间安全规范排查、质检隐患识别与图文证据标注。 |
| **发票校验** | `invoiceverify` | [`src/components/InvoiceVerifyModule.tsx`](file:///D:/zfz/ai-system/src/components/InvoiceVerifyModule.tsx) | 发票真伪查验、发票抬头与税号校验、查重与报销合规审查。 |
| **商品库录入** | `productentry` | [`src/components/ProductEntryModule.tsx`](file:///D:/zfz/ai-system/src/components/ProductEntryModule.tsx) | 商品 SKU 资料批量录入、条码关联与多规格参数结构化维护。 |
| **招标检索** | `tendersearch` | [`src/components/TenderSearchModule.tsx`](file:///D:/zfz/ai-system/src/components/TenderSearchModule.tsx) | 全国招投标项目全网检索、商机挖掘、标书关键参数解析。 |
| **选品策略** | `productselectionstrategy` | [`src/components/ProductSelectionStrategyModule.tsx`](file:///D:/zfz/ai-system/src/components/ProductSelectionStrategyModule.tsx) | 结合市场热度与供应链成本的选品决策模型与毛利测算。 |
| **选品库** | `productLibrary` | [`src/components/ProductLibraryModule.tsx`](file:///D:/zfz/ai-system/src/components/ProductLibraryModule.tsx) | 备选商品沉淀仓库、供应商样品管理与评分体系。 |
| **核查报价** | `quoteverify` | [`src/components/QuoteVerifyModule.tsx`](file:///D:/zfz/ai-system/src/components/QuoteVerifyModule.tsx) | 多供应商报价比对、历史采购成本偏差核查与异常拦截。 |
| **大客户档案** | `keyaccount` | [`src/components/KeyAccountModule.tsx`](file:///D:/zfz/ai-system/src/components/KeyAccountModule.tsx) | KA 客户全生命周期建档、跟进记录与合作项目全景图。 |
| **投标助手** | `bidassistant` | [`src/components/BidAssistantModule.tsx`](file:///D:/zfz/ai-system/src/components/BidAssistantModule.tsx) | 标书偏离表提取、投标方案生成与资质匹配度核验。 |

---

### 四、 系统配置与管理板块 (System Administration)

| 模块名称 | 标识符 (`id`) | 源码文件 | 功能详细说明 |
| :--- | :--- | :--- | :--- |
| **用户管理** | `usermanage` | [`src/components/UserManageModule.tsx`](file:///D:/zfz/ai-system/src/components/UserManageModule.tsx) | 系统账号列表、新建用户、启用/禁用、重置密码及角色指派。 |
| **权限管理** | `permissions` | [`src/components/PermissionModule.tsx`](file:///D:/zfz/ai-system/src/components/PermissionModule.tsx) | 角色定义、模块访问矩阵权限分配、操作权限细粒度控制。 |
| **个人中心** | `profile` | [`src/components/ProfileModule.tsx`](file:///D:/zfz/ai-system/src/components/ProfileModule.tsx) | 个人资料维护、修改密码、头像上传与个性化偏好设置。 |
| **操作日志** | `auditlog` | [`src/components/AuditLogModule.tsx`](file:///D:/zfz/ai-system/src/components/AuditLogModule.tsx) | 全局用户登录、敏感操作审计与安全日志审计溯源。 |
| **系统配置中心** | `sysadmin` (独立全屏) | [`src/components/SystemConfigCenter.tsx`](file:///D:/zfz/ai-system/src/components/SystemConfigCenter.tsx) | 实施/运维人员专用，包含数据字典、AI 模型端点、标签分类与配置同步生产库功能。 |

---

### 五、 全局公共组件与支撑服务

* **数字员工助手 (Digital Employee)**：[`src/components/DigitalEmployee.tsx`](file:///D:/zfz/ai-system/src/components/DigitalEmployee.tsx) - 全局悬浮 AI 智能助手，支持语音对话与业务答疑。
* **通知中心 (Notification Center)**：[`src/components/NotificationCenter.tsx`](file:///D:/zfz/ai-system/src/components/NotificationCenter.tsx) - 接收系统告警、日报推送提醒及资质到期通知。
* **登录认证屏幕**：[`src/components/LoginScreen.tsx`](file:///D:/zfz/ai-system/src/components/LoginScreen.tsx) - 动态背景、JWT 登录校验与首次登录引导。
* **错误隔离边界**：[`src/components/ErrorBoundary.tsx`](file:///D:/zfz/ai-system/src/components/ErrorBoundary.tsx) - 窗口级异常隔离，防止单一模块报错引发整个桌面崩溃。

---

## 4. 本次“业务看板”入口新增记录

1. **入口位置**：系统桌面“核心业务”卡片组，排在第 3 行第 2 列（“复盘搭子”右侧红圈位置）。
2. **图标与样式**：采用 `LayoutDashboard` 仪表盘图标，配以青蓝至宝蓝的高级科技感渐变色（`bg-gradient-to-br from-cyan-500 to-blue-600`）。
3. **版本升级**：将桌面布局版本提升至 `v4.4`，确保客户端自动刷新并正确展示新卡片。
4. **组件实现**：新建 [`src/components/BusinessDashboardModule.tsx`](file:///D:/zfz/ai-system/src/components/BusinessDashboardModule.tsx)，具备 GMV、订单量、客单价、转化率卡片、双轴走势图、品类占比饼图、转化漏斗、渠道效能排行与 AI 智能经营诊断等全量数据看板能力。
