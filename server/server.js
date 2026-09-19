import express from 'express';
import crypto from 'crypto';
import cors from 'cors';
import cron from 'node-cron';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import winston from 'winston';
import { logger } from './infra/logger.js'; // XO-01 拆解：logger 迁出
import { authenticateToken } from './infra/auth.js'; // XO-01 拆解：JWT 鉴权迁出
import { logAudit } from './infra/audit.js'; // XO-01 拆解：审计迁出
import { register as registerVideogen } from './routes/videogen.js'; // XO-01 拆解：视频生成路由迁出
import pool from './db.js';  // PostgreSQL 连接池
import userAdminRoutes from './userAdminRoutes.js'; // 用户管理路由
import configAdminRoutes from './configAdminRoutes.js'; // 系统配置中心路由
import hazardDetectionRoutes from './hazardDetectionRoutes.js'; // 隐患检测路由
import knowledgeAdminRoutes from './knowledgeAdminRoutes.js'; // 知识库管理路由
import keyAccountRoutes from './keyAccountRoutes.js'; // 大客户档案模块路由
import bidAssistantRoutes from './bidAssistantRoutes.js'; // 投标助手模块路由
import * as legacyBridge from './modules/tasks/legacyBridge.js'; // D4 试点：存量路由 → 任务中心迁移桥
import * as notifyStore from './modules/notifications/notify.js'; // XO-07 P1：应用通知并入 task_notifications
import { ingestTenderOutputs } from './modules/tender/tenderIngest.js'; // 招标检索入库（D4 试点抽出）
import { loadStagedBuffers } from './modules/files/fileStore.js'; // 暂存文件水合（file_ids → Dify 转换用）
import reviewPartnerRoutes from './reviewPartnerRoutes.js'; // 复盘搭子模块路由
import productLibraryRoutes from './productLibraryRoutes.js'; // 选品库模块路由
import logisticsConfigRoutes from './logisticsConfigRoutes.js'; // 物流费计算配置路由
import enterpriseQualificationRoutes from './enterpriseQualificationRoutes.js'; // 企业资质库模块路由
import dashboardRoutes, { ensureDashboardTables } from './dashboardRoutes.js'; // 业务看板聚合中心路由
import businessDashboardRoutes, { businessDashboardStorageDir, ensureBusinessDashboardTable } from './businessDashboardRoutes.js'; // AI 发布看板（Dify 发布能力）
import { maskName, maskAmount, maskPhone, maskBrandBrands, maskProductNamesByBrandDict } from './utils/maskingUtils.js'; // 敏感数据脱敏工具
import { extractBrandsFromProducts } from './utils/aiUtils.js'; // 智能品牌提取工具
// ── 平台重构 M1/M2：技能目录与 Provider 适配层（新增，存量代码零改动）──
import catalogRoutesV1 from './routes/v1/catalogRoutes.js'; // /api/v1 场景与技能接口（文档 03 §4）
import taskRoutesV1 from './routes/v1/taskRoutes.js'; // /api/v1 任务中心接口（文档 05 PRD）
import fileRoutesV1 from './routes/v1/fileRoutes.js'; // /api/v1 文件暂存与签名下载（M4，PRD §7/§9）
import notificationRoutesV1 from './routes/v1/notificationRoutes.js'; // /api/v1 通知与待办（M4，PRD §8）
import permissionRoutesV1 from './routes/v1/permissionRoutes.js'; // /api/v1 技能级授权管理（M6 完整版，文档 06）
import { v1ErrorHandler } from './modules/common/apiResponse.js'; // v1 标准响应/错误模型（文档 03 §2–§3）
import { analyzeMaterialQuote } from './services/pricingAnalysisService.js';
import { difyKnowledgeService } from './services/difyKnowledgeService.js';
import XLSX from 'xlsx';

import { segDsh1, segDsh2 } from './routes/dsh.js';
import { segMisc1, segMisc2, segMisc3, segMisc4, segMisc5, segMisc6, segMisc7, segMisc8, segMisc9, segMisc10, segMisc11 } from './routes/misc.js';
import { segDocDrafting1 } from './routes/docDrafting.js';
import { segMeetingMinutes1 } from './routes/meetingMinutes.js';
import { segDigitalEmployee1 } from './routes/digitalEmployee.js';
import { segMarketingAnalysis1 } from './routes/marketingAnalysis.js';
import { segAuth1 } from './routes/auth.js';
import { segNews1, segNews2 } from './routes/news.js';
import { segInvoiceVerify1, segInvoiceVerify2 } from './routes/invoiceVerify.js';
import { segProductEntry1, segProductEntry2 } from './routes/productEntry.js';
import { segRiskDetection1 } from './routes/riskDetection.js';
import { segAiWorkflow1 } from './routes/aiWorkflow.js';
import { segMarketInsight1 } from './routes/marketInsight.js';
import { segContractAudit1 } from './routes/contractAudit.js';
import { segRules1 } from './routes/rules.js';
import { segBeautyRnd1 } from './routes/beautyRnd.js';
import { segConfig1 } from './routes/config.js';
import { segOrderRecognition1, segOrderRecognition2 } from './routes/orderRecognition.js';
import { segMaterialQuote1 } from './routes/materialQuote.js';
import { segNotifications1 } from './routes/notifications.js';
import { segTenderSearch1 } from './routes/tenderSearch.js';
import { segProductSelection1 } from './routes/productSelection.js';
import { segQuoteVerify1 } from './routes/quoteVerify.js';
import { segBusinessDashboard1 } from './routes/businessDashboard.js';
// ── XO-01 拆解：路由模块依赖注入上下文（getter 惰性取值，规避 TDZ）──
const __ctx = {
    get parseCookies() { return parseCookies; },
    get DSH_ACCESS_COOKIE() { return DSH_ACCESS_COOKIE; },
    get dshCookieOptions() { return dshCookieOptions; },
    get DSH_ACCESS_TTL_MS() { return DSH_ACCESS_TTL_MS; },
    get __dirname() { return __dirname; },
    get marketingAnalysisStatus() { return marketingAnalysisStatus; },
    get normalizeIp() { return normalizeIp; },
    get runPythonScript() { return runPythonScript; },
    get lastUpdateStatus() { return lastUpdateStatus; },
    get generateDailyNews() { return generateDailyNews; },
    get lastNewsUpdateStatus() { return lastNewsUpdateStatus; },
    get upload() { return upload; },
    get fixUploadedFileName() { return fixUploadedFileName; },
    get respondInvoiceBody() { return respondInvoiceBody; },
    get workflowProgress() { return workflowProgress; },
    get isUserStop() { return isUserStop; },
    get generateMonthlyBaseline() { return generateMonthlyBaseline; },
    get trackSalesDeviation() { return trackSalesDeviation; },
    get rulesBaseUrl() { return rulesBaseUrl; },
    get getRulesHeaders() { return getRulesHeaders; },
    get extractCustomerFeaturesJIT() { return extractCustomerFeaturesJIT; },
    get customerAnalysisStatus() { return customerAnalysisStatus; },
    get uploadMemory() { return uploadMemory; },
    get getNewsPrefs() { return getNewsPrefs; },
    get NEWS_PREFS_PATH() { return NEWS_PREFS_PATH; },
    get getUserId() { return getUserId; },
    get COPPER_PRICE_CACHE_PATH() { return COPPER_PRICE_CACHE_PATH; },
    get runTenderSearchDify() { return runTenderSearchDify; },
    get syncTenderStarredDetail() { return syncTenderStarredDetail; },
};


// ==================== 环境变量辅助函数 ====================
const envBool = (key, defaultVal = true) => {
    const val = process.env[key];
    if (val === undefined) return defaultVal;
    return val === 'true' || val === '1';
};
// ===========================================================

// ==================== 用户主动停止判断辅助函数 ====================
const isUserStop = (msg) => msg?.includes('User requested stop') || msg?.includes('Aborted');
// ===========================================================

// logger 已迁至 server/infra/logger.js（XO-01）

process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception', err);
    process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at ' + promise + ' reason: ' + reason);
    process.exit(1);
});

// 鉴权使用的 JWT 暗号 (本应存在 .env$，为演示直接硬编码或回退)

// ES模块中获取__dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const PORT = process.env.SERVER_PORT || 3001;

// ==================== DB 初始化 (每日新闻历史) ====================
pool.query(`
     CREATE TABLE IF NOT EXISTS app_news_history (
         id          SERIAL PRIMARY KEY,
         report_date DATE NOT NULL,
         industry    TEXT NOT NULL,
         content     JSONB NOT NULL,
         created_at  TIMESTAMP NOT NULL DEFAULT NOW()
     );
     CREATE INDEX IF NOT EXISTS idx_news_history_date ON app_news_history(report_date);
 `).then(() => {
    console.log('[DB] 每日新闻历史记录表已就绪 ✓');
}).catch(err => {
    console.error('[DB] 初始化历史记录表失败:', err);
});

// 中间件
app.use(cors({
    origin: true, // 允许跨端口直连
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// JWT_SECRET 与 authenticateToken 已迁至 server/infra/auth.js（XO-01）
const DSH_ACCESS_COOKIE = 'blue_os_dsh_access';
const DSH_ACCESS_TTL_MS = 10 * 60 * 1000;

const parseCookies = (cookieHeader = '') => cookieHeader.split(';').reduce((cookies, item) => {
    const separator = item.indexOf('=');
    if (separator === -1) return cookies;
    const name = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (!name) return cookies;
    try {
        cookies[name] = decodeURIComponent(value);
    } catch (_) {
        cookies[name] = value;
    }
    return cookies;
}, {});

const dshCookieOptions = () => ({
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.DSH_COOKIE_SECURE === 'true',
    maxAge: DSH_ACCESS_TTL_MS,
    path: '/',
    ...(process.env.DSH_COOKIE_DOMAIN?.trim() ? { domain: process.env.DSH_COOKIE_DOMAIN.trim() } : {}),
});

// 仅供 Nginx auth_request 内部调用。该路由必须位于全局 JWT 中间件之前，
// 因为 iframe 导航无法携带 Authorization Header，只能提交 HttpOnly 短时票据。
segDsh1(app, __ctx);;

// IP 归一化工具 (处理 IPv6 的 IPv4 映射及 localhost 变体)
const normalizeIp = (ip) => {
    if (!ip) return '';
    if (ip === '::1' || ip === '::ffff:127.0.0.1') return '127.0.0.1';
    if (ip.startsWith('::ffff:')) return ip.substring(7);
    return ip;
};

// 鉴权中间件
// authenticateToken 已迁至 server/infra/auth.js（XO-01）

// 静态资源先行（允许 DashScope 匿名下载音频）
app.use('/uploads', express.static(path.join(__dirname, '../public/uploads')));
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.static(path.join(__dirname, '../dist')));
app.use('/dashboard-files', express.static(businessDashboardStorageDir)); // AI 发布看板静态托管（须在鉴权前：iframe 请求不带 JWT 头）

app.use(authenticateToken);

// DSH 访问票据：由 WebOS JWT 换取，仅用于 Nginx 访问 DSH 前的内部校验。
segDsh2(app, __ctx);;


// ============================================================
// ■ 隐患检测模块路由注册（百度人体检测与属性识别）
// ============================================================
app.use('/api/hazard-detection', hazardDetectionRoutes);
app.use('/api/knowledge', knowledgeAdminRoutes);
app.use('/api/key-accounts', keyAccountRoutes); // 大客户档案模块
app.use('/api/bid-assistant', bidAssistantRoutes); // 投标助手模块
app.use('/api/review-partner', reviewPartnerRoutes); // 复盘搭子模块
app.use('/api/product-library', productLibraryRoutes); // 选品库模块
app.use('/api/logistics-config', logisticsConfigRoutes); // 物流费计算配置
app.use('/api/enterprise-qualification', enterpriseQualificationRoutes); // 企业资质库模块
app.use('/api/dashboards', dashboardRoutes); // 业务看板聚合中心模块
ensureDashboardTables().catch(err => console.error('[Dashboard DDL] 看板表初始化失败:', err.message));
app.use('/api/business-dashboard', businessDashboardRoutes); // AI 发布看板（Dify 发布能力，publish 走内部令牌鉴权）
ensureBusinessDashboardTable().catch(err => console.error('[BusinessDashboard DDL] 发布看板表初始化失败:', err.message));

// ============================================================
// ■ /api/v1 —— 场景与技能目录（平台重构 M1/M2 落地）
//   文档 03 §4 场景与技能 API；挂载在全局鉴权之后，天然要求登录
//   仅新增，不影响任何存量路由
// ============================================================
app.use('/api/v1', catalogRoutesV1);
app.use('/api/v1', taskRoutesV1); // 任务中心（M3，PRD 05）
app.use('/api/v1', fileRoutesV1); // 文件暂存与签名下载（M4，PRD §7/§9）
app.use('/api/v1', notificationRoutesV1); // 通知与待办（M4，PRD §8）
app.use('/api/v1', permissionRoutesV1); // 技能级授权管理（M6 完整版，文档 06）
app.use('/api/v1', v1ErrorHandler()); // v1 专用错误翻译（文档 03 §3）

// ============================================================
// ■ 演示脱敏：品牌字典接口（前端展示层脱敏使用）
// ============================================================
segMisc1(app, __ctx);;


// 安全频率控制中间件
const globalLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1分钟
    max: 120, // 正常浏览不会在1分钟发120次，超过即视为异常探测
    message: { success: false, message: '全局请求过于频繁，请稍后再试（触发1分钟安全管控拦截）。' }
});

// 文件上传中间件配置 (切换至磁盘存储以降低内存压力)
const uploadDir = path.join(__dirname, '../tmp/uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 400 * 1024 * 1024 }
});

const coreServicesLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1分钟
    max: 20, // 针对大模型端点及图片生成，单IP 1分钟上限20次调用防刷
    message: { success: false, message: '系统算力过载拒绝：大语言大图模型调用已达到单IP限速，请缓一分钟后再试！' }
});

// ==================== 会议纪要与文档文案 智能分析代理 (微分片增强版) ====================
const chunkDir = path.join(__dirname, '../tmp/chunks');
if (!fs.existsSync(chunkDir)) fs.mkdirSync(chunkDir, { recursive: true });

// ==================== 阿里云通义听悟 (Tingwu) 集成 ====================

// ==================== 阿里云百炼 (DashScope) FunASR 集成 ====================

// 单次上传音频文件 (不再分片)
app.post('/api/meeting-minutes/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: '文件上传失败' });

        const uploadDir = path.join(__dirname, '../public', 'uploads', 'meeting-minutes');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

        // 纠正 Multer 默认的 latin1 编码错误 (处理中文字符文件名，仅用于日志展示)
        const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');

        // 核心修复：存盘文件名只保留时间戳+扩展名（纯 ASCII），
        // 避免中文字符经过 Express → cpolar → DashScope 时因编码不一致导致 FILE_DOWNLOAD_FAILED
        const ext = path.extname(originalName) || '.mp3';
        const finalFileName = `${Date.now()}${ext}`;
        const finalPath = path.join(uploadDir, finalFileName);

        fs.renameSync(req.file.path, finalPath);
        logger.info(`[MeetingMinutes] 音频文件上传成功: ${finalFileName}`);

        res.json({ success: true, fileName: finalFileName });
    } catch (e) {
        logger.error('[MeetingMinutes Upload] ' + e.message);
        res.status(500).json({ error: e.message });
    }
});

// 提交百炼 FunASR 离线转写任务
app.post('/api/meeting-minutes/chat', async (req, res) => {
    try {
        const { fileName, originalName } = req.body;
        if (!fileName) return res.status(400).json({ error: '缺少已上传的文件名' });

        const apiKey = process.env.DASHSCOPE_API_KEY;
        if (!apiKey) return res.status(500).json({ error: '请在 .env 中配置 DASHSCOPE_API_KEY' });

        // 1. 优先获取公网 URL，并增加强制检查
        const configPublicUrl = (process.env.PUBLIC_URL || '').trim();
        const baseUrl = configPublicUrl || `${req.protocol}://${req.get('host')}`;
        const fileUrl = `${baseUrl}/uploads/meeting-minutes/${encodeURIComponent(fileName)}`;

        logger.info(`[DashScope] 正在提交任务。请确保以下 URL 在公网可访问: ${fileUrl}`);

        // ★ 预检：验证该 URL 是否实际可访问（用 HEAD 请求快速判断）
        try {
            const precheck = await fetch(fileUrl, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
            if (!precheck.ok) {
                const msg = `文件 URL 预检失败 (HTTP ${precheck.status})：${fileUrl}\n请确认 cpolar 隧道正在运行且已指向端口 3001，并确认 .env 中的 PUBLIC_URL 与当前隧道地址一致。`;
                logger.error(`[DashScope 预检失败] ${msg}`);
                return res.status(500).json({ error: msg });
            }
            logger.info(`[DashScope] URL 预检通过 (HTTP ${precheck.status})`);
        } catch (preErr) {
            const msg = `文件 URL 无法访问：${preErr.message}\n请检查：1) cpolar 是否正在运行？2) 隧道是否指向端口 3001？3) .env 中 PUBLIC_URL 是否为最新隧道地址？`;
            logger.error(`[DashScope 预检异常] ${msg}`);
            return res.status(500).json({ error: msg });
        }



        // 2. 调用 DashScope 异步转写服务接口 (专用于 FunASR 异步任务)
        const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'X-DashScope-Async': 'enable'
            },
            body: JSON.stringify({
                model: 'fun-asr',
                input: {
                    file_urls: [fileUrl]
                },
                parameters: {} // 保持空对象以兼容 API 要求
            })
        });

        const data = await response.json();
        if (!response.ok) {
            const errorMsg = data.message || data.code || JSON.stringify(data);
            logger.error(`[DashScope API Error] ${errorMsg}`);
            throw new Error(`DashScope 任务创建失败: ${errorMsg}`);
        }

        // 健壮性检查：确保 output 和 task_id 存在
        if (!data.output || !data.output.task_id) {
            logger.error(`[DashScope Structure Error] 意外的响应格式: ${JSON.stringify(data)}`);
            throw new Error(`DashScope 返回数据异常: ${data.message || JSON.stringify(data)}`);
        }

        const taskId = data.output.task_id;
        logger.info(`[DashScope] 任务已创建: ${taskId}`);
        res.json({ success: true, taskId: taskId });
    } catch (e) {
        logger.error('[DashScope CreateTask] ' + e.message);
        res.status(500).json({ error: e.message });
    }
});

// 任务状态查询接口 (DashScope 版)
app.get('/api/meeting-minutes/status/:taskId', async (req, res) => {
    try {
        const { taskId } = req.params;
        const apiKey = process.env.DASHSCOPE_API_KEY;
        if (!apiKey) return res.status(500).json({ error: '配置缺失' });

        const response = await fetch(`https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });

        const data = await response.json();
        if (!response.ok) throw new Error(`查询失败: ${data.message}`);

        const taskStatus = data.output.task_status;

        // 成功时处理结果
        if (taskStatus === 'SUCCEEDED') {
            const result = data.output.results?.[0];
            let transcriptionText = '';

            // 1. 尝试从 transcription_url 获取结果
            if (result && result.transcription_url) {
                logger.info(`[DashScope] 任务成功，正在从结果链接获取文本: ${result.transcription_url}`);
                try {
                    const transRes = await fetch(result.transcription_url);
                    const transJson = await transRes.json();

                    logger.debug(`[DashScope Raw Result] ${JSON.stringify(transJson).substring(0, 500)}...`);

                    // 深度兼容多种 JSON 结果格式
                    if (Array.isArray(transJson.transcripts)) {
                        transcriptionText = transJson.transcripts.map(t => t.text || '').join('\n');
                    } else if (Array.isArray(transJson.transcription)) {
                        transcriptionText = transJson.transcription.map(s => s.text || s.text_optimized || '').join('\n');
                    } else if (Array.isArray(transJson.sentences)) {
                        transcriptionText = transJson.sentences.map(s => s.text || '').join('\n');
                    } else if (transJson.text) {
                        transcriptionText = transJson.text;
                    } else if (transJson.content) {
                        transcriptionText = transJson.content;
                    }

                    // 如果以上格式都不对，尝试遍历寻找 text 字段
                    if (!transcriptionText && Array.isArray(transJson)) {
                        transcriptionText = transJson.map(item => item.text || '').join('\n');
                    }

                } catch (fetchErr) {
                    logger.error(`[DashScope Fetch Result Error] 获取结果文件失败: ${fetchErr.message}`);
                    transcriptionText = `获取结果失败，请尝试访问结果链接: ${result.transcription_url}`;
                }
            }
            // 2. 尝试直接从 output 字段获取 (部分模型直接返回)
            else if (data.output.text || data.output.sentence) {
                transcriptionText = data.output.text || data.output.sentence;
            }

            logger.info(`[DashScope] 转写结果获取完毕，长度: ${transcriptionText.length}`);

            return res.json({
                success: true,
                status: 2,
                transcription: transcriptionText || '识别成功，但未解析到文本内容。'
            });
        }

        if (taskStatus === 'FAILED') {
            const errorMsg = data.output.message || '未知错误';
            logger.error(`[DashScope Task Failed] TaskId: ${taskId}, Error: ${errorMsg}`);
            return res.json({
                success: true,
                status: 3,
                message: errorMsg
            });
        }

        res.json({ success: true, status: 1 });
    } catch (e) {
        logger.error('[DashScope GetTask] ' + e.message);
        res.status(500).json({ error: e.message });
    }
});

// --- Dify 会议纪要生成接口 [NEW] ---
app.post('/api/meeting-minutes/summarize', authenticateToken, async (req, res) => {
    const { originalText } = req.body;
    const apiKey = process.env.DIFY_MEETING_MINUTES_API_KEY;
    const apiUrl = process.env.DIFY_MEETING_MINUTES_API_URL;

    if (!originalText) return res.status(400).json({ error: '原文内容不能为空' });
    if (!apiKey || apiKey === 'app-xxxx') {
        return res.json({ success: true, minutes: '系统未配置 Dify API Key，无法生成会议纪要。' });
    }

    try {
        logger.info(`[Dify Summary] 开始生成纪要，文本长度: ${originalText.length}`);

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: {},
                query: originalText,
                response_mode: 'blocking',
                user: req.user?.username || 'system-user'
            })
        });

        const data = await response.json();

        if (!response.ok) {
            logger.error(`[Dify Summary Error] Status: ${response.status}, Data: ${JSON.stringify(data)}`);
            throw new Error(data.message || 'Dify 摘要请求失败');
        }

        res.json({
            success: true,
            minutes: data.answer || 'Dify 未返回有效摘要内容。'
        });
    } catch (e) {
        logger.error('[Dify Summary Exception] ' + e.message);
        res.status(500).json({ error: e.message });
    }
});

// --- 文档起草 Dify 接口调用 [NEW] ---
segDocDrafting1(app, __ctx);;

// --- 会议纪要 Word 导出接口 [NEW] ---
segMeetingMinutes1(app, __ctx);;

// --- 数字员工助手代理接口 [NEW] ---
segDigitalEmployee1(app, __ctx);;

// --- 营销分析模块路由 [NEW] ---
let marketingAnalysisStatus = {
    isRunning: false,
    status: 'idle',
    message: '',
    lastUpdate: new Date().toISOString()
};

segMarketingAnalysis1(app, __ctx);;

app.use('/api/', globalLimiter);
app.use('/api/rules/', coreServicesLimiter);
app.use('/api/generate-image', coreServicesLimiter);



// --- 自动执行 DDL（幂等，首次启动时建表/加字段）---
async function runInitDDL() {
    // XO-07：按语句幂等容错——单条失败（如依赖表未建）不中断整体初始化；读类失败按空结果降级
    const safeDDL = async (label, fn) => {
        try {
            return await fn();
        } catch (e) {
            logger.warn(`[DDL][容错跳过] ${label}: ${e.message}`);
            return { rows: [], rowCount: 0 };
        }
    };

    try {
        // ── XO-07 根基修复：sys_users / sys_roles 为全库 FK 与权限判定根基（历史手工表，
//    仓库从未有 DDL，全新部署会连锁失败）——补齐建表使全新环境自洽 ──
        await safeDDL('ddl#0a', () => pool.query(`
            CREATE TABLE IF NOT EXISTS sys_users (
                id            SERIAL PRIMARY KEY,
                username      VARCHAR(80) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                display_name  VARCHAR(120) DEFAULT '',
                email         VARCHAR(160) DEFAULT '',
                role          VARCHAR(40)  DEFAULT 'user',
                is_active     BOOLEAN DEFAULT TRUE,
                avatar_url    TEXT,
                department    VARCHAR(100) DEFAULT '',
                last_login_at TIMESTAMPTZ,
                created_at    TIMESTAMPTZ DEFAULT NOW()
            )
        `));
        await safeDDL('ddl#0b', () => pool.query(`
            CREATE TABLE IF NOT EXISTS sys_roles (
                id           SERIAL PRIMARY KEY,
                name         VARCHAR(80) UNIQUE NOT NULL,
                display_name VARCHAR(120) DEFAULT '',
                is_builtin   BOOLEAN DEFAULT FALSE,
                permissions  JSONB DEFAULT '[]'::jsonb,
                created_at   TIMESTAMPTZ DEFAULT NOW()
            )
        `));
        // ── XO-07 P3 用户身份迁移（单租户平移）：存量库幂等列对齐到新模型 ──
        await safeDDL('ddl#p3-users', () => pool.query(`
            ALTER TABLE sys_users
                ADD COLUMN IF NOT EXISTS display_name  VARCHAR(120) DEFAULT '',
                ADD COLUMN IF NOT EXISTS email         VARCHAR(160) DEFAULT '',
                ADD COLUMN IF NOT EXISTS role          VARCHAR(40)  DEFAULT 'user',
                ADD COLUMN IF NOT EXISTS is_active     BOOLEAN      DEFAULT TRUE,
                ADD COLUMN IF NOT EXISTS avatar_url    TEXT,
                ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ
        `));
        await safeDDL('ddl#p3-roles', () => pool.query(`
            ALTER TABLE sys_roles
                ADD COLUMN IF NOT EXISTS display_name VARCHAR(120) DEFAULT '',
                ADD COLUMN IF NOT EXISTS is_builtin   BOOLEAN      DEFAULT FALSE,
                ADD COLUMN IF NOT EXISTS permissions  JSONB DEFAULT '[]'::jsonb
        `));
        await safeDDL('ddl#1', () => pool.query(`ALTER TABLE sys_users ADD COLUMN IF NOT EXISTS department VARCHAR(100) DEFAULT ''`));
        await safeDDL('ddl#2', () => pool.query(`
            CREATE TABLE IF NOT EXISTS sys_user_sessions (
                id          SERIAL PRIMARY KEY,
                user_id     INTEGER NOT NULL REFERENCES sys_users(id) ON DELETE CASCADE,
                jti         VARCHAR(64) UNIQUE NOT NULL,
                device_info TEXT    DEFAULT '',
                ip_address  VARCHAR(64) DEFAULT '',
                created_at  TIMESTAMPTZ DEFAULT NOW(),
                expires_at  TIMESTAMPTZ NOT NULL,
                revoked     BOOLEAN DEFAULT FALSE,
                revoked_at  TIMESTAMPTZ
            )
        `));

        // 商品品牌字典表（用于增强型动态脱敏）
        await safeDDL('ddl#3', () => pool.query(`
            CREATE TABLE IF NOT EXISTS brand_dictionary (
                id          SERIAL PRIMARY KEY,
                brand_name  VARCHAR(255) UNIQUE NOT NULL,
                source      VARCHAR(50) DEFAULT 'LLM',
                status      VARCHAR(20) DEFAULT 'ACTIVE',
                created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `));

        // 资质大类自定义分类表
        await safeDDL('ddl#4', () => pool.query(`
            CREATE TABLE IF NOT EXISTS sys_qual_categories (
                id          SERIAL PRIMARY KEY,
                parent_type VARCHAR(50) NOT NULL,
                name        VARCHAR(255) NOT NULL,
                created_at  TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(parent_type, name)
            )
        `));

        // 资质信息表 (Qualification Management)
        await safeDDL('ddl#5', () => pool.query(`
            CREATE TABLE IF NOT EXISTS sys_qualifications (
                id              VARCHAR(64) PRIMARY KEY,
                emp_id          INTEGER REFERENCES sys_users(id) ON DELETE CASCADE,
                parent_type     VARCHAR(50) DEFAULT 'EMP',
                category_id     INTEGER REFERENCES sys_qual_categories(id) ON DELETE SET NULL,
                name            VARCHAR(255) NOT NULL,
                cert_no         VARCHAR(100),
                issuer          VARCHAR(255),
                region          VARCHAR(50),
                category        VARCHAR(100),
                effective_date  DATE,
                expiry_date     DATE,
                reminder_days   INTEGER DEFAULT 30,
                status          VARCHAR(20) DEFAULT 'normal',
                thumbnail_url   TEXT,
                created_at      TIMESTAMPTZ DEFAULT NOW(),
                updated_at      TIMESTAMPTZ DEFAULT NOW()
            )
        `));
        // 兼容已有数据结构调整
        await safeDDL('ddl#6', () => pool.query(`ALTER TABLE sys_qualifications ALTER COLUMN emp_id DROP NOT NULL`)).catch(() => { });
        await safeDDL('ddl#7', () => pool.query(`ALTER TABLE sys_qualifications ADD COLUMN IF NOT EXISTS parent_type VARCHAR(50) DEFAULT 'EMP'`)).catch(() => { });
        await safeDDL('ddl#8', () => pool.query(`ALTER TABLE sys_qualifications ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES sys_qual_categories(id) ON DELETE SET NULL`)).catch(() => { });

        // 【迁移逻辑】将原有按人分组的内容（EMP）正式更名为 PRODUCT 类型内容
        await safeDDL('ddl#9', () => pool.query(`UPDATE sys_qualifications SET parent_type = 'PRODUCT' WHERE parent_type = 'EMP'`));

        await safeDDL('ddl#10', () => pool.query(`CREATE INDEX IF NOT EXISTS idx_qualifications_emp_id ON sys_qualifications(emp_id)`));
        await safeDDL('ddl#11', () => pool.query(`CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sys_user_sessions(user_id)`));
        await safeDDL('ddl#12', () => pool.query(`CREATE INDEX IF NOT EXISTS idx_sessions_jti     ON sys_user_sessions(jti)`));

        // 会议纪要持久化表 [NEW]
        await safeDDL('ddl#13', () => pool.query(`
            CREATE TABLE IF NOT EXISTS sys_meeting_minutes (
                id              VARCHAR(64) PRIMARY KEY,
                user_id         INTEGER REFERENCES sys_users(id) ON DELETE CASCADE,
                filename        VARCHAR(255) NOT NULL,
                original_text   TEXT,
                minutes_text    TEXT,
                created_at      TIMESTAMPTZ DEFAULT NOW()
            )
        `));
        await safeDDL('ddl#14', () => pool.query(`CREATE INDEX IF NOT EXISTS idx_meeting_minutes_user_id ON sys_meeting_minutes(user_id)`));

        // 文档起草持久化表 [NEW]
        await safeDDL('ddl#15', () => pool.query(`
            CREATE TABLE IF NOT EXISTS sys_doc_drafting (
                id              VARCHAR(64) PRIMARY KEY,
                user_id         INTEGER REFERENCES sys_users(id) ON DELETE CASCADE,
                name            VARCHAR(255) NOT NULL,
                doc_type        VARCHAR(100),
                original_query  TEXT,
                result_text     TEXT,
                created_at      TIMESTAMPTZ DEFAULT NOW()
            )
        `));
        await safeDDL('ddl#16', () => pool.query(`CREATE INDEX IF NOT EXISTS idx_doc_drafting_user_id ON sys_doc_drafting(user_id)`));

        // 操作审计日志表初始化 (PostgreSQL 语法)
        await safeDDL('ddl#17', () => pool.query(`
            CREATE TABLE IF NOT EXISTS sys_audit_logs (
                id          SERIAL PRIMARY KEY,
                user_id     INTEGER REFERENCES sys_users(id) ON DELETE SET NULL,
                username    VARCHAR(255),
                module      VARCHAR(100),
                action      VARCHAR(100),
                target_data TEXT,
                details     TEXT,
                status      VARCHAR(20) DEFAULT 'SUCCESS',
                ip_address  VARCHAR(64),
                user_agent  TEXT,
                created_at  TIMESTAMPTZ DEFAULT NOW()
            )
        `));
        await safeDDL('ddl#18', () => pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_created_at ON sys_audit_logs(created_at)`));
        await safeDDL('ddl#19', () => pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_username   ON sys_audit_logs(username)`));

        // 美妆研发自定义配方版本持久化表 [NEW]
        await safeDDL('ddl#20', () => pool.query(`
            CREATE TABLE IF NOT EXISTS sys_beauty_rnd_versions (
                id SERIAL PRIMARY KEY,
                conversation_id VARCHAR(64) NOT NULL,
                version_id VARCHAR(64) NOT NULL,
                version_name VARCHAR(255) NOT NULL,
                timestamp VARCHAR(64),
                ingredients JSONB NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(conversation_id, version_id)
            )
        `));
        await safeDDL('ddl#21', () => pool.query(`CREATE INDEX IF NOT EXISTS idx_beauty_rnd_conv_id ON sys_beauty_rnd_versions(conversation_id)`));

        // 用户通知表 (System Notifications)
        await safeDDL('ddl#22', () => pool.query(`
            CREATE TABLE IF NOT EXISTS sys_notifications (
                id          VARCHAR(64) PRIMARY KEY,
                user_id     INTEGER NOT NULL REFERENCES sys_users(id) ON DELETE CASCADE,
                app_id      VARCHAR(50),
                app_name    VARCHAR(100),
                title       VARCHAR(255),
                message     TEXT,
                is_read     BOOLEAN DEFAULT FALSE,
                created_at  TIMESTAMPTZ DEFAULT NOW(),
                updated_at  TIMESTAMPTZ DEFAULT NOW()
            )
        `));
        await safeDDL('ddl#23', () => pool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON sys_notifications(user_id)`));

        logger.info('[DDL] 系统基础及审计日志表结构初始化完成 ✓');

        // --- 商品库录入历史记录表 ---
        await safeDDL('ddl#24', () => pool.query(`
            CREATE TABLE IF NOT EXISTS product_entry_history (
                id              SERIAL PRIMARY KEY,
                file_names      TEXT NOT NULL,
                parse_result    TEXT,
                confirm_result  TEXT,
                sku_count       INTEGER DEFAULT 0,
                spu_count       INTEGER DEFAULT 0,
                status          VARCHAR(20) DEFAULT 'parsed',
                username        VARCHAR(100) DEFAULT 'unknown',
                created_at      TIMESTAMPTZ DEFAULT NOW()
            )
        `));
        await safeDDL('ddl#25', () => pool.query(`CREATE INDEX IF NOT EXISTS idx_product_entry_history_created_at ON product_entry_history(created_at DESC)`));
        logger.info('[DDL] 商品库录入历史记录表初始化完成 ✓');

        // --- 选品策略会话表 ---
        await safeDDL('ddl#26', () => pool.query(`
            CREATE TABLE IF NOT EXISTS sys_product_selection_conversations (
                id                    SERIAL PRIMARY KEY,
                user_id               INTEGER NOT NULL,
                title                 VARCHAR(200) NOT NULL DEFAULT '',
                dify_conversation_id  VARCHAR(100),
                created_at            TIMESTAMPTZ DEFAULT NOW(),
                updated_at            TIMESTAMPTZ DEFAULT NOW()
            )
        `));
        await safeDDL('ddl#27', () => pool.query(`CREATE INDEX IF NOT EXISTS idx_ps_conv_user ON sys_product_selection_conversations(user_id)`));
        logger.info('[DDL] 选品策略会话表初始化完成 ✓');

        // --- 选品策略消息表 ---
        await safeDDL('ddl#28', () => pool.query(`
            CREATE TABLE IF NOT EXISTS sys_product_selection_messages (
                id              SERIAL PRIMARY KEY,
                conversation_id INTEGER NOT NULL,
                role            VARCHAR(20) NOT NULL,
                content         TEXT,
                files           JSONB,
                stopped         BOOLEAN DEFAULT FALSE,
                created_at      TIMESTAMPTZ DEFAULT NOW()
            )
        `));
        await safeDDL('ddl#29', () => pool.query(`CREATE INDEX IF NOT EXISTS idx_ps_msg_conv ON sys_product_selection_messages(conversation_id)`));
        // 兼容已有表：补充 stopped 列
        await safeDDL('ddl#30', () => pool.query(`
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sys_product_selection_messages' AND column_name = 'stopped') THEN
                    ALTER TABLE sys_product_selection_messages ADD COLUMN stopped BOOLEAN DEFAULT FALSE;
                END IF;
            END $$
        `));
        logger.info('[DDL] 选品策略消息表初始化完成 ✓');

        // --- 发票校验历史记录表 ---
        try {
            const invoiceSqlPath = path.join(__dirname, '../database/create_invoice_verify_table.sql');
            if (fs.existsSync(invoiceSqlPath)) {
                const invoiceSql = fs.readFileSync(invoiceSqlPath, 'utf8');
                await safeDDL('ddl#31', () => pool.query(invoiceSql));
                logger.info('[DDL] 发票校验历史记录表初始化完成 ✓');
            } else {
                logger.warn('[DDL] 未找到发票校验 SQL 脚本，跳过初始化');
            }
        } catch (invoiceErr) {
            logger.error('[DDL] 发票校验历史记录表初始化失败：' + invoiceErr.message);
        }

        // --- 物料报价 Mock 数据库表自启动初始化 ---
        try {
            const sqlPath = path.join(__dirname, '../database/create_mock_quote_tables.sql');
            if (fs.existsSync(sqlPath)) {
                const sqlContent = fs.readFileSync(sqlPath, 'utf8');
                await safeDDL('ddl#32', () => pool.query(sqlContent));
                logger.info('[DDL] 物料报价 Mock 数据表及种子记录初始化完成 ✓');
            } else {
                logger.warn('[DDL] 未找到物料报价 Mock SQL 脚本，跳过初始化');
            }
        } catch (mockErr) {
            logger.error('[DDL] 物料报价 Mock 表初始化失败：' + mockErr.message);
        }

        // --- 招标检索结果表 ---
        try {
            const tenderSqlPath = path.join(__dirname, '../database/create_tender_results.sql');
            if (fs.existsSync(tenderSqlPath)) {
                const tenderSql = fs.readFileSync(tenderSqlPath, 'utf8');
                await safeDDL('ddl#33', () => pool.query(tenderSql));
                // 兼容已有表：新增 bid_id 字段
                await safeDDL('ddl#34', () => pool.query("ALTER TABLE sys_tender_results ADD COLUMN IF NOT EXISTS bid_id VARCHAR(200) DEFAULT ''"));
                await safeDDL('ddl#35', () => pool.query("ALTER TABLE sys_tender_results ADD COLUMN IF NOT EXISTS bid_no VARCHAR(200) DEFAULT ''"));
                await safeDDL('ddl#36', () => pool.query("ALTER TABLE sys_tender_results ADD COLUMN IF NOT EXISTS bid_type INTEGER DEFAULT 0"));
                await safeDDL('ddl#37', () => pool.query("ALTER TABLE sys_tender_results ADD COLUMN IF NOT EXISTS bid_process INTEGER DEFAULT 0"));
                await safeDDL('ddl#38', () => pool.query("ALTER TABLE sys_tender_results ADD COLUMN IF NOT EXISTS candidate_names JSONB DEFAULT '[]'::jsonb"));
                await safeDDL('ddl#39', () => pool.query("ALTER TABLE sys_tender_results ADD COLUMN IF NOT EXISTS winning_company VARCHAR(500) DEFAULT ''"));
                await safeDDL('ddl#40', () => pool.query("ALTER TABLE sys_tender_results ADD COLUMN IF NOT EXISTS winning_amount VARCHAR(200) DEFAULT ''"));
                await safeDDL('ddl#41', () => pool.query("ALTER TABLE sys_tender_results ADD COLUMN IF NOT EXISTS announcement_date VARCHAR(100) DEFAULT ''"));
                await safeDDL('ddl#42', () => pool.query("ALTER TABLE sys_tender_results ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ"));
                await safeDDL('ddl#43', () => pool.query("ALTER TABLE sys_tender_results ADD COLUMN IF NOT EXISTS sync_status VARCHAR(100) DEFAULT ''"));
                logger.info('[DDL] 招标检索结果表初始化完成 ✓');
            }
        } catch (tenderErr) {
            logger.error('[DDL] 招标检索结果表初始化失败：' + tenderErr.message);
        }

        // ■ 大客户档案表初始化
        try {
            const kaSqlPath = path.join(__dirname, '../database/create_key_account_tables.sql');
            if (fs.existsSync(kaSqlPath)) {
                const kaSql = fs.readFileSync(kaSqlPath, 'utf8');
                await safeDDL('ddl#44', () => pool.query(kaSql));
                logger.info('[DDL] 大客户档案表初始化完成 ✓');
            }
        } catch (kaErr) {
            logger.error('[DDL] 大客户档案表初始化失败：' + kaErr.message);
        }

        // ■ 投标助手模块表初始化
        try {
            const bidSqlPath = path.join(__dirname, '../database/create_bid_assistant_tables.sql');
            if (fs.existsSync(bidSqlPath)) {
                const bidSql = fs.readFileSync(bidSqlPath, 'utf8');
                await safeDDL('ddl#45', () => pool.query(bidSql));
                logger.info('[DDL] 投标助手模块表初始化完成 ✓');
            }
        } catch (bidErr) {
            logger.error('[DDL] 投标助手模块表初始化失败：' + bidErr.message);
        }

        // ■ 复盘搭子-广告专区表初始化
        try {
            const reviewSqlPath = path.join(__dirname, '../database/create_review_ad_zone_table.sql');
            if (fs.existsSync(reviewSqlPath)) {
                const reviewSql = fs.readFileSync(reviewSqlPath, 'utf8');
                await safeDDL('ddl#46', () => pool.query(reviewSql));
                logger.info('[DDL] 复盘搭子-广告专区表初始化完成 ✓');
            }
        } catch (reviewErr) {
            logger.error('[DDL] 复盘搭子-广告专区表初始化失败：' + reviewErr.message);
        }

        // ■ 复盘搭子-小程序访问情况表初始化
        try {
            const mpSqlPath = path.join(__dirname, '../database/create_review_mini_program_table.sql');
            if (fs.existsSync(mpSqlPath)) {
                const mpSql = fs.readFileSync(mpSqlPath, 'utf8');
                await safeDDL('ddl#47', () => pool.query(mpSql));
                logger.info('[DDL] 复盘搭子-小程序访问情况表初始化完成 ✓');
            }
        } catch (mpErr) {
            logger.error('[DDL] 复盘搭子-小程序访问情况表初始化失败：' + mpErr.message);
        }

        // ■ 复盘搭子-点餐聚合页情况表初始化
        try {
            const opSqlPath = path.join(__dirname, '../database/create_review_order_page_table.sql');
            if (fs.existsSync(opSqlPath)) {
                const opSql = fs.readFileSync(opSqlPath, 'utf8');
                await safeDDL('ddl#48', () => pool.query(opSql));
                logger.info('[DDL] 复盘搭子-点餐聚合页情况表初始化完成 ✓');
            }
        } catch (opErr) {
            logger.error('[DDL] 复盘搭子-点餐聚合页情况表初始化失败：' + opErr.message);
        }

        // ■ 复盘搭子-交易情况表初始化
        try {
            const txSqlPath = path.join(__dirname, '../database/create_review_transaction_table.sql');
            if (fs.existsSync(txSqlPath)) {
                const txSql = fs.readFileSync(txSqlPath, 'utf8');
                await safeDDL('ddl#49', () => pool.query(txSql));
                logger.info('[DDL] 复盘搭子-交易情况表初始化完成 ✓');
            }
        } catch (txErr) {
            logger.error('[DDL] 复盘搭子-交易情况表初始化失败：' + txErr.message);
        }

        // ■ 物流费计算配置表初始化
        try {
            const lgSqlPath = path.join(__dirname, '../database/create_logistics_config_table.sql');
            if (fs.existsSync(lgSqlPath)) {
                const lgSql = fs.readFileSync(lgSqlPath, 'utf8');
                await safeDDL('ddl#50', () => pool.query(lgSql));
                logger.info('[DDL] 物流费计算配置表初始化完成 ✓');
            }
        } catch (lgErr) {
            logger.error('[DDL] 物流费计算配置表初始化失败：' + lgErr.message);
        }

        // ■ 物流耗材数据表初始化
        try {
            const pkgSqlPath = path.join(__dirname, '../database/create_packaging_table.sql');
            if (fs.existsSync(pkgSqlPath)) {
                const pkgSql = fs.readFileSync(pkgSqlPath, 'utf8');
                await safeDDL('ddl#51', () => pool.query(pkgSql));
                // 兼容旧表：补充 name / attribute / weight 字段
                await safeDDL('ddl#52', () => pool.query(`
                    ALTER TABLE sys_logistics_packaging
                    ADD COLUMN IF NOT EXISTS name VARCHAR(100) NOT NULL DEFAULT '',
                    ADD COLUMN IF NOT EXISTS attribute VARCHAR(50) NOT NULL DEFAULT '',
                    ADD COLUMN IF NOT EXISTS weight NUMERIC(10,3) NOT NULL DEFAULT 0
                `));
                logger.info('[DDL] 物流耗材数据表初始化完成 ✓');
            }
        } catch (pkgErr) {
            logger.error('[DDL] 物流耗材数据表初始化失败：' + pkgErr.message);
        }

        // ■ 打包方案统一表初始化（单SKU + 多品）
        try {
            const planSqlPath = path.join(__dirname, '../database/create_packaging_plan_table.sql');
            if (fs.existsSync(planSqlPath)) {
                const planSql = fs.readFileSync(planSqlPath, 'utf8');
                await safeDDL('ddl#53', () => pool.query(planSql));
                logger.info('[DDL] 打包方案统一表初始化完成 ✓');
            }
        } catch (planErr) {
            logger.error('[DDL] 打包方案统一表初始化失败：' + planErr.message);
        }

        // ■ 企业资质库模块表初始化
        try {
            const eqSqlPath = path.join(__dirname, '../database/create_enterprise_qualification_tables.sql');
            if (fs.existsSync(eqSqlPath)) {
                const eqSql = fs.readFileSync(eqSqlPath, 'utf8');
                await safeDDL('ddl#54', () => pool.query(eqSql));
                logger.info('[DDL] 企业资质库模块表初始化完成 ✓');
            }
        } catch (eqErr) {
            logger.error('[DDL] 企业资质库模块表初始化失败：' + eqErr.message);
        }


    } catch (err) {
        logger.error('[DDL] 初始化失败：' + err.message);
    }
}
runInitDDL();

// --- 真实的密码哈希鉴权接口（从 sys_users PG 表验证）---
segAuth1(app, __ctx);;



// 状态管理
let lastUpdateStatus = {
    lastUpdate: null,
    status: 'idle',
    message: '',
    isRunning: false
};

// 修复 multer/busboy 默认 latin1 解码导致的中文文件名乱码（如 é¿å·´ → 阿巴），仅用于日志等展示场景
const fixUploadedFileName = (name) => {
    if (!name || typeof name !== 'string') return name;
    // 乱码特征：UTF-8 中文字节被 latin1 解码后会出现 é/å/ï/ç 等 Latin-1 补充区字符
    if (/[\u00C0-\u00FF]/.test(name)) {
        const restored = Buffer.from(name, 'latin1').toString('utf8');
        // 还原结果含替换符 � 说明原文本就是合法文本（如 café.pdf），保留原值
        if (!restored.includes('\uFFFD')) return restored;
    }
    return name;
};

// ── 操作审计日志记录工具 ──
// logAudit 已迁至 server/infra/audit.js（XO-01）
// 将工具挂载到 app 上，方便在 userAdminRoutes.js 等分发路由中使用
app.set('logAudit', logAudit);

// 用户管理路由挂载
app.use('/api/admin', userAdminRoutes);  // admin CRUD 接口
app.use('/api/admin', configAdminRoutes); // 系统配置维护 接口
app.use('/api/user', userAdminRoutes);   // 个人中心接口

// Python脚本执行函数
function runPythonScript() {
    return new Promise((resolve, reject) => {
        if (lastUpdateStatus.isRunning) {
            reject(new Error('数据更新任务正在执行中，请稍后再试'));
            return;
        }

        lastUpdateStatus.isRunning = true;
        lastUpdateStatus.status = 'running';
        lastUpdateStatus.message = '正在执行Python脚本...';

        logger.info('开始执行Python脚本...');

        const python = spawn('python', ['scripts/a2_integrated_forecasting.py']);
        let output = '';
        let errorOutput = '';

        // 防死锁：120秒超时杀除子进程并释放锁
        const timeoutId = setTimeout(() => {
            if (lastUpdateStatus.isRunning) {
                logger.error('Python 执行超时 120s，触发应急杀除进程与强制释放并发锁！');
                python.kill('SIGKILL');
                lastUpdateStatus.isRunning = false;
                lastUpdateStatus.status = 'error';
                lastUpdateStatus.message = '数据生成超时，进程已中止';
                reject(new Error('数据生成超时，进程已中止'));
            }
        }, 120000);

        python.stdout.on('data', (data) => {
            const text = data.toString();
            output += text;
            logger.info(`[Python输出] ${text.trim()}`);
        });

        python.stderr.on('data', (data) => {
            const text = data.toString();
            errorOutput += text;
            logger.error(`[Python错误] ${text.trim()}`);
        });

        python.on('close', (code) => {
            clearTimeout(timeoutId);
            if (!lastUpdateStatus.isRunning) return; // 已被上方超时拦截

            lastUpdateStatus.isRunning = false;

            if (code === 0) {
                logger.info('[Python脚本] 执行成功');

                // 移动JSON文件到public文件夹
                try {
                    const sourcePath = path.join(__dirname, '../sales_analysis_matrix.json');
                    const destPath = path.join(__dirname, '../public', 'sales_analysis_matrix.json');

                    if (fs.existsSync(sourcePath)) {
                        fs.copyFileSync(sourcePath, destPath);
                        fs.unlinkSync(sourcePath);  // 删除源文件
                        console.log('[文件移动] JSON文件已移动到public文件夹');

                        lastUpdateStatus.lastUpdate = new Date().toISOString();
                        lastUpdateStatus.status = 'success';
                        lastUpdateStatus.message = '数据更新成功';

                        // 读取新 JSON 文件里的 query_time 回传给前端
                        let queryTime = lastUpdateStatus.lastUpdate;
                        try {
                            const newJson = JSON.parse(fs.readFileSync(destPath, 'utf-8'));
                            queryTime = newJson?.meta_info?.query_time || queryTime;
                        } catch (readErr) {
                            console.warn('[文件读取] 无法读取新JSON的query_time:', readErr.message);
                        }

                        resolve({
                            success: true,
                            message: '数据更新成功',
                            timestamp: lastUpdateStatus.lastUpdate,
                            queryTime
                        });
                    } else {
                        throw new Error('未找到生成的JSON文件');
                    }
                } catch (moveError) {
                    console.error('[文件移动错误]', moveError);
                    lastUpdateStatus.status = 'error';
                    lastUpdateStatus.message = `文件移动失败: ${moveError.message}`;
                    reject(moveError);
                }
            } else {
                console.error(`[Python脚本] 执行失败，退出码: ${code}`);
                lastUpdateStatus.status = 'error';
                lastUpdateStatus.message = `Python脚本执行失败 (退出码: ${code})`;
                reject(new Error(`Python脚本执行失败: ${errorOutput || '未知错误'}`));
            }
        });

        python.on('error', (error) => {
            lastUpdateStatus.isRunning = false;
            lastUpdateStatus.status = 'error';
            lastUpdateStatus.message = `无法启动Python: ${error.message}`;
            console.error('[Python启动错误]', error);
            reject(error);
        });
    });
}



// API路由: 手动触发数据更新
segMisc2(app, __ctx);;

// ==================== 每日新闻 Dify 工作流 ====================

let lastNewsUpdateStatus = {
    lastUpdate: null,
    status: 'idle',
    message: '',
    isRunning: false
};

const NEWS_JSON_PATH = path.join(__dirname, '../public', 'daily_news.json');
const NEWS_PREFS_PATH = path.join(__dirname, '../require', 'news_preferences.json');

// 获取新闻偏好配置 (使用 require/news_preferences.json 作为唯一唯一数据源)
function getNewsPrefs() {
    try {
        if (fs.existsSync(NEWS_PREFS_PATH)) {
            const data = JSON.parse(fs.readFileSync(NEWS_PREFS_PATH, 'utf-8'));
            return {
                defaultIndustry: data.defaultIndustry || 'AI、人工智能、大模型',
                countLimit: data.countLimit || 12,
                pushTime: data.pushTime || '08:30'
            };
        }
    } catch (e) {
        console.error('[Prefs] 读取失败:', e);
    }
    return { defaultIndustry: 'AI、人工智能、大模型', countLimit: 12, pushTime: '08:30' };
}

async function generateDailyNews(triggerUser = 'system_cron', industry = '') {
    if (lastNewsUpdateStatus.isRunning) return { success: false, message: '新闻生成任务正在执行中' };

    lastNewsUpdateStatus.isRunning = true;
    lastNewsUpdateStatus.status = 'running';
    lastNewsUpdateStatus.message = '正在请求 Dify 工作流生成今日新闻...';

    try {
        console.log(`[${new Date().toISOString()}] 开始执行每日新闻抓取工作流...`);
        const apiKey = process.env.DIFY_NEWS_API_KEY;
        const apiUrl = process.env.DIFY_NEWS_API_URL;

        if (!apiKey || !apiUrl) throw new Error('DIFY_NEWS_API_KEY 或 DIFY_NEWS_API_URL 未配置');

        // 调用 Dify 工作流
        const response = await fetch(`${apiUrl}/workflows/run`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: {
                    industry: industry,
                    query: industry
                },
                response_mode: 'blocking',
                user: triggerUser
            })
        });

        if (!response.ok) throw new Error(`Dify API 请求失败: ${await response.text()}`);

        const data = await response.json();

        // 提取 Dify 响应中的 JSON
        let newsData = {};
        if (data && data.data && data.data.outputs) {
            // 处理 Workflow 返回结构
            const outputs = data.data.outputs;
            const firstOutputVal = Object.values(outputs)[0];
            if (typeof firstOutputVal === 'string') {
                try {
                    const cleaned = firstOutputVal.replace(/```json/g, '').replace(/```/g, '').trim();
                    newsData = JSON.parse(cleaned);
                } catch (e) {
                    throw new Error(`Dify Workflow结果无法解析为 JSON: ${firstOutputVal}`);
                }
            } else if (typeof firstOutputVal === 'object') {
                newsData = firstOutputVal;
            } else {
                newsData = outputs;
            }
        } else {
            throw new Error('未收到有效的 Dify 返回格式');
        }

        // 优先使用 report_date，若无则使用 date，若都无则使用今天
        if (!newsData.date) {
            newsData.date = newsData.report_date || new Date().toISOString().split('T')[0];
        }

        // 保存文件到 public/daily_news.json 供前端获取
        fs.mkdirSync(path.dirname(NEWS_JSON_PATH), { recursive: true });
        fs.writeFileSync(NEWS_JSON_PATH, JSON.stringify(newsData, null, 2), 'utf-8');

        // 同步保存至数据库历史记录
        try {
            const timestamp = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 23);
            await pool.query(
                'INSERT INTO app_news_history (report_date, industry, content, created_at) VALUES ($1, $2, $3, $4)',
                [newsData.date, industry, newsData, timestamp]
            );
            console.log('[History] 今日新闻已同步至数据库历史记录 ✓');
        } catch (dbErr) {
            console.error('[History] 存储数据库失败:', dbErr);
        }

        lastNewsUpdateStatus.lastUpdate = new Date().toISOString();
        lastNewsUpdateStatus.status = 'success';
        lastNewsUpdateStatus.message = '今日新闻更新成功';

        return { success: true, data: newsData };
    } catch (error) {
        console.error('[每日新闻错误]', error);
        lastNewsUpdateStatus.status = 'error';
        lastNewsUpdateStatus.message = error.message;
        return { success: false, message: error.message };
    } finally {
        lastNewsUpdateStatus.isRunning = false;
    }
}

// 每日定时任务：每分钟检查一次，匹配用户设定的时间即触发
if (envBool('ENABLE_NEWS_CRON', true)) {
    cron.schedule('* * * * *', () => {
        const prefs = getNewsPrefs();
        const now = new Date();
        const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

        if (currentTime === prefs.pushTime) {
            console.log(`[Cron] 匹配到推送时间 ${prefs.pushTime}，开始执行自动新闻生成任务 (关键词: ${prefs.defaultIndustry})`);
            generateDailyNews('system_cron', prefs.defaultIndustry).catch(console.error);
        }
    });
} else {
    console.log('[定时任务] 每日新闻自动推送已禁用 (ENABLE_NEWS_CRON=false)');
}

// 手动触发生成新闻 API
segNews1(app, __ctx);;

// ==================== 结束 每日新闻 工作流 ====================

// API路由: 调用智能引擎进行AI分析
segMisc3(app, __ctx);;

// 定时任务: 每小时执行一次（整点执行）
if (envBool('ENABLE_DATA_UPDATE_CRON', true)) {
    cron.schedule('0 * * * *', () => {
        console.log(`[定时任务] ${new Date().toISOString()} - 触发自动数据更新`);
        runPythonScript()
            .then(result => {
                console.log('[定时任务] 执行成功:', result);
            })
            .catch(error => {
                console.error('[定时任务] 执行失败:', error.message);
            });
    });
} else {
    console.log('[定时任务] 销售数据自动更新已禁用 (ENABLE_DATA_UPDATE_CRON=false)');
}

// ====================== Dify 版式对比功能集成 ======================

// 1. Dify 图片上传中转提取 upload_file_id
segMisc4(app, __ctx);;

// ====================== 发票校验功能集成 ======================

// 1. 发票校验 - 文件上传中转（PDF/xlsx → Dify file_id）
segInvoiceVerify1(app, __ctx);;

// 2. 发票校验 - 触发 Dify 工作流
/**
 * 发票校验结果解析 + 落历史 + 响应（D4 试点迁移抽出）。
 * 旧直连路径与任务中心试点路径共用：输入统一为 Dify 阻塞响应形 bodyData。
 */
async function respondInvoiceBody(req, res, bodyData, { pdfNames, xlsxNames }) {
        // bodyData 由参数传入
        let finalReport = '';
        const rawOutputs = bodyData?.data?.outputs || bodyData?.data || bodyData;

        // 提取原始文本
        let rawText = '';
        if (rawOutputs && typeof rawOutputs === 'object' && Object.keys(rawOutputs).length > 0) {
            if (rawOutputs.text !== undefined) {
                rawText = typeof rawOutputs.text === 'object' ? JSON.stringify(rawOutputs.text) : String(rawOutputs.text);
            } else if (rawOutputs.result !== undefined) {
                rawText = typeof rawOutputs.result === 'object' ? JSON.stringify(rawOutputs.result) : String(rawOutputs.result);
            } else if (rawOutputs.output !== undefined) {
                rawText = typeof rawOutputs.output === 'object' ? JSON.stringify(rawOutputs.output) : String(rawOutputs.output);
            } else {
                const firstKeyVal = Object.values(rawOutputs)[0];
                rawText = typeof firstKeyVal === 'object' ? JSON.stringify(firstKeyVal, null, 2) : String(firstKeyVal);
            }
        } else {
            finalReport = "【警示】未截获有效输出。通讯帧：\n```json\n" + JSON.stringify(bodyData, null, 2) + "\n```";
        }

        // 尝试解析为结构化发票校验结果
        // 辅助函数：解析加法表达式（如 "2+4" → 6, "124.00+248.00" → 372, 支持负数）
        const parseAdditionVal = (val) => {
            const str = String(val ?? '0').trim();
            if (!str) return 0;
            // 用正则提取所有数字（含负号），如 "-3+4" → ["-3", "4"]
            const nums = str.match(/-?\d+(?:\.\d+)?/g);
            if (!nums || nums.length === 0) return 0;
            return nums.reduce((sum, n) => sum + parseFloat(n), 0);
        };
        let isVerifySuccess = false; // 标记校验是否成功
        let extractedSupplierName = ''; // 供应商名称
        if (rawText && !finalReport) {
            try {
                const parsed = JSON.parse(rawText);
                if (parsed && (parsed.matched || parsed.unmatched)) {
                    isVerifySuccess = true; // 校验成功
                    const total = parsed.total_invoice_items || ((parsed.matched?.length || 0) + (parsed.unmatched?.length || 0));
                    const matchedCount = parsed.matched?.length || 0;
                    const unmatchedCount = parsed.unmatched?.length || 0;
                    const isValid = parsed.is_valid !== false;

                    // 构建摘要
                    const totalInvoiceItems = parsed.total_invoice_items || 0;
                    const totalReconciliationItems = parsed.total_reconciliation_items || 0;
                    const supplierName = parsed.supplier_name || parsed.vendor_name || '';
                    extractedSupplierName = supplierName; // 保存到外层作用域
                    finalReport = `## ${isValid ? '✅ 校验通过' : '⚠️ 校验存在差异'}\n\n`;
                    finalReport += `> 对账完成，匹配 ${matchedCount} 项，未匹配 ${unmatchedCount} 项（发票文件 ${totalInvoiceItems} 项，对账表格 ${totalReconciliationItems} 项${supplierName ? '，供应商：' + supplierName : ''}）\n\n`;

                    // 未匹配项（优先展示）
                    if (parsed.unmatched && parsed.unmatched.length > 0) {
                        finalReport += `### ❌ 未匹配项（${unmatchedCount} 项）\n\n`;
                        finalReport += `| 发票商品 | 对账商品 | 发票数量 | 对账数量 | 发票金额 | 对账金额 | 发票税率 | 预期税率 | 原因 |\n`;
                        finalReport += `|----------|----------|----------|----------|----------|----------|----------|----------|------|\n`;
                        let sumInvoiceQty = 0, sumReconciliationQty = 0, sumInvoiceAmount = 0, sumReconciliationAmount = 0;
                        parsed.unmatched.forEach(item => {
                            sumInvoiceQty += parseAdditionVal(item.invoice_quantity);
                            sumReconciliationQty += parseAdditionVal(item.reconciliation_quantity);
                            sumInvoiceAmount += parseAdditionVal(item.invoice_amount);
                            sumReconciliationAmount += parseAdditionVal(item.reconciliation_amount);
                        });
                        finalReport += `| **汇总** | - | **${sumInvoiceQty}** | **${sumReconciliationQty}** | **${sumInvoiceAmount.toFixed(2)}** | **${sumReconciliationAmount.toFixed(2)}** | - | - | - |\n`;
                        parsed.unmatched.forEach(item => {
                            finalReport += `| ${item.invoice_name || '-'} | ${item.reconciliation_name || '-'} | ${item.invoice_quantity || '-'} | ${item.reconciliation_quantity || '-'} | ${item.invoice_amount || '-'} | ${item.reconciliation_amount || '-'} | ${item.invoice_tax_rate || '-'} | ${item.expected_tax_rate || '-'} | ${item.reason || '-'} |\n`;
                        });
                        finalReport += '\n';
                    }

                    // 匹配项
                    if (parsed.matched && parsed.matched.length > 0) {
                        finalReport += `### ✅ 已匹配项（${matchedCount} 项）\n\n`;
                        finalReport += `| 发票商品 | 对账商品 | 发票数量 | 对账数量 | 发票金额 | 对账金额 | 发票税率 | 预期税率 |\n`;
                        finalReport += `|----------|----------|----------|----------|----------|----------|----------|----------|\n`;
                        let sumInvoiceQty2 = 0, sumReconciliationQty2 = 0, sumInvoiceAmount2 = 0, sumReconciliationAmount2 = 0;
                        parsed.matched.forEach(item => {
                            sumInvoiceQty2 += parseAdditionVal(item.invoice_quantity);
                            sumReconciliationQty2 += parseAdditionVal(item.reconciliation_quantity);
                            sumInvoiceAmount2 += parseAdditionVal(item.invoice_amount);
                            sumReconciliationAmount2 += parseAdditionVal(item.reconciliation_amount);
                        });
                        finalReport += `| **汇总** | - | **${sumInvoiceQty2}** | **${sumReconciliationQty2}** | **${sumInvoiceAmount2.toFixed(2)}** | **${sumReconciliationAmount2.toFixed(2)}** | - | - |\n`;
                        parsed.matched.forEach(item => {
                            finalReport += `| ${item.invoice_name || '-'} | ${item.reconciliation_name || '-'} | ${item.invoice_quantity || '-'} | ${item.reconciliation_quantity || '-'} | ${item.invoice_amount || '-'} | ${item.reconciliation_amount || '-'} | ${item.invoice_tax_rate || '-'} | ${item.expected_tax_rate || '-'} |\n`;
                        });
                    }
                } else {
                    // 不是发票校验结构，原样返回
                    finalReport = rawText;
                }
            } catch (jsonErr) {
                // 不是 JSON，原样返回
                finalReport = rawText;
            }
        }

        if (finalReport === 'undefined' || (!finalReport && rawText)) {
            finalReport = rawText || "【未定义输出】原始回传报文：\n```json\n" + JSON.stringify(rawOutputs, null, 2) + "\n```";
        }

        // 过滤  标签
        if (typeof finalReport === 'string') {
            finalReport = finalReport.replace(/<think>[\s\S]*?<\/think>(\\n|\s)*/gi, '').trim();
            finalReport = finalReport.replace(/\\n/g, '\n');
        }

        // 只有校验成功才保存历史记录
        let newRecordId = null;
        if (isVerifySuccess) {
            const pdfNameStr = (pdfNames || []).join(', ');
            const xlsxNameStr = (xlsxNames || []).join(', ');
            const insertResult = await pool.query(
                `INSERT INTO invoice_verify_history (pdf_name, xlsx_name, result_text, supplier_name, username) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
                [pdfNameStr, xlsxNameStr, finalReport, extractedSupplierName, req.user?.username || 'web_os_user']
            );
            newRecordId = insertResult.rows[0]?.id || null;
        }

        res.json({ success: true, data: finalReport, isVerifySuccess, historyId: newRecordId });
}

segInvoiceVerify2(app, __ctx);;

// ====================== 商品库录入功能集成 ======================

// 1. 商品库录入 - 文件上传中转（xlsx → Dify file_id）
segProductEntry1(app, __ctx);;

// 商品库录入 - 工作流进度跟踪（内存存储）
const workflowProgress = new Map();

// 6. 商品库录入 - 获取工作流进度
segProductEntry2(app, __ctx);;

// ====================== 电商广告法合规检测整合 ======================

segRiskDetection1(app, __ctx);;

// ====================== 动态滚动修正功能 ======================

// 工具函数：延迟
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 分批预测所有SKU
// brandDict: [{ id, brand_name }]，来自 PostgreSQL brand_dictionary 表，用于调用前品牌脱敏
async function batchForecastAllSkus(salesData, batchSize = 20, brandDict = []) {
    const allSkuIds = salesData.monthly_matrix.map(row => row.sku_id);
    const batches = [];

    // 分批
    for (let i = 0; i < allSkuIds.length; i += batchSize) {
        batches.push(allSkuIds.slice(i, i + batchSize));
    }

    console.log(`[分批预测] 共${allSkuIds.length}个SKU，分为${batches.length}批`);

    const allResults = [];

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batchSkuIds = batches[batchIndex];

        // 过滤数据
        const batchData = {
            monthly_matrix: salesData.monthly_matrix.filter(
                row => batchSkuIds.includes(row.sku_id)
            ),
            quarterly_matrix: salesData.quarterly_matrix.filter(
                row => batchSkuIds.includes(row.sku_id)
            ),
            meta_info: salesData.meta_info
        };

        console.log(`[分批预测] 执行第${batchIndex + 1}/${batches.length}批 (${batchSkuIds.length}个SKU)`);

        try {
            // 调用Dify API
            const DIFY_API_KEY = process.env.DIFY_CHATFLOW_API_KEY || 'app-xxx';
            const DIFY_API_URL = process.env.DIFY_CHATFLOW_API_URL || 'http://39.108.221.22/v1/chat-messages';
            // ====== 【品牌脱敏】调用前将 product_name 中的品牌名替换为"品牌[id]" ======
            const maskedBatchData = maskProductNamesByBrandDict(batchData, brandDict);
            if (brandDict.length > 0) {
                console.log(`[分批预测] 品牌脱敏完成，共使用 ${brandDict.length} 个品牌规则`);
            }
            // =====================================================================

            const difyRequestBody = {
                inputs: {
                    scenario: 'monthly_baseline'
                },
                query: JSON.stringify(maskedBatchData, null, 2),  // 发送脱敏后的数据
                response_mode: "blocking",  // 使用阻塞模式，等待完整结果
                conversation_id: "",
                user: "system_scheduler"
            };

            const difyResponse = await fetch(DIFY_API_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${DIFY_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(difyRequestBody)
            });

            if (!difyResponse.ok) {
                const errorText = await difyResponse.text();
                console.error(`[分批预测] 批次${batchIndex + 1}失败 HTTP ${difyResponse.status}:`, errorText.substring(0, 300));
                continue;
            }

            const result = await difyResponse.json();

            // ===== 详细诊断日志 =====
            console.log(`[分批预测] 批次${batchIndex + 1} 响应键:`, Object.keys(result));
            const answerText = result.answer || result.text || result.content || '';
            if (!answerText) {
                console.warn(`[分批预测] 批次${batchIndex + 1} ⚠️ 无answer字段, 完整响应:`, JSON.stringify(result).substring(0, 500));
                continue;
            }
            console.log(`[分批预测] 批次${batchIndex + 1} answer长度:${answerText.length}, 前200字:`, answerText.substring(0, 200));
            // =======================

            // 提取JSON（三种格式）
            const jsonMatch =
                answerText.match(/```json\s*([\s\S]*?)```/) ||
                answerText.match(/```\s*([\[{][\s\S]*?[\]}])\s*```/) ||
                answerText.match(/(\[[\s\S]*?\])/);   // 裸JSON数组兜底

            if (!jsonMatch || !jsonMatch[1]) {
                console.warn(`[分批预测] 批次${batchIndex + 1} ⚠️ 未找到JSON块, answer内容:`, answerText.substring(0, 400));
                continue;
            }

            if (jsonMatch && jsonMatch[1]) {
                const parsedData = JSON.parse(jsonMatch[1]);
                let predictions = null;

                if (Array.isArray(parsedData)) {
                    predictions = parsedData;
                } else if (parsedData.forecast_result && Array.isArray(parsedData.forecast_result)) {
                    predictions = parsedData.forecast_result;
                } else if (parsedData.forecast_results && Array.isArray(parsedData.forecast_results)) {
                    predictions = parsedData.forecast_results;
                } else {
                    const arrayField = Object.values(parsedData).find(val => Array.isArray(val));
                    if (arrayField) predictions = arrayField;
                }

                if (predictions && predictions.length > 0) {
                    // ====== 【还原】用原始 salesData 补全真实 product_name ======
                    // Dify 返回结果只含 sku_id + 预测数值，product_name 需从本地原始数据映射回来
                    const enriched = predictions.map(pred => {
                        const origRow = salesData.monthly_matrix.find(r => r.sku_id === pred.sku_id);
                        return {
                            ...pred,
                            product_name: origRow?.product_name || pred.product_name || ''
                        };
                    });
                    allResults.push(...enriched);
                    console.log(`[分批预测] 批次${batchIndex + 1}成功，获得${enriched.length}条预测（product_name 已还原）`);
                    // ===========================================================
                }
            }

        } catch (error) {
            console.error(`[分批预测] 批次${batchIndex + 1}错误:`, error.message);
        }

        // 批次间延迟1秒
        if (batchIndex < batches.length - 1) {
            await sleep(1000);
        }
    }

    return allResults;
}

// 月初预测生成
async function generateMonthlyBaseline() {
    try {
        console.log('\n' + '='.repeat(60));
        console.log('[月初预测] 开始生成月度基线预测');
        console.log('='.repeat(60));

        const today = new Date();
        const year = today.getFullYear();
        const month = today.getMonth() + 1;
        const forecastMonth = `${year}-${String(month).padStart(2, '0')}`;

        // 读取销售数据
        const salesDataPath = path.join(__dirname, '../public', 'sales_analysis_matrix.json');
        if (!fs.existsSync(salesDataPath)) {
            console.error('[月初预测] 错误: sales_analysis_matrix.json 不存在');
            return;
        }

        const salesData = JSON.parse(fs.readFileSync(salesDataPath, 'utf-8'));

        // ====== 【品牌字典】从 PostgreSQL 加载品牌脱敏映射表 ======
        let brandDict = [];
        try {
            const brandRes = await pool.query('SELECT id, brand_name FROM brand_dictionary ORDER BY id');
            brandDict = brandRes.rows;
            console.log(`[月初预测] 已加载品牌字典，共 ${brandDict.length} 条品牌记录`);
        } catch (brandErr) {
            console.warn('[月初预测] ⚠️ 品牌字典加载失败，将以未脱敏数据继续（不影响预测结果）:', brandErr.message);
        }
        // =========================================================

        // 分批预测（传入品牌字典，调用前自动完成 product_name 脱敏）
        const allResults = await batchForecastAllSkus(salesData, 20, brandDict);

        // 保存结果（只有成功获取到预测时才覆盖旧基线）
        if (allResults.length === 0) {
            console.warn('[月初预测] ⚠️ 所有批次均未获得预测结果，放弃覆盖旧基线文件');
            return;
        }

        const forecastBaseline = {
            forecast_month: forecastMonth,
            generated_at: new Date().toISOString(),
            forecast_results: allResults,
            metadata: {
                total_skus: allResults.length,
                prediction_model: 'dify_chatflow',
                batch_count: Math.ceil(salesData.monthly_matrix.length / 20)
            }
        };

        const baselinePath = path.join(__dirname, '../public', 'monthly_forecast_baseline.json');
        fs.writeFileSync(baselinePath, JSON.stringify(forecastBaseline, null, 2));

        // 只有在月份切换时才重置跟踪文件，同月内重新生成不清空偏差数据
        const trackingPath = path.join(__dirname, '../public', 'forecast_tracking.json');
        let shouldResetTracking = true;
        if (fs.existsSync(trackingPath)) {
            try {
                const existing = JSON.parse(fs.readFileSync(trackingPath, 'utf-8'));
                if (existing.current_month === forecastMonth) {
                    shouldResetTracking = false;
                    console.log('[月初预测] 同月内重新生成，保留现有偏差跟踪数据');
                }
            } catch (_) { /* 解析失败则重置 */ }
        }
        if (shouldResetTracking) {
            fs.writeFileSync(trackingPath, JSON.stringify({
                current_month: forecastMonth,
                last_tracking_date: null,
                deviations: [],
                unread_alerts: 0
            }, null, 2));
            console.log('[月初预测] 新月份检测到，已初始化偏差跟踪文件');
        }

        console.log(`[月初预测] ✅ 完成！生成${allResults.length}个SKU的预测`);
        console.log(`[月初预测] 保存至: ${baselinePath}`);
        console.log('='.repeat(60) + '\n');

    } catch (error) {
        console.error('[月初预测] ❌ 错误:', error.message);
    }
}

// 偏差跟踪
async function trackSalesDeviation() {
    try {
        console.log('\n' + '='.repeat(60));
        console.log('[偏差跟踪] 开始执行销售偏差跟踪');
        console.log('='.repeat(60));

        const today = new Date();
        const year = today.getFullYear();
        const month = today.getMonth() + 1;
        const dayOfMonth = today.getDate();
        const daysInMonth = new Date(year, month, 0).getDate();
        const currentMonth = `${year}-${String(month).padStart(2, '0')}`;
        const currentMonthShort = `${year % 100}.${month}`;  // 如 '26.3'

        // 读取基线预测
        const baselinePath = path.join(__dirname, 'public', 'monthly_forecast_baseline.json');
        if (!fs.existsSync(baselinePath)) {
            console.log('[偏差跟踪] ⚠️ 月度预测文件不存在，跳过');
            return;
        }

        const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));

        if (baseline.forecast_month !== currentMonth) {
            console.log(`[偏差跟踪] ⚠️ 预测月份(${baseline.forecast_month})与当前月份(${currentMonth})不符，跳过`);
            return;
        }

        // 读取销售数据
        const salesDataPath = path.join(__dirname, 'public', 'sales_analysis_matrix.json');
        const salesData = JSON.parse(fs.readFileSync(salesDataPath, 'utf-8'));

        // 检查当月列是否存在
        if (!salesData.meta_info.monthly_columns.includes(currentMonthShort)) {
            console.log(`[偏差跟踪] ⚠️ 销售数据中不包含当月列(${currentMonthShort})，跳过`);
            return;
        }

        // 计算偏差
        const deviations = [];
        const progressRatio = dayOfMonth / daysInMonth;

        console.log(`[偏差跟踪] 当前进度: ${dayOfMonth}/${daysInMonth}天 (${(progressRatio * 100).toFixed(1)}%)`);

        for (const forecast of baseline.forecast_results) {
            const salesRow = salesData.monthly_matrix.find(row => row.sku_id === forecast.sku_id);
            if (!salesRow) continue;

            const actualCumulative = salesRow[currentMonthShort] || 0;
            const expectedProgress = forecast.current_month_forecast * progressRatio;
            const achievementRate = expectedProgress > 0 ? (actualCumulative / expectedProgress) * 100 : 100;
            const deviationRate = achievementRate - 100;

            // 偏差超过±20%才记录
            if (Math.abs(deviationRate) > 20) {
                deviations.push({
                    sku_id: forecast.sku_id,
                    product_name: salesRow.product_name || '',
                    tracking_date: today.toISOString().split('T')[0],
                    forecast_value: forecast.current_month_forecast,
                    expected_progress: Math.round(expectedProgress),
                    actual_cumulative: actualCumulative,
                    achievement_rate: Math.round(achievementRate),
                    deviation_rate: Math.round(deviationRate),
                    suggestion: deviationRate < 0 ? 'decrease' : 'increase',
                    adjustment_amount: Math.round(Math.abs(forecast.current_month_forecast * deviationRate / 100)),
                    severity: Math.abs(deviationRate) > 30 ? 'high' : 'medium'
                });
            }
        }

        // 更新跟踪文件
        const tracking = {
            current_month: currentMonth,
            last_tracking_date: today.toISOString().split('T')[0],
            tracking_time: today.toISOString(),
            progress_ratio: Math.round(progressRatio * 100),
            deviations: deviations,
            unread_alerts: deviations.length,
            summary: {
                total_skus: baseline.forecast_results.length,
                deviation_count: deviations.length,
                high_severity: deviations.filter(d => d.severity === 'high').length,
                medium_severity: deviations.filter(d => d.severity === 'medium').length
            }
        };

        const trackingPath = path.join(__dirname, '../public', 'forecast_tracking.json');
        fs.writeFileSync(trackingPath, JSON.stringify(tracking, null, 2));

        console.log(`[偏差跟踪] ✅ 完成！发现${deviations.length}个异常SKU`);
        console.log(`[偏差跟踪]    严重偏差: ${tracking.summary.high_severity}个`);
        console.log(`[偏差跟踪]    中度偏差: ${tracking.summary.medium_severity}个`);
        console.log('='.repeat(60) + '\n');

    } catch (error) {
        console.error('[偏差跟踪] ❌ 错误:', error.message);
    }
}

// 定时任务：月初预测（每月1号凌晨2点）
if (envBool('ENABLE_MONTHLY_FORECAST_CRON', true)) {
    cron.schedule('0 2 1 * *', () => {
        console.log(`[定时任务] ${new Date().toISOString()} - 触发月初预测生成`);
        generateMonthlyBaseline();
    });
} else {
    console.log('[定时任务] 月初预测定时任务已禁用 (ENABLE_MONTHLY_FORECAST_CRON=false)');
}

// 定时任务：偏差跟踪（每月5/10/15/20/25号早上8点）
if (envBool('ENABLE_DEVIATION_TRACKING_CRON', true)) {
    cron.schedule('0 8 5,10,15,20,25 * *', () => {
        console.log(`[定时任务] ${new Date().toISOString()} - 触发销售偏差跟踪`);
        trackSalesDeviation();
    });
} else {
    console.log('[定时任务] 销售偏差跟踪定时任务已禁用 (ENABLE_DEVIATION_TRACKING_CRON=false)');
}

// API端点：手动触发月初预测（同步等待结果）
segMisc5(app, __ctx);;

// ==================== 月度预测基线补跑机制 ====================

async function checkAndGenerateBaselineIfMissing() {
    try {
        const today = new Date();
        const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
        const baselinePath = path.join(__dirname, '../public', 'monthly_forecast_baseline.json');

        let needGenerate = false;
        let reason = '';

        if (!fs.existsSync(baselinePath)) {
            needGenerate = true;
            reason = '当月基线文件不存在';
        } else {
            const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
            if (baseline.forecast_month !== currentMonth) {
                needGenerate = true;
                reason = `基线月份(${baseline.forecast_month})与当前月份(${currentMonth})不符`;
            }
        }

        if (needGenerate) {
            console.log(`[启动自检] ⚠️ ${reason}，触发月度预测生成...`);
            await generateMonthlyBaseline();
        } else {
            console.log(`[启动自检] ✅ 当月(${currentMonth})基线已存在，跳过生成`);
        }
    } catch (error) {
        console.error('[启动自检] ❌ 错误:', error.message);
    }
}

// 每月2~7号凌晨3点补跑自检（保障月初1号宕机时的补跑）
if (envBool('ENABLE_FORECAST_BACKUP_CRON', true)) {
    cron.schedule('0 3 2-7 * *', () => {
        console.log(`[定时补跑] ${new Date().toISOString()} - 执行月度预测基线自检`);
        checkAndGenerateBaselineIfMissing();
    });
} else {
    console.log('[定时任务] 月度预测补跑自检定时任务已禁用 (ENABLE_FORECAST_BACKUP_CRON=false)');
}

// ==================== 月度预测基线补跑机制结束 ====================

// ==================== 招标检索定时任务 ====================
// 定时任务：每天凌晨 2 点自动调用 Dify 检索招标数据并存入数据库
if (envBool('ENABLE_TENDER_SEARCH_CRON', false)) {
    cron.schedule('0 2 * * *', async () => {
        console.log(`[定时任务] ${new Date().toISOString()} - 触发招标检索定时任务`);
        try {
            const result = await runTenderSearchDify({ user: 'cron_scheduler', top_n: 50 });
            console.log(`[定时任务] 招标检索完成: ${result.success ? '成功' : '失败'}, items: ${result.items_count || 0}`);
        } catch (err) {
            console.error(`[定时任务] 招标检索失败: ${err.message}`);
        }
    });
    cron.schedule('0 4 * * *', async () => {
        console.log(`[定时任务] ${new Date().toISOString()} - 触发招标详情同步定时任务`);
        try {
            const result = await syncTenderStarredDetail({ user: 'cron_scheduler' });
            console.log(`[定时任务] 招标详情同步完成: ${result.success ? '成功' : '失败'}, 更新: ${result.updated_count || 0}`);
        } catch (err) {
            console.error(`[定时任务] 招标详情同步失败: ${err.message}`);
        }
    });
        console.log('[定时任务] 招标检索定时任务已启用 (02:00 检索, 04:00 详情&结果同步)');
} else {
    console.log('[定时任务] 招标检索定时任务已禁用 (ENABLE_TENDER_SEARCH_CRON=false)');
}
// ==================== 招标检索定时任务结束 ====================

// API端点：手动触发偏差跟踪
segMisc6(app, __ctx);;

// ==================== 动态滚动修正功能结束 ====================

// ==================== AI 工作流后端代理（市场洞察模块）====================
// 将 API Key 保存在后端，前端不持由 Key

// 代理：文件上传 → 分析引擎 /files/upload
segAiWorkflow1(app, __ctx);;

// ==================== AI 工作流后端代理结束 ====================

// ==================== 市场洞察专用分析引擎代理 ====================
segMarketInsight1(app, __ctx);;

// ==================== 合同审核专用分析引擎代理 ====================

// 1. 运行合同审核
segContractAudit1(app, __ctx);;



// ==================== 公司制度问答助手分析引擎 ==================
const getRulesHeaders = () => ({
    'Authorization': `Bearer ${process.env.DIFY_RULES_ASSISTANT_API_KEY || ''}`,
    'Content-Type': 'application/json'
});
const rulesBaseUrl = process.env.DIFY_RULES_ASSISTANT_API_URL || 'http://39.108.221.22/v1';

// 1. 发送消息 (支持流式)
segRules1(app, __ctx);;

/** 客户脱敏特征 JIT 提取与入库工具 */
async function extractCustomerFeaturesJIT(customerId, rawName, username = 'system') {
    try {
        // 1. 查询本地映射表
        const res = await pool.query(
            'SELECT province, city, channel_type, is_individual FROM llm_customer_feature_mapping WHERE client_sqlserver_cust_id = $1',
            [String(customerId)]
        );

        if (res.rowCount > 0) {
            console.log(`[JIT脱敏] 客户 ${customerId} 特征命中缓存 ✓`);
            return res.rows[0];
        }

        // 2. 未命中，触发特征提取工作流
        console.log(`[JIT脱敏] 客户 ${customerId} 特征未命中，触发 AI 提取...`);
        const apiKey = process.env.DIFY_CUSTOMER_FEATURE_EXTRACT_API_KEY;
        const apiUrl = `${process.env.DIFY_CUSTOMER_FEATURE_EXTRACT_API_URL || 'http://39.108.221.22/v1'}/workflows/run`;

        if (!apiKey || apiKey.includes('请填入')) {
            console.warn('[JIT脱敏] DIFY_CUSTOMER_FEATURE_EXTRACT_API_KEY 未配置，跳过 AI 提取');
            return { province: '', city: '', channel_type: '', is_individual: false };
        }

        const payload = [{ id: customerId, name: rawName }];
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: { customer_batch_json: JSON.stringify(payload) },
                query: JSON.stringify(payload),
                response_mode: 'blocking',
                user: username
            })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(`Dify 特征提取失败: ${data.message || response.status}`);

        let features = { province: '', city: '', channel_type: '', is_individual: false };
        try {
            // 兼容性提取：寻找 outputs 下的任何可能包含结果的字段 (result, output, text, customer_batch_json)
            const outputs = data.data?.outputs || {};
            const resultStr = outputs.result || outputs.output || outputs.text || outputs.customer_batch_json || data.answer;

            const parsed = typeof resultStr === 'string' ? JSON.parse(resultStr.replace(/```json|```/g, '').trim()) : resultStr;
            // 获取第一个匹配项
            const item = Array.isArray(parsed) ? parsed[0] : parsed;

            if (item) {
                features = {
                    province: item.province ?? item.省份 ?? '',
                    city: item.city ?? item.城市 ?? '',
                    region: item.province ?? item.省份 ?? '', // 增加 region 别名以适配下游
                    channel_type: item.channel_type ?? item.渠道类型 ?? '',
                    is_individual: !!(item.is_individual ?? item.是否含个人 ?? item.是否个人 ?? false)
                };
            }
        } catch (e) {
            console.error('[JIT脱敏] AI 返回解析失败:', e.message, 'Raw response:', JSON.stringify(data).substring(0, 200));
        }

        // 3. 同步入库 (UPSERT)
        await pool.query(`
            INSERT INTO llm_customer_feature_mapping 
            (client_sqlserver_cust_id, raw_name, province, city, channel_type, is_individual, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, NOW())
            ON CONFLICT (client_sqlserver_cust_id) DO UPDATE SET
            province = EXCLUDED.province, city = EXCLUDED.city, channel_type = EXCLUDED.channel_type, 
            is_individual = EXCLUDED.is_individual, updated_at = NOW()
        `, [String(customerId), rawName, features.province, features.city, features.channel_type, features.is_individual]);

        console.log(`[JIT脱敏] 客户 ${customerId} 特征提取并同步成功 ✓`);
        return features;
    } catch (err) {
        console.error('[JIT脱敏] 特征提取异常:', err.message);
        return { province: '', city: '', channel_type: '', is_individual: false };
    }
}

// ==================== 客户订货建议分析引擎 ====================

segMisc7(app, __ctx);;

// ==================== 客户订货建议结束 ====================

// ==================== 客户分析功能 ====================

// 客户分析运行状态
let customerAnalysisStatus = {
    isRunning: false,
    lastUpdate: null,
    status: 'idle',
    message: ''
};

// API端点：运行 a3_customer_analysis.py，提取并保存 JSON
segMisc8(app, __ctx);;

// ==================== AI 图生图（Doubao seedream-4.0 - 纯Node.js实现）====================
const uploadMemory = multer({ storage: multer.memoryStorage() });

segMisc9(app, __ctx);;

// ==================== AI 图生图结束 ====================


// ==================== 客户分析功能结束 ====================


// ==================== 智能匹配 API ====================
app.use('/api/smart-match', coreServicesLimiter);

segMisc10(app, __ctx);;

// ==================== 美妆智能研发内容生成 API ====================
segBeautyRnd1(app, __ctx);;

// Catch-all 需移动至文件末尾，此处已删除
// ============================================================
// ■ PostgreSQL 基础资料 & 应用配置接口
// ============================================================

/**
 * GET /api/config/:type
 * 返回指定基础资料选项列表
 * type 可选值：
 *   product_types | markets | certifications | pain_points
 *   languages | platforms | marketing_styles | news_keywords | global_config
 * 可选 query: ?module=beauty_rnd|market|sea_marketing
 */
/** GET /api/config/ai_scenes  电商生图专用嵌套配置接口 */
segConfig1(app, __ctx);;

/** [ADMIN] PUT /api/admin/config/ai_fields/:id 更新生图场景字段选项 */
segMisc11(app, __ctx);;

// ============================================================
// ■ 每日推送偏好 — 优先使用 JSON 文件存储 (应用户要求读取完整配置)
// ============================================================

/** GET /api/news/preferences  读取推送偏好 */
segNews2(app, __ctx);;


/** POST /api/material-quote/upload  将用户文件转发至分析引擎并将落盘备份供预览 */
app.post('/api/material-quote/upload', upload.single('file'), async (req, res) => {
    try {
        const apiKey = process.env.DIFY_MATERIAL_QUOTE_API_KEY;
        const baseUrl = (process.env.DIFY_MATERIAL_QUOTE_API_URL || 'http://39.108.221.22/v1/chat-messages')
            .replace(/\/chat-messages$/, '').replace(/\/$/, '');
        if (!apiKey) return res.status(503).json({ error: '服务端未配置物料报价大模型的 API Key。' });
        if (!req.file) return res.status(400).json({ error: '未收到文件' });
        logAudit(req, { module: 'MATERIAL_QUOTE', action: 'UPLOAD_FILE', target_data: req.file.originalname });

        const isPdf = req.file.mimetype === 'application/pdf';
        const fileType = isPdf ? 'document' : 'image';

        // ==== 【新增环】落盘本地存储供预览展示 ====
        let localUrl = '';
        try {
            const uploadDir = path.join(__dirname, '../public', 'uploads', 'material-quote');
            if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
            const fileExt = path.extname(req.file.originalname) || '';
            const safeName = `mq_${Date.now()}_${Math.floor(Math.random() * 1000)}${fileExt}`;
            const targetPath = path.join(uploadDir, safeName);
            // 诊改优化：从磁盘暂存路径复制
            fs.copyFileSync(req.file.path, targetPath);
            localUrl = `/uploads/material-quote/${safeName}`;
        } catch (saveErr) {
            logger.error('[material-quote] 本地保存文件失败: ' + saveErr.message);
        }

        const form = new FormData();
        // 诊改优化：从磁盘读取文件内容外发
        const fileContent = fs.readFileSync(req.file.path);
        const blob = new Blob([fileContent], { type: req.file.mimetype });

        // 修复 multer 在处理中文附件名时默认降级为 latin1 导致的乱码问题
        let originalName = req.file.originalname;
        try {
            originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
        } catch (e) { }

        form.set('file', blob, originalName);
        form.set('user', req.user?.username || 'system');
        form.set('type', fileType);

        const uploadRes = await fetch(`${baseUrl}/files/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}` },
            body: form
        });
        const data = await uploadRes.json();
        if (data.id) {
            data.mimetype = req.file.mimetype;
            data.localUrl = localUrl; // 返回给前端
        }
        return res.json(data);
    } catch (err) {
        logger.error('[material-quote] 文件上传出错: ' + err.message);
        return res.status(500).json({ error: '文件上传失败：' + err.message });
    }
});

/** POST /api/material-quote/run  流式转发至分析引擎并 SSE 返回给前端 */
app.post('/api/material-quote/run', async (req, res) => {
    try {
        const apiKey = process.env.DIFY_MATERIAL_QUOTE_API_KEY;
        const apiUrl = process.env.DIFY_MATERIAL_QUOTE_API_URL || 'http://39.108.221.22/v1/chat-messages';

        const { query, upload_file_id, conversation_id, file_type } = req.body;
        logAudit(req, { module: 'MATERIAL_QUOTE', action: 'RUN_INQUIRY', details: { upload_file_id, file_type } });
        logger.info(`[material-quote] 收到询价请求: file_id=${upload_file_id}, type=${file_type}, user=${req.user?.username}`);

        // ── D4 试点迁移（TASK_CENTER_PILOT 含 material_quote 时启用）──────────
        // 建任务 → 执行 → 通知闭环；响应改为完整 JSON（弃 SSE）。
        // ⚠️ 启用前提：消费方需支持 JSON 响应（本仓库暂无该模块新前端，旧前端为 SSE 消费）。
        if (legacyBridge.isPilotSkill('material_quote')) {
            try {
                const r = await legacyBridge.runThroughTaskCenter({
                    skillKey: 'material_quote',
                    title: `物料报价${upload_file_id ? '（含附件）' : ''}`,
                    user: req.user?.id ? req.user : { id: 0, username: 'material_anonymous', role: 'user' },
                    inputs: { message: query || '开始' },
                    files: upload_file_id ? [String(upload_file_id)] : [],
                });
                if (!r.ok) {
                    console.error(`[物料报价-任务中心] ${r.taskNo} 失败 ${r.errorCode}: ${r.message}`);
                    return res.status(500).json({ success: false, message: `任务执行失败（${r.taskNo}）：${r.message}` });
                }
                const text = String(
                    r.outputs?._extra?.answer ?? r.outputs?.answer
                    ?? legacyBridge.extractAnswerText(r.outputs ?? {}) ?? '',
                );
                return res.json({ success: true, data: text });
            } catch (err) {
                console.error('[物料报价-任务中心] 异常:', err.message);
                return res.status(500).json({ success: false, message: `AI 诊断异常: ${err.message}` });
            }
        }

        if (!apiKey || apiKey.includes('PLACEHOLDER')) {
            return res.status(503).json({ error: '服务端 API Key 未配置，请在 .env 中填入智能引擎密钥。' });
        }

        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        const payload = {
            inputs: {},
            query: '开始', // 用户要求固定为“开始”
            response_mode: 'streaming',
            user: req.user?.username || 'system',
            ...(conversation_id ? { conversation_id } : {}),
            ...(upload_file_id ? {
                files: [{
                    type: file_type || 'image',
                    transfer_method: 'local_file',
                    upload_file_id
                }]
            } : {})
        };
        logger.info(`[material-quote] 准备外发智能分析请求: URL=${apiUrl}, Key=${apiKey.slice(0, 8)}***`);
        logger.info(`[material-quote] Payload: ${JSON.stringify(payload)}`);

        const upstream = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        }).catch(err => {
            logger.error(`[material-quote] fetch 异常: ${err.message}`);
            throw err;
        });



        if (!upstream.ok) {
            const errText = await upstream.text();
            res.write(`data: ${JSON.stringify({ error: errText })}\n\n`);
            return res.end();
        }

        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        let chunkCount = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            chunkCount++;
            if (chunkCount % 10 === 0) logger.info(`[material-quote] 正在转发第 ${chunkCount} 个数据块...`);
            res.write(chunk);
        }
        logger.info(`[material-quote] 流式转发完成, 总计块数: ${chunkCount}`);
        res.end();
    } catch (err) {
        logger.error('[material-quote] 流式推理出错: ' + err.message);
        if (!res.headersSent) res.status(500).json({ error: err.message });
        else res.end();
    }
});

/** GET /api/order-recognition/history  分页获取当前用户的报价历史 */
segOrderRecognition1(app, __ctx);;

const COPPER_PRICE_CACHE_PATH = path.join(__dirname, '../public', 'copper_price_cache.json');

/** GET /api/order-recognition/copper-price  获取缓存的最新铜价 */
segOrderRecognition2(app, __ctx);;

/** POST /api/material-quote/sync-erp  审核并一键同步到 ERP 内部订单 */
segMaterialQuote1(app, __ctx);;


// 新增：资质分类 APIs
/** GET /api/qualifications/categories */
app.get('/api/qualifications/categories', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`SELECT id, parent_type, name FROM sys_qual_categories`);
        res.json({ success: true, data: result.rows });
    } catch (e) {
        res.status(500).json({ success: false, message: '获取分类失败' });
    }
});

/** POST /api/qualifications/categories */
app.post('/api/qualifications/categories', authenticateToken, async (req, res) => {
    try {
        const { parentType, name } = req.body;
        if (!parentType || !name) return res.status(400).json({ success: false, message: '参数缺失' });
        const result = await pool.query(`
            INSERT INTO sys_qual_categories (parent_type, name) VALUES ($1, $2)
            ON CONFLICT (parent_type, name) DO UPDATE SET name = EXCLUDED.name RETURNING id
        `, [parentType, name]);
        res.json({ success: true, id: result.rows[0].id });
    } catch (e) {
        res.status(500).json({ success: false, message: '创建分类失败' });
    }
});

/** PUT /api/qualifications/batch-reminder */
app.put('/api/qualifications/batch-reminder', authenticateToken, async (req, res) => {
    try {
        const { reminderDays, parentType, categoryId } = req.body;
        if (!reminderDays || !parentType) return res.status(400).json({ success: false, message: '参数缺失' });

        if (categoryId) {
            await pool.query(`UPDATE sys_qualifications SET reminder_days = $1, updated_at = NOW() WHERE parent_type = $2 AND category_id = $3`, [reminderDays, parentType, categoryId]);
        } else if (parentType === 'EMP') {
            await pool.query(`UPDATE sys_qualifications SET reminder_days = $1, updated_at = NOW() WHERE parent_type = $2`, [reminderDays, parentType]);
        } else {
            await pool.query(`UPDATE sys_qualifications SET reminder_days = $1, updated_at = NOW() WHERE parent_type = $2 AND category_id IS NULL`, [reminderDays, parentType]);
        }
        res.json({ success: true, message: '批量更新提醒天数成功' });
    } catch (e) {
        res.status(500).json({ success: false, message: '批量更新失败' });
    }
});

/** POST /api/qualifications - 新增单条 */
app.post('/api/qualifications', authenticateToken, async (req, res) => {
    try {
        const { id, empId, parentType, categoryId, name, certNo, issuer, region, category, effectiveDate, expiryDate, reminderDays, thumbnailUrl } = req.body;
        if (!name) return res.status(400).json({ success: false, message: '资质名称不能为空' });

        await pool.query(`
            INSERT INTO sys_qualifications (id, emp_id, parent_type, category_id, cert_no, name, issuer, region, category, effective_date, expiry_date, reminder_days, thumbnail_url, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
        `, [id || `q-${Date.now()}`, empId || null, parentType || 'EMP', categoryId || null, certNo || '', name, issuer || '', region || '', category || '', effectiveDate || null, expiryDate || null, reminderDays || 30, thumbnailUrl || '']);

        res.json({ success: true, message: '保存成功' });
    } catch (err) {
        logger.error('[PG] Save qualification error: ', err);
        res.status(500).json({ success: false, message: '入库失败：' + (err.message.includes('unique') ? '证书编号已存在' : err.message) });
    }
});

// ==================== 资质智能识别入库 API ====================
/** POST /api/qualification/upload */
app.post('/api/qualification/upload', upload.single('file'), async (req, res) => {
    try {
        const apiKey = process.env.DIFY_QUALIFICATION_API_KEY;
        const baseUrl = (process.env.DIFY_QUALIFICATION_API_URL || 'http://39.108.221.22/v1/chat-messages')
            .replace(/\/chat-messages$/, '').replace(/\/$/, '');
        if (!apiKey) return res.status(503).json({ error: '服务端未配置资质入库大模型的 API Key。' });
        if (!req.file) return res.status(400).json({ error: '未收到文件' });
        logAudit(req, { module: 'QUALIFICATION', action: 'UPLOAD_FILE', target_data: fixUploadedFileName(req.file.originalname) });

        const isPdf = req.file.mimetype === 'application/pdf';
        const fileType = isPdf ? 'document' : 'image';

        let originalName = req.file.originalname;
        try { originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8'); } catch (e) { }

        const form = new FormData();
        // 诊改优化：从磁盘读取文件，不再依赖已失效的内存 buffer
        const fileContent = fs.readFileSync(req.file.path);
        const blob = new Blob([fileContent], { type: req.file.mimetype });

        form.set('file', blob, originalName);
        form.set('user', req.user?.username || 'system');
        form.set('type', fileType);

        // ==== 【新增环节】落盘本地存储供缩略图访问真实图片 ====
        let localUrl = '';
        try {
            const uploadDir = path.join(__dirname, '../public', 'uploads', 'qualifications');
            if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
            const fileExt = path.extname(originalName) || '';
            const safeName = `q_${Date.now()}_${Math.floor(Math.random() * 1000)}${fileExt}`;
            const targetPath = path.join(uploadDir, safeName);
            // 诊改优化：从磁盘暂存路径复制
            fs.copyFileSync(req.file.path, targetPath);
            localUrl = `/uploads/qualifications/${safeName}`;
        } catch (saveErr) {
            logger.error('[qualification] 本地保存文件失败: ' + saveErr.message);
        }

        const uploadRes = await fetch(`${baseUrl}/files/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}` },
            body: form
        });
        const data = await uploadRes.json();
        if (data.id) {
            data.mimetype = req.file.mimetype;
            data.localUrl = localUrl; // 返回给前端供入库时保存 thumbnail_url
        }
        return res.json(data);
    } catch (err) {
        logger.error('[qualification] 文件上传出错: ' + err.message);
        return res.status(500).json({ error: '文件上传失败：' + err.message });
    }
});

/** POST /api/qualification/run */
app.post('/api/qualification/run', async (req, res) => {
    try {
        const apiKey = process.env.DIFY_QUALIFICATION_API_KEY;
        const apiUrl = process.env.DIFY_QUALIFICATION_API_URL || 'http://39.108.221.22/v1/chat-messages';

        const { upload_file_ids, inputs } = req.body;
        console.log('[qualification] Received body:', JSON.stringify(req.body, null, 2));
        logAudit(req, { module: 'QUALIFICATION', action: 'RUN_EXTRACT', details: { upload_file_ids, inputs } });

        // ── D4 试点迁移（TASK_CENTER_PILOT 含 qualification 时启用）──────────
        // 走 body.file_ids（平台暂存）；旧 upload_file_ids（Dify id）继续走旧直连路径。
        if (legacyBridge.isPilotSkill('qualification') && Array.isArray(req.body?.file_ids)) {
            try {
                const kind = (inputs && inputs.kind) || 'qualification';
                const r = await legacyBridge.runThroughTaskCenter({
                    skillKey: 'qualification',
                    title: `资质提取：${kind}（${req.body.file_ids.length} 个文件）`,
                    user: req.user?.id ? req.user : { id: 0, username: 'qualification_anonymous', role: 'user' },
                    inputs: { message: `[类型:${kind}] 开始提取资质信息`, kind },
                    files: req.body.file_ids.map(String),
                });
                if (!r.ok) {
                    console.error(`[资质提取-任务中心] ${r.taskNo} 失败 ${r.errorCode}: ${r.message}`);
                    return res.status(500).json({ success: false, message: `任务执行失败（${r.taskNo}）：${r.message}` });
                }
                const answerText = String(legacyBridge.extractAnswer(r.outputs) ?? '');
                // 响应形状对齐旧直连（前端按 .answer 取值）
                return res.json({ answer: answerText });
            } catch (err) {
                console.error('[资质提取-任务中心] 异常:', err.message);
                return res.status(500).json({ success: false, message: `AI 诊断异常: ${err.message}` });
            }
        }

        if (!apiKey || apiKey.includes('PLACEHOLDER')) {
            return res.status(503).json({ error: '服务端 API Key 未配置，请在 .env 中填入智能引擎密钥。' });
        }

        const filesData = (upload_file_ids || []).map(fileId => ({
            type: 'document',
            transfer_method: 'local_file',
            upload_file_id: fileId
        }));

        const payload = {
            inputs: {
                ...(inputs || {}),
                kind: (inputs && inputs.kind) || 'qualification'
            },
            query: `[类型:${(inputs && inputs.kind) || 'qualification'}] 开始提取资质信息`,
            response_mode: 'blocking',
            user: req.user?.username || 'system',
            files: filesData
        };

        console.log('[qualification] Sending to AI Hub:', JSON.stringify(payload, null, 2));

        const upstream = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!upstream.ok) {
            const errText = await upstream.text();
            throw new Error(`分析引擎接口 HTTP ${upstream.status}: ${errText}`);
        }

        // 如果大模型返回 "invalid" 说明它没提取出来有效内容，可以做一层拦截
        const data = await upstream.json();
        return res.json(data);
    } catch (err) {
        logger.error('[qualification] run 出错: ' + err.message);
        return res.status(500).json({ error: err.message });
    }
});

/** GET /api/qualifications - 获取列表 */
app.get('/api/qualifications', async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM sys_qualifications ORDER BY created_at DESC`);
        // 下划线转小驼峰，并强制日期格式化为 YYYY-MM-DD，同时计算动态状态
        const formatDateStr = (val) => {
            if (!val) return null;
            const d = new Date(val);
            if (isNaN(d.getTime())) return null;
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        };

        const nowTime = new Date().getTime();

        const list = result.rows.map(row => {
            let dynStatus = row.status;
            if (row.expiry_date) {
                const expTime = new Date(row.expiry_date).getTime();
                const diffDays = Math.ceil((expTime - nowTime) / (1000 * 3600 * 24));
                if (diffDays <= 0) {
                    dynStatus = 'expired';
                } else if (diffDays <= row.reminder_days) {
                    dynStatus = 'expiring';
                } else {
                    dynStatus = 'normal';
                }
            }

            return {
                id: row.id,
                empId: row.emp_id,
                parentType: row.parent_type,
                categoryId: row.category_id,
                name: row.name,
                certNo: row.cert_no,
                issuer: row.issuer,
                region: row.region,
                category: row.category,
                effectiveDate: formatDateStr(row.effective_date),
                expiryDate: formatDateStr(row.expiry_date),
                reminderDays: row.reminder_days,
                status: dynStatus,
                thumbnailUrl: row.thumbnail_url
            };
        });
        res.json({ success: true, data: list });
    } catch (err) {
        logger.error('[PG] Query qualifications error: ', err);
        res.status(500).json({ success: false, message: '查询资质列表失败' });
    }
});

/** GET /api/qualifications/alerts - 轮询接口，获取到期资质预警数量与最新更新时间戳 */
app.get('/api/qualifications/alerts', async (req, res) => {
    try {
        const result = await pool.query(`SELECT id, expiry_date, reminder_days, updated_at FROM sys_qualifications`);
        const nowTime = new Date().getTime();
        let unread_alerts = 0;
        let lastTimestamp = 0;

        for (const row of result.rows) {
            if (row.expiry_date) {
                const expTime = new Date(row.expiry_date).getTime();
                const diffDays = Math.ceil((expTime - nowTime) / (1000 * 3600 * 24));
                if (diffDays <= row.reminder_days) {
                    unread_alerts++;
                    const rowTs = new Date(row.updated_at).getTime();
                    if (rowTs > lastTimestamp) {
                        lastTimestamp = rowTs;
                    }
                }
            }
        }
        res.json({ unread_alerts, last_update: lastTimestamp ? new Date(lastTimestamp).toISOString() : null });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/** POST /api/qualifications/batch - 批量保存 */
app.post('/api/qualifications/batch', async (req, res) => {
    try {
        const { qualifications } = req.body;
        if (!Array.isArray(qualifications)) return res.status(400).json({ success: false, message: '参数格式错误' });

        let inserted = 0;
        let skipped = 0;

        for (const q of qualifications) {
            if (q.certNo) {
                // 校验系统级唯一性，若已存在同编号且不同ID的资质，则忽略跳过
                const exist = await pool.query(`SELECT id FROM sys_qualifications WHERE cert_no = $1`, [q.certNo]);
                if (exist.rows.length > 0 && exist.rows[0].id !== q.id) {
                    skipped++;
                    continue;
                }
            }

            await pool.query(`
                INSERT INTO sys_qualifications 
                (id, emp_id, parent_type, category_id, name, cert_no, issuer, region, category, effective_date, expiry_date, reminder_days, status, thumbnail_url, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
                ON CONFLICT (id) DO UPDATE SET
                emp_id = EXCLUDED.emp_id, parent_type = EXCLUDED.parent_type, category_id = EXCLUDED.category_id,
                name = EXCLUDED.name, cert_no = EXCLUDED.cert_no, issuer = EXCLUDED.issuer,
                region = EXCLUDED.region, category = EXCLUDED.category, effective_date = EXCLUDED.effective_date,
                expiry_date = EXCLUDED.expiry_date, reminder_days = EXCLUDED.reminder_days, status = EXCLUDED.status, updated_at = NOW()
            `, [
                q.id, q.empId || null, q.parentType || 'EMP', q.categoryId || null,
                q.name, q.certNo || '', q.issuer || '', q.region || '', q.category || '',
                q.effectiveDate || null, q.expiryDate || null, q.reminderDays || 30, q.status || 'normal', q.thumbnailUrl || ''
            ]);
            inserted++;
        }
        res.json({
            success: true,
            message: skipped > 0 ? `批量入库完成：成功插入 ${inserted} 条，跳过 ${skipped} 条已存在的编号。` : `批量入库完成：共成功插入 ${inserted} 条数据。`
        });
    } catch (err) {
        logger.error('[PG] Batch save error: ', err);
        res.status(500).json({ success: false, message: '入库失败：' + err.message });
    }
});

/** PUT /api/qualifications/:id - 修改资料 */
app.put('/api/qualifications/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { empId, parentType, categoryId, name, certNo, issuer, region, category, effectiveDate, expiryDate, reminderDays } = req.body;
        if (certNo) {
            const existCheck = await pool.query(`SELECT id FROM sys_qualifications WHERE cert_no = $1 AND id != $2`, [certNo, id]);
            if (existCheck.rows.length > 0) {
                return res.status(400).json({ success: false, message: '提交失败：资质编号系统内已存在，编号必须唯一' });
            }
        }

        // 【关键修复】先查出原记录的绑定字段，防止前端未传时以默认值覆盖 parentType/empId/categoryId
        const origRow = await pool.query(`SELECT emp_id, parent_type, category_id FROM sys_qualifications WHERE id = $1`, [id]);
        if (origRow.rows.length === 0) {
            return res.status(404).json({ success: false, message: '资质记录不存在' });
        }
        const orig = origRow.rows[0];
        // 只有前端明确传入时才更新绑定字段，否则保留原值
        const safeEmpId = (empId !== undefined && empId !== null) ? empId : orig.emp_id;
        const safeParentType = (parentType !== undefined && parentType !== '') ? parentType : orig.parent_type;
        const safeCategoryId = (categoryId !== undefined && categoryId !== null) ? categoryId : orig.category_id;

        await pool.query(`
            UPDATE sys_qualifications SET
            emp_id = $1, parent_type = $2, category_id = $3,
            name = $4, cert_no = $5, issuer = $6, region = $7, category = $8,
            effective_date = $9, expiry_date = $10, reminder_days = $11, updated_at = NOW()
            WHERE id = $12
        `, [
            safeEmpId, safeParentType, safeCategoryId,
            name, certNo || '', issuer || '', region || '', category || '',
            effectiveDate || null, expiryDate || null, reminderDays || 30, id
        ]);
        res.json({ success: true, message: '更新成功' });
    } catch (err) {
        logger.error('[PG] Update qualification error: ', err);
        res.status(500).json({ success: false, message: '更新失败' });
    }
});

/** DELETE /api/qualifications/:id - 删除（同步删除对应上传文件） */
app.delete('/api/qualifications/:id', async (req, res) => {
    try {
        // 先查出文件路径（thumbnail_url 即上传的资质文件 URL）
        const fileRow = await pool.query(
            'SELECT thumbnail_url FROM sys_qualifications WHERE id = $1',
            [req.params.id]
        );
        if (fileRow.rows.length > 0 && fileRow.rows[0].thumbnail_url) {
            const fileUrl = fileRow.rows[0].thumbnail_url; // e.g. /uploads/qualifications/xxx.pdf
            const relativePath = fileUrl.startsWith('/') ? fileUrl.slice(1) : fileUrl;
            const absPath = path.join(__dirname, '../public', relativePath);
            fs.unlink(absPath, (unlinkErr) => {
                if (unlinkErr && unlinkErr.code !== 'ENOENT') {
                    logger.warn('[qualifications] 删除资质文件失败: ' + absPath + ' - ' + unlinkErr.message);
                }
            });
        }
        await pool.query('DELETE FROM sys_qualifications WHERE id = $1', [req.params.id]);
        res.json({ success: true, message: '删除成功' });
    } catch (err) {
        res.status(500).json({ success: false, message: '删除失败' });
    }
});

/** GET /api/qualifications/categories - 获取自定义分类 */
app.get('/api/qualifications/categories', async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM sys_qual_categories ORDER BY created_at ASC`);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, message: '获取分类失败' });
    }
});

/** POST /api/qualifications/categories - 新增自定义分类 */
app.post('/api/qualifications/categories', async (req, res) => {
    try {
        const { parentType, name } = req.body;
        if (!parentType || !name) return res.status(400).json({ success: false, message: '参数缺失' });
        await pool.query(`INSERT INTO sys_qual_categories (parent_type, name) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [parentType, name]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: '创建失败' });
    }
});

/** PUT /api/qualifications/batch-reminder - 批量更新提醒天数 */
app.put('/api/qualifications/batch-reminder', async (req, res) => {
    try {
        const { reminderDays, parentType, categoryId } = req.body;
        if (!reminderDays) return res.status(400).json({ success: false, message: '请提供天数' });

        let query = `UPDATE sys_qualifications SET reminder_days = $1 WHERE 1=1`;
        const params = [reminderDays];

        if (parentType) {
            params.push(parentType);
            query += ` AND parent_type = $${params.length}`;
        }
        if (categoryId) {
            params.push(categoryId);
            query += ` AND category_id = $${params.length}`;
        }

        await pool.query(query, params);
        res.json({ success: true, message: '批量更新成功' });
    } catch (err) {
        res.status(500).json({ success: false, message: '批量更新失败: ' + err.message });
    }
});

// ============================================================
// ■ 通知中心 API (Notification Center)
// ============================================================

const getUserId = async (req) => {
    if (req.user?.id) return req.user.id;
    if (req.user?.username) {
        const uRes = await pool.query('SELECT id FROM sys_users WHERE username = $1', [req.user.username]);
        return uRes.rows[0]?.id;
    }
    return null;
};

/** GET /api/notifications - 拉取当前登录用户的通知列表（XO-07 P1：双读 task_notifications + 旧表兜底） */
segNotifications1(app, __ctx);;





// ============================================================
// ■ 视频生成模块：B站分析 + Dify分镜生成
// ============================================================
// 视频生成路由已迁至 server/routes/videogen.js（XO-01，首个示范模块）
registerVideogen(app, { authenticateToken, logger });

// ============================================================
// ■ 招标检索模块路由
// ============================================================

// 招标检索 - 调用 Dify 并存入数据库（手动触发 / 定时任务共用）
async function runTenderSearchDify(params = {}) {
    const caller = params.user || 'cron_job';

    const apiKey = process.env.DIFY_TENDER_SEARCH_API_KEY;
    let apiUrl = process.env.DIFY_TENDER_SEARCH_API_URL;
    if (!apiKey || !apiUrl) {
        console.error('[招标检索] 缺少 DIFY_TENDER_SEARCH_API_KEY 或 API_URL 配置');
        return { success: false, message: '缺少 Dify 配置' };
    }
    const baseUrl = apiUrl.replace(/\/workflows\/run\/?$/, '').replace(/\/$/, '');
    const workflowUrl = baseUrl + '/workflows/run';

    const payload = {
        inputs: {},
        response_mode: 'blocking',
        user: caller
    };

    // 传递检索参数到 Dify 工作流
    if (params.time_range !== undefined && params.time_range !== null && params.time_range !== '') {
        payload.inputs.time_range = String(params.time_range);
    }
    if (params.top_n !== undefined && params.top_n !== null && params.top_n !== '') {
        payload.inputs.top_n = String(params.top_n);
    }
    if (params.begin_date !== undefined && params.begin_date !== null && params.begin_date !== '') {
        payload.inputs.begin_date = String(params.begin_date);
    }
    if (params.end_date !== undefined && params.end_date !== null && params.end_date !== '') {
        payload.inputs.end_date = String(params.end_date);
    }

    console.log(`[招标检索] 调用 Dify workflow (blocking), user: ${caller}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 130000);
    let difyRes;
    try {
        difyRes = await fetch(workflowUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
    } finally {
        clearTimeout(timeout);
    }

    if (!difyRes.ok) {
        const errText = await difyRes.text().catch(() => `HTTP ${difyRes.status}`);
        console.error(`[招标检索] Dify 报错: ${difyRes.status} ${errText.substring(0, 300)}`);
        return { success: false, message: `Dify 调用失败: ${errText.substring(0, 200)}` };
    }

    const difyData = await difyRes.json();

    // 解析 + 去重 + 入库（D4 试点迁移抽出：modules/tender/tenderIngest.js，cron/旧路由/试点三路共用）
    return ingestTenderOutputs(difyData?.data?.outputs || {});
}

// 招标详情同步 - 调用 Dify 工作流获取星标记录的最新详情并更新
async function syncTenderStarredDetail(params = {}) {
    const caller = params.user || 'cron_job';
    const apiKey = process.env.DIFY_TENDER_DETAIL_API_KEY;
    let apiUrl = process.env.DIFY_TENDER_DETAIL_API_URL;
    if (!apiKey || !apiUrl) {
        console.error('[招标详情同步] 缺少 DIFY_TENDER_DETAIL_API_KEY 或 API_URL 配置');
        return { success: false, message: '缺少 Dify 招标详情 API 配置' };
    }
    const baseUrl = apiUrl.replace(/\/workflows\/run\/?$/, '').replace(/\/$/, '');
    const workflowUrl = baseUrl + '/workflows/run';

    // 查询所有星标记录（含当前值，用于对比）
    let starredRecords;
    try {
        const res = await pool.query('SELECT id, bid_id, bid_no, bid_type, bid_process, bidder_name, project_name, biz_type, project_amount, channel_type, region, bidder_count, budget_amount, file_acquire_time, file_acquire_method, bid_doc_fee, deadline, bid_method, link, sync_status, candidate_names, winning_company, winning_amount, announcement_date FROM sys_tender_results WHERE is_starred = TRUE AND bid_id <> \'\'');
        starredRecords = res.rows;
    } catch (e) {
        console.error('[招标详情同步] 查询星标记录失败:', e.message);
        return { success: false, message: '查询星标记录失败: ' + e.message };
    }

    if (starredRecords.length === 0) {
        console.log('[招标详情同步] 无星标记录，跳过');
        return { success: true, message: '无星标记录', updated_count: 0 };
    }

    console.log(`[招标详情同步] 开始同步 ${starredRecords.length} 条星标记录, user: ${caller}`);

    let updatedCount = 0;
    let failedCount = 0;
    let noChangeCount = 0;
    let skippedStatusCount = 0;

    for (const record of starredRecords) {
        // 同步状态 = "中标结果" 则跳过
        if (record.sync_status === '中标结果') {
            skippedStatusCount++;
            continue;
        }
        const bidId = record.bid_id;
        try {
            // 调用 Dify 工作流，传入 bid_id
            const payload = {
                inputs: { bid_id: bidId },
                response_mode: 'blocking',
                user: caller
            };

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 60000);
            let difyRes;
            try {
                difyRes = await fetch(workflowUrl, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    signal: controller.signal
                });
            } finally {
                clearTimeout(timeout);
            }

            if (!difyRes.ok) {
                console.warn(`[招标详情同步] bid_id=${bidId} Dify 调用失败: ${difyRes.status}`);
                failedCount++;
                continue;
            }

            const difyData = await difyRes.json();
            const outputs = difyData?.data?.outputs || difyData?.data || difyData;

            // 解析返回的详情数据（兼容多种结构）
            // 标准结构: data.outputs.result[0].item
            // 兼容结构: data.outputs.item / data.outputs.items[0] / outputs 本身
            let detail = null;
            const resultArr = outputs?.result;
            if (Array.isArray(resultArr)) {
                // 取第一条 success 的记录
                for (const r of resultArr) {
                    if (r?.success && r?.item) { detail = r.item; break; }
                }
                if (!detail && resultArr.length > 0 && resultArr[0]?.item) {
                    detail = resultArr[0].item;
                }
            }
            if (!detail && outputs?.item) {
                detail = outputs.item;
            }
            if (!detail && Array.isArray(outputs?.items) && outputs.items.length > 0) {
                detail = outputs.items[0];
            }
            if (!detail && typeof outputs === 'object') {
                // 尝试从 JSON 字符串解析
                for (const val of Object.values(outputs)) {
                    if (typeof val === 'string') {
                        try {
                            const parsed = JSON.parse(val);
                            if (parsed?.item) { detail = parsed.item; break; }
                            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) { detail = parsed; break; }
                        } catch (e) {}
                    }
                }
            }
            if (!detail) {
                console.warn(`[招标详情同步] bid_id=${bidId} 未解析到详情数据`);
                failedCount++;
                continue;
            }

            // 字段映射：支持 Dify 字段名与数据库字段名两种命名
            const fieldMapping = [
                { dbField: 'bidder_name', difyField: 'bidder_name', maxLen: 500 },
                { dbField: 'project_name', difyField: 'project_name', maxLen: 500 },
                { dbField: 'bid_no', difyField: 'bid_no', maxLen: 200 },
                { dbField: 'bid_type', difyField: 'bid_type', isInt: true },
                { dbField: 'bid_process', difyField: 'bid_process', isInt: true },
                { dbField: 'biz_type', difyField: ['business_type', 'biz_type'], maxLen: 100 },
                { dbField: 'project_amount', difyField: 'project_amount', maxLen: 200 },
                { dbField: 'channel_type', difyField: 'channel_type', maxLen: 100 },
                { dbField: 'region', difyField: 'region', maxLen: 200 },
                { dbField: 'bidder_count', difyField: ['shortlisted_count', 'bidder_count'], isInt: true },
                { dbField: 'budget_amount', difyField: 'budget_amount', maxLen: 200 },
                { dbField: 'file_acquire_time', difyField: ['doc_period', 'file_acquire_time'], maxLen: 100 },
                { dbField: 'file_acquire_method', difyField: ['doc_method', 'file_acquire_method'], maxLen: 200 },
                { dbField: 'bid_doc_fee', difyField: ['doc_fee', 'bid_doc_fee'], maxLen: 100 },
                { dbField: 'deadline', difyField: ['bid_deadline', 'deadline'], maxLen: 100 },
                { dbField: 'bid_method', difyField: 'bid_method', maxLen: 100 },
                { dbField: 'link', difyField: ['bid_url', 'link'], maxLen: 1000 },
                { dbField: 'candidate_names', difyField: 'candidate_names', isJson: true },
                { dbField: 'winning_company', difyField: 'winning_company', maxLen: 500 },
                { dbField: 'winning_amount', difyField: 'winning_amount', maxLen: 200 },
                { dbField: 'announcement_date', difyField: 'announcement_date', maxLen: 100 }
            ];

            // 对比字段变化，仅更新有变化的字段
            const updates = [];
            const updateVals = [];
            let paramIdx = 1;
            let changedFieldNames = [];

            for (const fm of fieldMapping) {
                // 取值（支持多个候选字段名，取第一个非空）
                let newVal;
                const names = Array.isArray(fm.difyField) ? fm.difyField : [fm.difyField];
                for (const n of names) {
                    if (detail[n] !== undefined && detail[n] !== null && String(detail[n]).trim() !== '') {
                        newVal = detail[n];
                        break;
                    }
                }
                if (newVal === undefined) continue;

                let finalVal;
                if (fm.isInt) {
                    finalVal = parseInt(newVal) || 0;
                } else if (fm.isJson) {
                    // JSONB 字段：确保是数组，序列化后对比
                    const arr = Array.isArray(newVal) ? newVal : [];
                    finalVal = JSON.stringify(arr);
                } else {
                    finalVal = String(newVal).slice(0, fm.maxLen);
                }

                // 与数据库当前值对比，无变化则不更新
                const oldVal = record[fm.dbField];
                let oldValStr, newValStr;
                if (fm.isJson) {
                    oldValStr = JSON.stringify(oldVal);
                    newValStr = finalVal;
                } else {
                    oldValStr = oldVal === null || oldVal === undefined ? '' : String(oldVal).trim();
                    newValStr = String(finalVal).trim();
                }
                if (oldValStr === newValStr) continue;

                updates.push(`${fm.dbField} = $${paramIdx}`);
                updateVals.push(finalVal);
                paramIdx++;
                changedFieldNames.push(fm.dbField);
            }

            if (updates.length > 0) {
                updateVals.push(record.id);
                const updateSql = `UPDATE sys_tender_results SET ${updates.join(', ')}, synced_at = NOW() WHERE id = $${paramIdx}`;
                await pool.query(updateSql, updateVals);
                updatedCount++;
                console.log(`[招标详情同步] bid_id=${bidId} 已更新 ${updates.length} 个字段: ${changedFieldNames.join(', ')}`);
            } else {
                noChangeCount++;
                // 无字段变化也更新最后同步时间
                await pool.query('UPDATE sys_tender_results SET synced_at = NOW() WHERE id = $1', [record.id]);
                console.log(`[招标详情同步] bid_id=${bidId} 无变化，跳过`);
            }
        } catch (e) {
            console.warn(`[招标详情同步] bid_id=${bidId} 处理失败: ${e.message}`);
            failedCount++;
        }
    }

    console.log(`[招标详情同步] 完成, 更新 ${updatedCount} 条, 无变化 ${noChangeCount} 条, 跳过(已同步) ${skippedStatusCount} 条, 失败 ${failedCount} 条`);

    // 再同步中标结果数据（4个字段）
    let resultUpdatedCount = 0;
    let resultFailedCount = 0;
    let resultNoDataCount = 0;
    let resultNoChangeCount = 0;
    let resultSkippedStatusCount = 0;
    try {
        const result = await syncTenderStarredResult({ user: caller });
        resultUpdatedCount = result.updated_count || 0;
        resultFailedCount = result.failed_count || 0;
        resultNoDataCount = result.no_data_count || 0;
        resultNoChangeCount = result.no_change_count || 0;
        resultSkippedStatusCount = result.skipped_status_count || 0;
        if (resultUpdatedCount > 0 || resultNoDataCount > 0 || resultFailedCount > 0 || resultNoChangeCount > 0) {
            console.log(`[招标详情同步] 中标结果同步: 更新 ${resultUpdatedCount} 条, 无数据 ${resultNoDataCount} 条, 无变化 ${resultNoChangeCount} 条, 失败 ${resultFailedCount} 条`);
        }
    } catch (e) {
        console.error('[招标详情同步] 中标结果同步失败:', e.message);
    }

    return {
        success: true,
        message: '同步完成',
        total: starredRecords.length,
        detail_sync: {
            updated_count: updatedCount,
            no_change_count: noChangeCount,
            skipped_status_count: skippedStatusCount,
            failed_count: failedCount
        },
        result_sync: {
            updated_count: resultUpdatedCount,
            no_data_count: resultNoDataCount,
            no_change_count: resultNoChangeCount,
            skipped_status_count: resultSkippedStatusCount,
            failed_count: resultFailedCount
        }
    };
}

// 招标结果同步 - 调用 Dify 工作流获取星标记录的中标结果并更新（4个字段）
async function syncTenderStarredResult(params = {}) {
    const caller = params.user || 'cron_job';
    const apiKey = process.env.DIFY_TENDER_RESULT_API_KEY;
    let apiUrl = process.env.DIFY_TENDER_RESULT_API_URL;
    if (!apiKey || !apiUrl) {
        console.error('[招标结果同步] 缺少 DIFY_TENDER_RESULT_API_KEY 或 API_URL 配置');
        return { success: false, message: '缺少 Dify 招标结果 API 配置' };
    }
    const baseUrl = apiUrl.replace(/\/workflows\/run\/?$/, '').replace(/\/$/, '');
    const workflowUrl = baseUrl + '/workflows/run';

    // 查询所有星标记录
    let starredRecords;
    try {
        const res = await pool.query('SELECT id, bid_id, bid_no, bidder_name, project_name, link, sync_status, candidate_names, winning_company, winning_amount, announcement_date FROM sys_tender_results WHERE is_starred = TRUE');
        starredRecords = res.rows;
    } catch (e) {
        console.error('[招标结果同步] 查询星标记录失败:', e.message);
        return { success: false, message: '查询星标记录失败: ' + e.message };
    }

    if (starredRecords.length === 0) {
        console.log('[招标结果同步] 无星标记录，跳过');
        return { success: true, message: '无星标记录', updated_count: 0 };
    }

    console.log(`[招标结果同步] 开始同步 ${starredRecords.length} 条星标记录, user: ${caller}`);

    let updatedCount = 0;
    let failedCount = 0;
    let noDataCount = 0;
    let noChangeCount = 0;
    let skippedStatusCount = 0;

    for (const record of starredRecords) {
        // 同步状态 = "中标结果" 则跳过
        if (record.sync_status === '中标结果') {
            skippedStatusCount++;
            continue;
        }
        const bidNo = record.bid_no;
        const logTag = `[bid_no=${bidNo}, bid_id=${record.bid_id}, project_name=${record.project_name}, bidder_name=${record.bidder_name}]`;
        try {
            const payload = {
                inputs: { bid_no: bidNo, bid_id: record.bid_id, project_name: record.project_name, bidder_name: record.bidder_name, source_url: record.link || '' },
                response_mode: 'blocking',
                user: caller
            };

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 60000);
            let difyRes;
            try {
                difyRes = await fetch(workflowUrl, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    signal: controller.signal
                });
            } finally {
                clearTimeout(timeout);
            }

            if (!difyRes.ok) {
                console.warn(`[招标结果同步] ${logTag} Dify 调用失败: ${difyRes.status}`);
                failedCount++;
                continue;
            }

            const difyData = await difyRes.json();
            const outputs = difyData?.data?.outputs || difyData?.data || difyData;

            // 解析返回的数据（兼容多种结构）
            let detail = null;
            const resultArr = outputs?.result;
            if (Array.isArray(resultArr)) {
                for (const r of resultArr) {
                    if (r?.success && r?.item) { detail = r.item; break; }
                }
                if (!detail && resultArr.length > 0 && resultArr[0]?.item) {
                    detail = resultArr[0].item;
                }
            }
            if (!detail && outputs?.item) {
                detail = outputs.item;
            }
            if (!detail && Array.isArray(outputs?.items) && outputs.items.length > 0) {
                detail = outputs.items[0];
            }
            if (!detail && typeof outputs === 'object') {
                for (const val of Object.values(outputs)) {
                    if (typeof val === 'string') {
                        try {
                            const parsed = JSON.parse(val);
                            if (parsed?.item) { detail = parsed.item; break; }
                            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) { detail = parsed; break; }
                        } catch (e) {}
                    }
                }
            }
            if (!detail) {
                console.warn(`[招标结果同步] ${logTag} 未找到中标结果`);
                noDataCount++;
                continue;
            }

            // 中标结果字段更新（Dify字段名与数据库字段名映射，空值回退到已有数据）
            const difyTitle = detail.title ? String(detail.title).trim() : '';
            const difyMoneyWan = detail.money_wan ? String(detail.money_wan).trim() : '';
            const difyWinnerNames = Array.isArray(detail.winner_names) && detail.winner_names.length > 0 ? String(detail.winner_names[0]).trim() : '';
            const difyPubTime = detail.pub_time ? String(detail.pub_time).trim() : '';
            const difyCandidateNames = detail.candidate_names;
            const difyBidProcess = detail.bid_process ? String(detail.bid_process).trim() : '';

            // 构建最终值：Dify 有值则用 Dify，否则保留数据库原值
            const finalProjectName = difyTitle || (record.project_name || '');
            const finalWinningAmount = difyMoneyWan ? (difyMoneyWan + '万元') : (record.winning_amount || '');
            const finalWinningCompany = difyWinnerNames || (record.winning_company || '');
            const finalAnnouncementDate = difyPubTime || (record.announcement_date || '');
            const finalCandidateNames = difyCandidateNames !== undefined && difyCandidateNames !== null
                ? JSON.stringify(Array.isArray(difyCandidateNames) ? difyCandidateNames : [])
                : JSON.stringify(record.candidate_names || []);

            // 与数据库当前值对比，仅更新有变化的字段
            const updates = [];
            const updateVals = [];
            let paramIdx = 1;
            let changedFieldNames = [];

            const fieldChecks = [
                { dbField: 'project_name', finalVal: finalProjectName.slice(0, 500), oldVal: record.project_name },
                { dbField: 'winning_amount', finalVal: finalWinningAmount.slice(0, 200), oldVal: record.winning_amount },
                { dbField: 'winning_company', finalVal: finalWinningCompany.slice(0, 500), oldVal: record.winning_company },
                { dbField: 'announcement_date', finalVal: finalAnnouncementDate.slice(0, 100), oldVal: record.announcement_date },
                { dbField: 'candidate_names', finalVal: finalCandidateNames, oldVal: JSON.stringify(record.candidate_names || []), isJson: true },
                { dbField: 'sync_status', finalVal: difyBidProcess.slice(0, 100), oldVal: record.sync_status },
            ];

            for (const fc of fieldChecks) {
                const oldStr = fc.isJson ? fc.oldVal : (fc.oldVal === null || fc.oldVal === undefined ? '' : String(fc.oldVal).trim());
                const newStr = fc.isJson ? fc.finalVal : String(fc.finalVal).trim();
                if (oldStr === newStr) continue;
                updates.push(`${fc.dbField} = $${paramIdx}`);
                updateVals.push(fc.finalVal);
                paramIdx++;
                changedFieldNames.push(fc.dbField);
            }

            if (updates.length > 0) {
                updateVals.push(record.id);
                const updateSql = `UPDATE sys_tender_results SET ${updates.join(', ')}, synced_at = NOW() WHERE id = $${paramIdx}`;
                await pool.query(updateSql, updateVals);
                updatedCount++;
                console.log(`[招标结果同步] ${logTag} 已更新 ${updates.length} 个字段: ${changedFieldNames.join(', ')}`);
            } else {
                noChangeCount++;
                await pool.query('UPDATE sys_tender_results SET synced_at = NOW() WHERE id = $1', [record.id]);
                console.log(`[招标结果同步] ${logTag} 无变化，跳过`);
            }
        } catch (e) {
            console.warn(`[招标结果同步] ${logTag} 处理失败: ${e.message}`);
            failedCount++;
        }
    }

    console.log(`[招标结果同步] 完成, 更新 ${updatedCount} 条, 无数据 ${noDataCount} 条, 无变化 ${noChangeCount} 条, 跳过(已同步) ${skippedStatusCount} 条, 失败 ${failedCount} 条`);
    return {
        success: true,
        message: '同步完成',
        total: starredRecords.length,
        updated_count: updatedCount,
        no_data_count: noDataCount,
        no_change_count: noChangeCount,
        skipped_status_count: skippedStatusCount,
        failed_count: failedCount
    };
}

// 手动触发检索
segTenderSearch1(app, __ctx);;

// ============================================================
// ■ 选品策略模块路由
// ============================================================

// 选品策略 - 文件上传中转（文件 → Dify upload_file_id）
segProductSelection1(app, __ctx);;

// ============================================================
// ■ SPA 通配符路由 (必须置于所有 API 接口注册之后)
// ============================================================
// 注意: Express 5/path-to-regexp 不再支持 '*' 作为通配符，需使用正则或 /(.*)
app.get(/.*/, (req, res) => {
    // 忽略API请求
    if (req.path.startsWith('/api')) {
        return res.status(404).json({ error: 'API not found' });
    }
    res.sendFile(path.join(__dirname, '../dist', 'index.html'));
});

// ===================================
// ■ 核查报价模块
// ===================================

// 1. 核查报价 - 供应商名称核查（工作流A）
segQuoteVerify1(app, __ctx);;

// ===================================
// ■ 业务看板 (Business Dashboard) API 代理
// ===================================
segBusinessDashboard1(app, __ctx);;

// ===================================
// ■ 启动服务器
// ===================================
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('='.repeat(60));
    console.log(`✓ 后端服务器已启动`);
    console.log(`  - 监听端口: ${PORT}`);
    console.log(`  - API地址: http://localhost:${PORT}`);
    console.log(`  - 定时任务: 每小时整点执行数据更新`);
    console.log(`  - 下次更新: ${new Date(Date.now() + 3600000).toLocaleString('zh-CN')}`);
    console.log('='.repeat(60));
    console.log('\n可用的API端点:');
    console.log(`  POST http://localhost:${PORT}/api/update-data  - 手动触发数据更新`);
    console.log(`  GET  http://localhost:${PORT}/api/status       - 查询更新状态`);
    console.log(`  GET  http://localhost:${PORT}/api/health       - 健康检查`);
    console.log('\n');

    // 启动自检：若当月预测基线缺失或过期则自动生成
    if (envBool('ENABLE_STARTUP_BASELINE_CHECK', true)) {
        const delay = parseInt(process.env.STARTUP_BASELINE_CHECK_DELAY || '5000', 10);
        setTimeout(() => checkAndGenerateBaselineIfMissing(), delay);
    } else {
        console.log('[启动自检] 月度预测启动自检已禁用 (ENABLE_STARTUP_BASELINE_CHECK=false)');
    }
});

// 设置极高的服务器超时时间，以应对大音频上传 (30 分钟)
server.timeout = 1800000;
server.keepAliveTimeout = 120000;
server.headersTimeout = 130000;
if (server.requestTimeout) server.requestTimeout = 1800000;

// 优雅关闭
process.on('SIGINT', () => {
    console.log('\n正在关闭服务器...');
    process.exit(0);
});

