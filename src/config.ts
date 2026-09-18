// ===== 应用品牌配置（读取 .env 中的 VITE_APP_TITLE） =====
export const APP_TITLE = import.meta.env.VITE_APP_TITLE || "深智蓝智能体平台软件";

// ===== 后端API配置 =====
// 留空则使用相对路径 (即当前访问的域名和端口)，这样无论是开发(代理)还是生产都能正常工作
export const API_BASE_URL = "";

// ===== AI 工作流 API 代理端点（通过后端转发，Key不暴露在前端）=====
export const AI_WORKFLOW_UPLOAD_ENDPOINT = `${API_BASE_URL}/api/ai-workflow/upload`;
export const AI_WORKFLOW_RUN_ENDPOINT = `${API_BASE_URL}/api/ai-workflow/run`;

// ===== 智能解析 API 配置（通过后端转发） =====
// AI 分析功能使用后端 API，Key 保存在后端 .env 中，前端不暴露
export const AI_ANALYSIS_ENDPOINT = `${API_BASE_URL}/api/ai-analysis`;

// ===== 公司制度问答助手 API 配置（通过后端转发） =====
export const API_RULES_ASSISTANT_BASE = `${API_BASE_URL}/api/rules`;

// ===== 每日推送 API 配置（通过后端转发） =====
export const API_NEWS_BASE = `${API_BASE_URL}/api/news`;

// ===== 市场洞察分析配置（专用于多维分析） =====
export const AI_MARKET_INSIGHT_RUN_ENDPOINT = `${API_BASE_URL}/api/market-insight/run`;
export const AI_MARKET_INSIGHT_UPLOAD_ENDPOINT = `${API_BASE_URL}/api/market-insight/upload`;

// ===== 合同审核分析配置 =====
export const AI_CONTRACT_AUDIT_RUN_ENDPOINT = `${API_BASE_URL}/api/contract-audit/run`;
export const AI_CONTRACT_AUDIT_UPLOAD_ENDPOINT = `${API_BASE_URL}/api/contract-audit/upload`;

// ===== 物料智能报价分析配置 =====
export const AI_MATERIAL_QUOTE_RUN_ENDPOINT = `${API_BASE_URL}/api/material-quote/run`;
export const AI_MATERIAL_QUOTE_UPLOAD_ENDPOINT = `${API_BASE_URL}/api/material-quote/upload`;

// ===== 数字员工助手配置 =====
export const AI_DIGITAL_EMPLOYEE_CHAT_ENDPOINT = `${API_BASE_URL}/api/digital-employee/chat`;
export const AI_DIGITAL_EMPLOYEE_PARAMS_ENDPOINT = `${API_BASE_URL}/api/digital-employee/parameters`;

// ===== DSH 原生工作台配置 =====
// DSH 不支持子路径挂载，因此生产环境使用独立端口或独立子域名。
export const DSH_ACCESS_TICKET_ENDPOINT = `${API_BASE_URL}/api/dsh/access-ticket`;
// DSH 必须使用与 WebOS 同一主域名下的独立子域名，不能默认推导为当前主机的 8082 端口。
export const DSH_WORKBENCH_URL = import.meta.env.VITE_DSH_EMBED_URL || '';

// ===== 视频生成模块配置 =====
export const AI_VIDEOGEN_GENERATE_ENDPOINT = `${API_BASE_URL}/api/videogen/generate`;

// ===== 营销分析模块配置 =====
export const AI_MARKETING_ANALYSIS_CHAT_ENDPOINT = `${API_BASE_URL}/api/marketing-analysis/chat`;
export const AI_MARKETING_ANALYSIS_UPDATE_ENDPOINT = `${API_BASE_URL}/api/marketing-analysis/update-data`;
export const AI_MARKETING_ANALYSIS_DATA_ENDPOINT = `${API_BASE_URL}/marketing_analysis_data.json`;

// ===== 选品策略模块 API 配置 =====
export const AI_PRODUCT_SELECTION_CHAT_ENDPOINT = `${API_BASE_URL}/api/product-selection/chat`;
export const AI_PRODUCT_SELECTION_UPLOAD_ENDPOINT = `${API_BASE_URL}/api/product-selection/upload`;

// ===== 选品库模块 API 配置 =====
export const PRODUCT_LIBRARY_API = `${API_BASE_URL}/api/product-library`;
export const LOGISTICS_CONFIG_API = `${API_BASE_URL}/api/logistics-config`;

// ===== 招标检索模块 API 配置 =====
export const TENDER_SEARCH_RUN_ENDPOINT = `${API_BASE_URL}/api/tender-search/run`;
export const TENDER_SEARCH_LIST_ENDPOINT = `${API_BASE_URL}/api/tender-search/list`;
export const TENDER_SEARCH_SYNC_DETAIL_ENDPOINT = `${API_BASE_URL}/api/tender-search/sync-detail`;
export const TENDER_SEARCH_UPLOAD_KNOWLEDGE_ENDPOINT = `${API_BASE_URL}/api/tender-search/upload-to-knowledge`;

// ===== 核查报价模块 API 配置 =====
export const AI_QUOTE_VERIFY_RUN_ENDPOINT = `${API_BASE_URL}/api/quote-verify/run`;
export const AI_QUOTE_VERIFY_UPLOAD_ENDPOINT = `${API_BASE_URL}/api/quote-verify/upload`;

// ===== 大客户档案模块 API 配置 =====
export const KEY_ACCOUNT_API = `${API_BASE_URL}/api/key-accounts`;
export const KEY_ACCOUNT_AI_RUN_ENDPOINT = `${API_BASE_URL}/api/key-accounts/ai-generate/run`;

// ===== 投标助手模块 API 配置 =====
export const BID_ASSISTANT_API = `${API_BASE_URL}/api/bid-assistant`;
export const BID_ASSISTANT_PARSE_ENDPOINT = `${API_BASE_URL}/api/bid-assistant/parse`;

// ===== 复盘搭子模块 API 配置 =====
export const REVIEW_PARTNER_UPLOAD_ENDPOINT = `${API_BASE_URL}/api/review-partner/upload`;
export const REVIEW_PARTNER_AD_ZONE_ENDPOINT = `${API_BASE_URL}/api/review-partner/ad-zone`;
export const REVIEW_PARTNER_MINI_PROGRAM_ENDPOINT = `${API_BASE_URL}/api/review-partner/mini-program`;
export const REVIEW_PARTNER_MINI_PROGRAM_UPLOAD_ENDPOINT = `${API_BASE_URL}/api/review-partner/mini-program/upload`;
export const REVIEW_PARTNER_MINI_PROGRAM_REMARK_ENDPOINT = `${API_BASE_URL}/api/review-partner/mini-program`;
export const REVIEW_PARTNER_MINI_PROGRAM_AVG_ENDPOINT = `${API_BASE_URL}/api/review-partner/mini-program/avg`;
export const REVIEW_PARTNER_ORDER_PAGE_ENDPOINT = `${API_BASE_URL}/api/review-partner/order-page`;
export const REVIEW_PARTNER_ORDER_PAGE_UPLOAD_ENDPOINT = `${API_BASE_URL}/api/review-partner/order-page/upload`;
export const REVIEW_PARTNER_TRANSACTION_ENDPOINT = `${API_BASE_URL}/api/review-partner/transaction`;
export const REVIEW_PARTNER_TRANSACTION_UPLOAD_ENDPOINT = `${API_BASE_URL}/api/review-partner/transaction/upload`;
export const REVIEW_PARTNER_TRANSACTION_UPDATE_ENDPOINT = `${API_BASE_URL}/api/review-partner/transaction`;
export const REVIEW_PARTNER_TRANSACTION_ADD_ENDPOINT = `${API_BASE_URL}/api/review-partner/transaction/add`;
// ===== 业务看板模块配置 =====
export const AI_BUSINESS_DASHBOARD_CHAT_ENDPOINT = `${API_BASE_URL}/api/business-dashboard/chat`;
export const AI_BUSINESS_DASHBOARD_UPLOAD_ENDPOINT = `${API_BASE_URL}/api/business-dashboard/upload`;

// ===== 企业资质库模块 API 配置 =====
export const EQ_API_BASE = `${API_BASE_URL}/api/enterprise-qualification`;

// ===== 业务看板聚合中心模块配置 =====
export const DASHBOARDS_ENDPOINT = `${API_BASE_URL}/api/dashboards`;
export const DASHBOARDS_ADMIN_ENDPOINT = `${API_BASE_URL}/api/dashboards/admin`;
export const ROLES_PUBLIC_ENDPOINT = `${API_BASE_URL}/api/admin/roles-public`;

// ===== AI 发布看板（Dify 发布能力）配置 =====
export const BUSINESS_DASHBOARD_ENDPOINT = `${API_BASE_URL}/api/business-dashboard`;
export const BUSINESS_DASHBOARD_FILES_BASE = `${API_BASE_URL}/dashboard-files`;
