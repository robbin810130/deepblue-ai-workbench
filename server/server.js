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
import pool from './db.js';  // PostgreSQL 连接池
import userAdminRoutes from './userAdminRoutes.js'; // 用户管理路由
import configAdminRoutes from './configAdminRoutes.js'; // 系统配置中心路由
import hazardDetectionRoutes from './hazardDetectionRoutes.js'; // 隐患检测路由
import knowledgeAdminRoutes from './knowledgeAdminRoutes.js'; // 知识库管理路由
import keyAccountRoutes from './keyAccountRoutes.js'; // 大客户档案模块路由
import bidAssistantRoutes from './bidAssistantRoutes.js'; // 投标助手模块路由
import * as legacyBridge from './modules/tasks/legacyBridge.js'; // D4 试点：存量路由 → 任务中心迁移桥
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

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({
            format: () => new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 23)
        }),
        winston.format.printf(({ timestamp, level, message, stack }) => {
            return `[${timestamp}] ${level.toUpperCase()}: ${stack || message}`;
        })
    ),
    transports: [
        new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        new winston.transports.File({ filename: 'logs/combined.log' }),
        new winston.transports.Console()
    ],
});

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

const JWT_SECRET = process.env.JWT_SECRET || 'blue-os-super-secret-key';
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
app.get('/api/dsh/verify-access', async (req, res) => {
    const dshSecret = process.env.DSH_ACCESS_SECRET;
    const ticket = parseCookies(req.headers.cookie)[DSH_ACCESS_COOKIE];
    if (!dshSecret || !ticket) return res.status(401).end();

    try {
        const payload = jwt.verify(ticket, dshSecret);
        if (payload?.purpose !== 'dsh-access' || !payload?.jti || !payload?.id) {
            return res.status(403).end();
        }
        const session = await pool.query(
            'SELECT 1 FROM sys_user_sessions WHERE jti = $1 AND revoked = FALSE AND expires_at > NOW()',
            [payload.jti]
        );
        if (session.rowCount === 0) return res.status(401).end();
        return res.status(204).end();
    } catch (error) {
        logger.warn('[DSH Access] 无效访问票据: ' + error.message);
        return res.status(401).end();
    }
});

// IP 归一化工具 (处理 IPv6 的 IPv4 映射及 localhost 变体)
const normalizeIp = (ip) => {
    if (!ip) return '';
    if (ip === '::1' || ip === '::ffff:127.0.0.1') return '127.0.0.1';
    if (ip.startsWith('::ffff:')) return ip.substring(7);
    return ip;
};

// 鉴权中间件
const authenticateToken = async (req, res, next) => {
    // 诊改优化：放行 OPTIONS 预检请求及特定路径，解决直连 3001 时的跨域鉴权问题
    // 特别说明：/api/auth/logout-beacon 必须放行，因为 sendBeacon 无法携带 Authorization Header
    if (req.method === 'OPTIONS' || req.path === '/api/auth/login' || req.path === '/api/auth/logout-beacon' || req.path === '/api/health' || req.path === '/api/business-dashboard/publish' || req.path === '/api/v1/files/download') {
        // /api/business-dashboard/publish 由路由内部 X-Internal-Token 鉴权（Dify 服务端调用，无平台 JWT）
        // /api/v1/files/download 为短时签名 URL 下载（HMAC+有效期即凭证，PRD 05 §9），路由内部自行校验签名
        return next();
    }

    const isApiRequest = req.path.startsWith('/api/');
    const isSensitiveJson = req.path === '/sales_analysis_matrix.json' || req.path === '/monthly_forecast_baseline.json';

    if (isApiRequest || isSensitiveJson) {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        if (!token) return res.status(401).json({ success: false, message: '未提供访问令牌，请先登录' });

        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch (err) {
            return res.status(403).json({ success: false, message: '令牌无效或已过期' });
        }

        // 若 Token 带 jti，检查会话是否被吊销
        if (decoded.jti) {
            try {
                const sess = await pool.query(
                    'SELECT revoked FROM sys_user_sessions WHERE jti = $1',
                    [decoded.jti]
                );
                if (sess.rowCount > 0 && sess.rows[0].revoked) {
                    return res.status(401).json({ success: false, message: '会话已在其他设备退出，请重新登录' });
                }
            } catch (_) { /* 查询失败时不阻断，降级通过 */ }
        }

        req.user = decoded;
        next();
    } else {
        next();
    }
};

// 静态资源先行（允许 DashScope 匿名下载音频）
app.use('/uploads', express.static(path.join(__dirname, '../public/uploads')));
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.static(path.join(__dirname, '../dist')));
app.use('/dashboard-files', express.static(businessDashboardStorageDir)); // AI 发布看板静态托管（须在鉴权前：iframe 请求不带 JWT 头）

app.use(authenticateToken);

// DSH 访问票据：由 WebOS JWT 换取，仅用于 Nginx 访问 DSH 前的内部校验。
app.post('/api/dsh/access-ticket', async (req, res) => {
    const dshSecret = process.env.DSH_ACCESS_SECRET;
    if (!dshSecret) {
        return res.status(503).json({ success: false, message: 'DSH 访问服务尚未完成生产配置' });
    }
    if (!req.user?.jti || !req.user?.id) {
        return res.status(401).json({ success: false, message: '登录会话无效，请重新登录' });
    }
    try {
        const ticket = jwt.sign(
            { purpose: 'dsh-access', id: req.user.id, username: req.user.username, jti: req.user.jti },
            dshSecret,
            { expiresIn: '10m' }
        );
        res.cookie(DSH_ACCESS_COOKIE, ticket, dshCookieOptions());
        logAudit(req, { module: 'DSH', action: 'ACCESS_TICKET_ISSUED', details: { username: req.user.username } });
        return res.json({ success: true, expires_in_seconds: DSH_ACCESS_TTL_MS / 1000 });
    } catch (error) {
        logger.error('[DSH Access] 签发访问票据失败: ' + error.message);
        return res.status(500).json({ success: false, message: 'DSH 访问授权失败' });
    }
});


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
app.get('/api/brands', async (req, res) => {
    try {
        const result = await pool.query("SELECT brand_name FROM brand_dictionary WHERE status = 'ACTIVE' ORDER BY LENGTH(brand_name) DESC");
        res.json({ success: true, brands: result.rows.map(r => r.brand_name) });
    } catch (e) {
        res.json({ success: false, brands: [] });
    }
});

// --- 敏感 JSON 文件动态脱敏拦截 ---
app.get('/sales_analysis_matrix.json', authenticateToken, async (req, res) => {
    try {
        const filePath = path.join(__dirname, '../public', 'sales_analysis_matrix.json');
        if (!fs.existsSync(filePath)) return res.status(404).end();
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

        logger.info(`[脱敏检查] 访问 /sales_analysis_matrix.json, 用户: ${req.user?.username}, 角色: ${req.user?.role}`);

        // 非管理员进行数据脱敏
        if (req.user && req.user.role !== 'admin') {
            const allProducts = [];
            if (data.monthly_matrix) allProducts.push(...data.monthly_matrix.map(r => r.product_name));
            if (data.quarterly_matrix) allProducts.push(...data.quarterly_matrix.map(r => r.product_name));

            // 去重
            const uniqueProducts = [...new Set(allProducts.filter(Boolean))];

            // 1. 调用智能工作流提取品牌（异步下发，不阻塞主流程，但用户要求执行完毕再返回，故 await）
            await extractBrandsFromProducts(uniqueProducts);

            // 2. 从数据库读取当前生效的品牌列表
            const brandResult = await pool.query("SELECT brand_name FROM brand_dictionary WHERE status = 'ACTIVE'");
            const activeBrands = brandResult.rows.map(r => r.brand_name);
            logger.info(`[脱敏进行] 已加载 ${activeBrands.length} 个活跃品牌进行遮罩`);

            // 3. 执行脱敏
            if (data.monthly_matrix) {
                data.monthly_matrix = data.monthly_matrix.map(row => ({
                    ...row,
                    product_name: maskBrandBrands(row.product_name, activeBrands)
                }));
            }
            if (data.quarterly_matrix) {
                data.quarterly_matrix = data.quarterly_matrix.map(row => ({
                    ...row,
                    product_name: maskBrandBrands(row.product_name, activeBrands)
                }));
            }
        }
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/monthly_forecast_baseline.json', authenticateToken, async (req, res) => {
    try {
        const filePath = path.join(__dirname, '../public', 'monthly_forecast_baseline.json');
        if (!fs.existsSync(filePath)) return res.status(404).end();
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

        if (req.user && req.user.role !== 'admin') {
            if (data.forecast_results) {
                const uniqueProducts = [...new Set(data.forecast_results.map(i => i.product_name).filter(Boolean))];

                // 1. 调用智能分析工作流
                await extractBrandsFromProducts(uniqueProducts);

                // 2. 获取品牌字典
                const brandResult = await pool.query("SELECT brand_name FROM brand_dictionary WHERE status = 'ACTIVE'");
                const activeBrands = brandResult.rows.map(r => r.brand_name);

                // 3. 脱敏处理
                data.forecast_results = data.forecast_results.map(item => ({
                    ...item,
                    product_name: maskBrandBrands(item.product_name, activeBrands)
                }));
            }
        }
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


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
app.post('/api/doc-drafting/generate', authenticateToken, async (req, res) => {
    const { query, doc_type } = req.body;
    const apiKey = process.env.DIFY_DOC_DRAFTING_API_KEY;
    const apiUrl = process.env.DIFY_DOC_DRAFTING_API_URL;

    if (!query) return res.status(400).json({ error: '文档基本信息不能为空' });
    if (!doc_type) return res.status(400).json({ error: '文档类型不能为空' });
    if (!apiKey || apiKey === 'app-xxxx') {
        return res.json({ success: false, message: '系统未配文档起草 Dify API Key，请联系管理员在.env中配置。' });
    }

    try {
        logger.info(`[Doc Drafting] 请求生成类型: ${doc_type}`);
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: { doc_type: doc_type },
                query: query,
                response_mode: 'blocking',
                conversation_id: '',
                user: req.user?.username || 'system-user'
            })
        });

        const data = await response.json();

        if (!response.ok) {
            logger.error(`[Doc Drafting Error] Status: ${response.status}, Data: ${JSON.stringify(data)}`);
            throw new Error(data.message || 'Dify 生成文档请求失败');
        }

        res.json({
            success: true,
            result: data.answer || 'Dify 未返回有效内容。'
        });
    } catch (e) {
        logger.error('[Doc Drafting Exception] ' + e.message);
        res.status(500).json({ error: e.message });
    }
});

// --- 文档起草历史管理 [NEW] ---

// 1. 获取起草历史
app.get('/api/doc-drafting/history', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, name, doc_type as "type", original_query as "query", result_text as "content", created_at as "time" FROM sys_doc_drafting WHERE user_id = $1 ORDER BY created_at DESC',
            [req.user.id]
        );
        const history = result.rows.map(row => ({
            ...row,
            time: new Date(row.time).toLocaleString()
        }));
        res.json({ success: true, history });
    } catch (e) {
        logger.error('[Doc History Get Error] ' + e.message);
        res.status(500).json({ error: e.message });
    }
});

// 2. 保存起草条目
app.post('/api/doc-drafting/history/save', authenticateToken, async (req, res) => {
    const { name, doc_type, query, content } = req.body;
    if (!name || !content) return res.status(400).json({ error: '保存参数不完整' });

    try {
        const id = crypto.randomUUID();
        await pool.query(
            'INSERT INTO sys_doc_drafting (id, user_id, name, doc_type, original_query, result_text) VALUES ($1, $2, $3, $4, $5, $6)',
            [id, req.user.id, name, doc_type, query, content]
        );
        const savedItem = { id, name, type: doc_type, query, content, time: new Date().toLocaleString() };
        res.json({ success: true, item: savedItem });
    } catch (e) {
        logger.error('[Doc History Save Error] ' + e.message);
        res.status(500).json({ error: e.message });
    }
});

// 3. 删除历史条目
app.delete('/api/doc-drafting/history/:id', authenticateToken, async (req, res) => {
    try {
        await pool.query('DELETE FROM sys_doc_drafting WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        res.json({ success: true });
    } catch (e) {
        logger.error('[Doc History Delete Error] ' + e.message);
        res.status(500).json({ error: e.message });
    }
});

// --- 会议纪要 Word 导出接口 [NEW] ---
app.post('/api/meeting-minutes/export', authenticateToken, async (req, res) => {
    const { minutes, filename } = req.body;
    const apiKey = process.env.DIFY_MEETING_MINUTES_EXPORT_API_KEY;
    const apiUrl = process.env.DIFY_MEETING_MINUTES_EXPORT_API_URL;

    if (!minutes) return res.status(400).json({ error: '纪要内容不能为空' });
    if (!apiKey || apiKey === 'app-xxxx') {
        return res.json({ success: false, message: '系统未配置导出 API Key，请联系管理员。' });
    }

    try {
        logger.info(`[Dify Export] 正在请求导出，文件名: ${filename}`);

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: { filename: filename || '会议纪要.docx' },
                query: minutes,
                response_mode: 'blocking',
                user: req.user?.username || 'system-user'
            })
        });

        const data = await response.json();

        if (!response.ok) {
            logger.error(`[Dify Export Error] Status: ${response.status}, Data: ${JSON.stringify(data)}`);
            throw new Error(data.message || '导出请求失败');
        }

        // 解析返回结构
        let downloadUrl = '';
        if (data.files && data.files.length > 0) {
            // 优先从 files 数组获取
            downloadUrl = data.files[0].url;
        } else if (data.answer) {
            // 尝试从 answer 的 Markdown 链接中提取 [name](url)
            const match = data.answer.match(/\[.*?\]\((.*?)\)/);
            if (match) downloadUrl = match[1];
        }

        if (!downloadUrl) {
            logger.error(`[Dify Export Error] 未找到下载链接，响应数据: ${JSON.stringify(data)}`);
            throw new Error('未获取到有效的下载链接');
        }

        res.json({ success: true, downloadUrl, filename: filename || data.files?.[0]?.filename || '会议纪要.docx' });
    } catch (e) {
        logger.error('[Dify Export Exception] ' + e.message);
        res.status(500).json({ error: e.message });
    }
});

// --- 下载代理 [NEW] ---
// 解决跨域导致 download 属性失效，无法重命名文件的问题
app.get('/api/meeting-minutes/download-proxy', authenticateToken, async (req, res) => {
    const { url, filename } = req.query;
    if (!url) return res.status(400).end();

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('无法从 Dify 获取文件');

        // 设置强制下载头
        const encodedName = encodeURIComponent(filename || '会议纪要.docx').replace(/['()]/g, escape).replace(/\*/g, '%2A');
        res.setHeader('Content-Type', response.headers.get('Content-Type') || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedName}`);

        // 使用管道流式传输
        const reader = response.body.getReader();
        const sendChunk = async () => {
            const { done, value } = await reader.read();
            if (done) {
                res.end();
                return;
            }
            res.write(value);
            await sendChunk();
        };
        await sendChunk();
    } catch (e) {
        logger.error('[Download Proxy Error] ' + e.message);
        res.status(500).send('下载失败');
    }
});

// --- 会议纪要历史管理 [NEW] ---

// 1. 获取历史记录
app.get('/api/meeting-minutes/history', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, filename, original_text as "originalText", minutes_text as "minutes", TO_CHAR(created_at AT TIME ZONE \'UTC\' AT TIME ZONE \'PRC\', \'YYYY-MM-DD HH24:MI:SS\') as "time" FROM sys_meeting_minutes WHERE user_id = $1 ORDER BY created_at DESC',
            [req.user.id]
        );
        res.json({ success: true, history: result.rows });
    } catch (e) {
        logger.error('[History Get Error] ' + e.message);
        res.status(500).json({ error: e.message });
    }
});

// 2. 保存纪要记录
app.post('/api/meeting-minutes/history/save', authenticateToken, async (req, res) => {
    const { id, filename, originalText, minutes } = req.body;
    try {
        await pool.query(
            'INSERT INTO sys_meeting_minutes (id, user_id, filename, original_text, minutes_text) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET original_text = EXCLUDED.original_text, minutes_text = EXCLUDED.minutes_text',
            [id, req.user.id, filename, originalText, minutes]
        );
        res.json({ success: true });
    } catch (e) {
        logger.error('[History Save Error] ' + e.message);
        res.status(500).json({ error: e.message });
    }
});

// 3. 删除记录（同步删除对应录音文件）
app.delete('/api/meeting-minutes/history/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        // 先查出文件名
        const fileRow = await pool.query(
            'SELECT filename FROM sys_meeting_minutes WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );
        if (fileRow.rows.length > 0 && fileRow.rows[0].filename) {
            const filename = fileRow.rows[0].filename;
            const absPath = path.join(__dirname, '../public', 'uploads', 'meeting-minutes', filename);
            fs.unlink(absPath, (unlinkErr) => {
                if (unlinkErr && unlinkErr.code !== 'ENOENT') {
                    logger.warn('[meeting-minutes] 删除录音文件失败: ' + absPath + ' - ' + unlinkErr.message);
                }
            });
        }
        await pool.query(
            'DELETE FROM sys_meeting_minutes WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );
        res.json({ success: true });
    } catch (e) {
        logger.error('[History Delete Error] ' + e.message);
        res.status(500).json({ error: e.message });
    }
});

// --- 数字员工助手代理接口 [NEW] ---
app.get('/api/digital-employee/parameters', authenticateToken, async (req, res) => {
    const apiKey = process.env.DIFY_DIGITAL_EMPLOYEE_API_KEY;
    const apiUrl = process.env.DIFY_DIGITAL_EMPLOYEE_API_URL;
    if (!apiKey || apiKey === 'app-xxxx') return res.status(500).json({ error: '配置缺失' });
    try {
        const paramUrl = apiUrl.replace('/chat-messages', '') + '/parameters';
        const response = await fetch(paramUrl, { headers: { 'Authorization': `Bearer ${apiKey}` } });
        const data = await response.json();
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/digital-employee/chat', authenticateToken, async (req, res) => {
    const { query, inputs = {}, response_mode = 'streaming' } = req.body;
    const apiKey = process.env.DIFY_DIGITAL_EMPLOYEE_API_KEY;
    const apiUrl = process.env.DIFY_DIGITAL_EMPLOYEE_API_URL;

    if (!apiKey || apiKey === 'app-xxxx') {
        return res.status(500).json({ error: '系统未配置数字员工 Dify API Key，请联系管理员。' });
    }

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: inputs,
                query: query,
                response_mode: response_mode,
                user: req.user?.username || 'system-user'
            })
        });

        if (!response.ok) {
            const data = await response.text();
            throw new Error(`Dify请求失败: ${response.status} ${data}`);
        }

        if (response_mode === 'streaming') {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            const reader = response.body.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                res.write(value);
            }
            res.end();
        } else {
            const data = await response.json();
            res.json(data);
        }
    } catch (e) {
        logger.error('[Digital Employee Request Error] ' + e.message);
        if (!res.headersSent) {
            res.status(500).json({ error: e.message });
        } else {
            res.end();
        }
    }
});

// --- 营销分析模块路由 [NEW] ---
let marketingAnalysisStatus = {
    isRunning: false,
    status: 'idle',
    message: '',
    lastUpdate: new Date().toISOString()
};

app.get('/api/marketing-analysis/status', authenticateToken, (req, res) => {
    res.json(marketingAnalysisStatus);
});

app.post('/api/marketing-analysis/update-data', authenticateToken, async (req, res) => {
    if (marketingAnalysisStatus.isRunning) {
        return res.status(429).json({ error: '营销数据分析任务正在执行中，请稍后再试' });
    }
    logAudit(req, { module: 'MARKETING_ANALYSIS', action: 'UPDATE_DATA' });
    marketingAnalysisStatus.isRunning = true;
    marketingAnalysisStatus.status = 'running';
    marketingAnalysisStatus.message = '正在执行SQL数据提取与分析脚本...';

    console.log(`[营销分析] ${new Date().toISOString()} 开始执行 a4_marketing_analysis.py`);

    const python = spawn('python', ['scripts/a4_marketing_analysis.py'], {
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
    });
    let output = '';
    let errorOutput = '';

    python.stdout.on('data', (data) => {
        const text = data.toString('utf8');
        output += text;
        console.log(`[营销分析-Python] ${text.trim()}`);
    });

    python.stderr.on('data', (data) => {
        const text = data.toString('utf8');
        errorOutput += text;
        console.error(`[营销分析-错误] ${text.trim()}`);
    });

    python.on('close', (code) => {
        marketingAnalysisStatus.isRunning = false;

        if (code === 0) {
            try {
                // 执行成功后，把 marketing_analysis_data.json 复制到 public 目录
                const srcPath = path.join(__dirname, '../marketing_analysis_data.json');
                const destPath = path.join(__dirname, '../public', 'marketing_analysis_data.json');
                
                if (fs.existsSync(srcPath)) {
                    fs.copyFileSync(srcPath, destPath);
                    console.log(`[营销分析] 数据文件已同步复制到 ${destPath}`);
                } else {
                    console.warn(`[营销分析] 未在根目录找到生成的 marketing_analysis_data.json`);
                }

                marketingAnalysisStatus.lastUpdate = new Date().toISOString();
                marketingAnalysisStatus.status = 'success';
                marketingAnalysisStatus.message = '营销数据更新并分析成功';

                res.json({
                    success: true,
                    message: '营销数据更新与分析计算完成！',
                    timestamp: marketingAnalysisStatus.lastUpdate
                });
            } catch (err) {
                console.error('[营销分析] 同步复制或处理文件失败:', err.message);
                marketingAnalysisStatus.status = 'error';
                marketingAnalysisStatus.message = `同步文件失败: ${err.message}`;
                res.status(500).json({ error: `处理同步文件异常: ${err.message}` });
            }
        } else {
            console.error(`[营销分析] Python脚本执行失败，退出码: ${code}`);
            marketingAnalysisStatus.status = 'error';
            marketingAnalysisStatus.message = `数据分析脚本执行失败 (退出码: ${code})`;
            res.status(500).json({ error: `数据分析脚本执行失败: ${errorOutput || '未知错误'}` });
        }
    });

    python.on('error', (error) => {
        marketingAnalysisStatus.isRunning = false;
        marketingAnalysisStatus.status = 'error';
        marketingAnalysisStatus.message = `无法启动分析环境: ${error.message}`;
        console.error('[营销分析] 启动Python失败:', error);
        res.status(500).json({ error: `无法启动分析环境: ${error.message}` });
    });
});

app.post('/api/marketing-analysis/chat', authenticateToken, async (req, res) => {
    const { query, inputs = {}, response_mode = 'streaming' } = req.body;
    const apiKey = process.env.DIFY_MARKETING_ANALYSIS_API_KEY;
    const apiUrl = process.env.DIFY_MARKETING_ANALYSIS_API_URL || 'http://39.108.221.22/v1/chat-messages';

    // 审核日志
    logAudit(req, { module: 'MARKETING_ANALYSIS', action: 'CHAT_ASSISTANT', detail: query.substring(0, 100) });

    // ── D4 试点迁移（TASK_CENTER_PILOT 含 marketing_analysis 时启用）──────────
    // 建任务 → 执行 → 通知闭环；响应改为完整 JSON（前端按 content-type 双模式兼容）。
    if (legacyBridge.isPilotSkill('marketing_analysis')) {
        try {
            const r = await legacyBridge.runThroughTaskCenter({
                skillKey: 'marketing_analysis',
                title: `营销分析：${String(query || '').slice(0, 24)}`,
                user: req.user,
                inputs: { message: query, ...(inputs || {}) },
            });
            if (!r.ok) {
                console.error(`[营销分析-任务中心] ${r.taskNo} 失败 ${r.errorCode}: ${r.message}`);
                return res.status(500).json({ success: false, message: `任务执行失败（${r.taskNo}）：${r.message}` });
            }
            return res.json({ success: true, data: legacyBridge.stripThinkTags(legacyBridge.extractAnswer(r.outputs)) });
        } catch (err) {
            console.error('[营销分析-任务中心] 异常:', err.message);
            return res.status(500).json({ success: false, message: `AI 诊断异常: ${err.message}` });
        }
    }

    // Dify API Key placeholder check - fallback to simulation
    if (!apiKey || apiKey === 'app-xxxx') {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const simulatedResponse = `### 📊 营销分析智能助手 (模拟分析结果)
检测到您尚未在 \`.env\` 配置文件中配置正确的 \`DIFY_MARKETING_ANALYSIS_API_KEY\`。以下为系统为您预设的基于 SQL 数据库销售现状的智能模拟分析：

针对您的查询："**${query}**"，我们对月度与季度销量、销售额以及毛利数据进行了深度挖掘：

#### 1. 销量与贡献度多维透视
- **核心品类表现**：目前主要销售品类集中在**奶酪**（占比 72.3%）与**果冻**（占比 27.7%）。
- **主要单品贡献**：前 80% 的销售额由 25 个 SKU 贡献。其中销量前三的 SKU 长期处于龙头地位，毛利率基本维持在 **35% - 41.5%** 的高水位。

#### 2. 月度与季度销量趋势分析
- 过去 3 个月，销量展现出了强劲的增长势头，特别是在季度末促销及夏季主推期，月环比销量（Qty）增长了约 **14%**。
- 但我们也注意到有部分 SKU 呈现出单价与销量背离的情况（即涨价导致销量下滑显著），需要防范定价负反馈。

#### 3. 应对与优化建议
1. **进行价格敏感度分析**：针对果冻类主销 SKU，毛利率有较大的拉升空间，可以考虑在下季度通过礼盒装、组合销售进行间接提价。
2. **AI营销排班**：利用销量预估，提前规划物料订购与生产排程，降低物料仓储成本。

*💡 提示：在 \`server/.env\` 或项目根目录 \`.env\` 中配置 \`DIFY_MARKETING_ANALYSIS_API_KEY\` 即可一键激活正式的 Dify Chatflow 对话流！*`;

        const chunks = simulatedResponse.split('\n');
        let index = 0;

        const interval = setInterval(() => {
            if (index >= chunks.length) {
                res.write('data: {"event": "message_end"}\n\n');
                res.end();
                clearInterval(interval);
                return;
            }
            const line = chunks[index];
            const messageObj = {
                event: 'message',
                answer: line + '\n',
                task_id: 'sim-task-m1',
                id: 'sim-msg-m1'
            };
            res.write(`data: ${JSON.stringify(messageObj)}\n\n`);
            index++;
        }, 150);

        return;
    }

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: inputs,
                query: query,
                response_mode: response_mode,
                user: req.user?.username || 'marketing-user'
            })
        });

        if (!response.ok) {
            const data = await response.text();
            throw new Error(`Dify请求失败: ${response.status} ${data}`);
        }

        if (response_mode === 'streaming') {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            const reader = response.body.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                res.write(value);
            }
            res.end();
        } else {
            const data = await response.json();
            res.json(data);
        }
    } catch (e) {
        logger.error('[Marketing Analysis Request Error] ' + e.message);
        if (!res.headersSent) {
            res.status(500).json({ error: e.message });
        } else {
            res.end();
        }
    }
});

app.use('/api/', globalLimiter);
app.use('/api/rules/', coreServicesLimiter);
app.use('/api/generate-image', coreServicesLimiter);



// --- 自动执行 DDL（幂等，首次启动时建表/加字段）---
async function runInitDDL() {
    try {
        await pool.query(`ALTER TABLE sys_users ADD COLUMN IF NOT EXISTS department VARCHAR(100) DEFAULT ''`);
        await pool.query(`
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
        `);

        // 商品品牌字典表（用于增强型动态脱敏）
        await pool.query(`
            CREATE TABLE IF NOT EXISTS brand_dictionary (
                id          SERIAL PRIMARY KEY,
                brand_name  VARCHAR(255) UNIQUE NOT NULL,
                source      VARCHAR(50) DEFAULT 'LLM',
                status      VARCHAR(20) DEFAULT 'ACTIVE',
                created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 资质大类自定义分类表
        await pool.query(`
            CREATE TABLE IF NOT EXISTS sys_qual_categories (
                id          SERIAL PRIMARY KEY,
                parent_type VARCHAR(50) NOT NULL,
                name        VARCHAR(255) NOT NULL,
                created_at  TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(parent_type, name)
            )
        `);

        // 资质信息表 (Qualification Management)
        await pool.query(`
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
        `);
        // 兼容已有数据结构调整
        await pool.query(`ALTER TABLE sys_qualifications ALTER COLUMN emp_id DROP NOT NULL`).catch(() => { });
        await pool.query(`ALTER TABLE sys_qualifications ADD COLUMN IF NOT EXISTS parent_type VARCHAR(50) DEFAULT 'EMP'`).catch(() => { });
        await pool.query(`ALTER TABLE sys_qualifications ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES sys_qual_categories(id) ON DELETE SET NULL`).catch(() => { });

        // 【迁移逻辑】将原有按人分组的内容（EMP）正式更名为 PRODUCT 类型内容
        await pool.query(`UPDATE sys_qualifications SET parent_type = 'PRODUCT' WHERE parent_type = 'EMP'`);

        await pool.query(`CREATE INDEX IF NOT EXISTS idx_qualifications_emp_id ON sys_qualifications(emp_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sys_user_sessions(user_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_sessions_jti     ON sys_user_sessions(jti)`);

        // 会议纪要持久化表 [NEW]
        await pool.query(`
            CREATE TABLE IF NOT EXISTS sys_meeting_minutes (
                id              VARCHAR(64) PRIMARY KEY,
                user_id         INTEGER REFERENCES sys_users(id) ON DELETE CASCADE,
                filename        VARCHAR(255) NOT NULL,
                original_text   TEXT,
                minutes_text    TEXT,
                created_at      TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_meeting_minutes_user_id ON sys_meeting_minutes(user_id)`);

        // 文档起草持久化表 [NEW]
        await pool.query(`
            CREATE TABLE IF NOT EXISTS sys_doc_drafting (
                id              VARCHAR(64) PRIMARY KEY,
                user_id         INTEGER REFERENCES sys_users(id) ON DELETE CASCADE,
                name            VARCHAR(255) NOT NULL,
                doc_type        VARCHAR(100),
                original_query  TEXT,
                result_text     TEXT,
                created_at      TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_doc_drafting_user_id ON sys_doc_drafting(user_id)`);

        // 操作审计日志表初始化 (PostgreSQL 语法)
        await pool.query(`
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
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_created_at ON sys_audit_logs(created_at)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_username   ON sys_audit_logs(username)`);

        // 美妆研发自定义配方版本持久化表 [NEW]
        await pool.query(`
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
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_beauty_rnd_conv_id ON sys_beauty_rnd_versions(conversation_id)`);

        // 用户通知表 (System Notifications)
        await pool.query(`
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
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON sys_notifications(user_id)`);

        logger.info('[DDL] 系统基础及审计日志表结构初始化完成 ✓');

        // --- 商品库录入历史记录表 ---
        await pool.query(`
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
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_product_entry_history_created_at ON product_entry_history(created_at DESC)`);
        logger.info('[DDL] 商品库录入历史记录表初始化完成 ✓');

        // --- 选品策略会话表 ---
        await pool.query(`
            CREATE TABLE IF NOT EXISTS sys_product_selection_conversations (
                id                    SERIAL PRIMARY KEY,
                user_id               INTEGER NOT NULL,
                title                 VARCHAR(200) NOT NULL DEFAULT '',
                dify_conversation_id  VARCHAR(100),
                created_at            TIMESTAMPTZ DEFAULT NOW(),
                updated_at            TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_ps_conv_user ON sys_product_selection_conversations(user_id)`);
        logger.info('[DDL] 选品策略会话表初始化完成 ✓');

        // --- 选品策略消息表 ---
        await pool.query(`
            CREATE TABLE IF NOT EXISTS sys_product_selection_messages (
                id              SERIAL PRIMARY KEY,
                conversation_id INTEGER NOT NULL,
                role            VARCHAR(20) NOT NULL,
                content         TEXT,
                files           JSONB,
                stopped         BOOLEAN DEFAULT FALSE,
                created_at      TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_ps_msg_conv ON sys_product_selection_messages(conversation_id)`);
        // 兼容已有表：补充 stopped 列
        await pool.query(`
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sys_product_selection_messages' AND column_name = 'stopped') THEN
                    ALTER TABLE sys_product_selection_messages ADD COLUMN stopped BOOLEAN DEFAULT FALSE;
                END IF;
            END $$
        `);
        logger.info('[DDL] 选品策略消息表初始化完成 ✓');

        // --- 发票校验历史记录表 ---
        try {
            const invoiceSqlPath = path.join(__dirname, '../database/create_invoice_verify_table.sql');
            if (fs.existsSync(invoiceSqlPath)) {
                const invoiceSql = fs.readFileSync(invoiceSqlPath, 'utf8');
                await pool.query(invoiceSql);
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
                await pool.query(sqlContent);
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
                await pool.query(tenderSql);
                // 兼容已有表：新增 bid_id 字段
                await pool.query("ALTER TABLE sys_tender_results ADD COLUMN IF NOT EXISTS bid_id VARCHAR(200) DEFAULT ''");
                await pool.query("ALTER TABLE sys_tender_results ADD COLUMN IF NOT EXISTS bid_no VARCHAR(200) DEFAULT ''");
                await pool.query("ALTER TABLE sys_tender_results ADD COLUMN IF NOT EXISTS bid_type INTEGER DEFAULT 0");
                await pool.query("ALTER TABLE sys_tender_results ADD COLUMN IF NOT EXISTS bid_process INTEGER DEFAULT 0");
                await pool.query("ALTER TABLE sys_tender_results ADD COLUMN IF NOT EXISTS candidate_names JSONB DEFAULT '[]'::jsonb");
                await pool.query("ALTER TABLE sys_tender_results ADD COLUMN IF NOT EXISTS winning_company VARCHAR(500) DEFAULT ''");
                await pool.query("ALTER TABLE sys_tender_results ADD COLUMN IF NOT EXISTS winning_amount VARCHAR(200) DEFAULT ''");
                await pool.query("ALTER TABLE sys_tender_results ADD COLUMN IF NOT EXISTS announcement_date VARCHAR(100) DEFAULT ''");
                await pool.query("ALTER TABLE sys_tender_results ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ");
                await pool.query("ALTER TABLE sys_tender_results ADD COLUMN IF NOT EXISTS sync_status VARCHAR(100) DEFAULT ''");
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
                await pool.query(kaSql);
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
                await pool.query(bidSql);
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
                await pool.query(reviewSql);
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
                await pool.query(mpSql);
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
                await pool.query(opSql);
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
                await pool.query(txSql);
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
                await pool.query(lgSql);
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
                await pool.query(pkgSql);
                // 兼容旧表：补充 name / attribute / weight 字段
                await pool.query(`
                    ALTER TABLE sys_logistics_packaging
                    ADD COLUMN IF NOT EXISTS name VARCHAR(100) NOT NULL DEFAULT '',
                    ADD COLUMN IF NOT EXISTS attribute VARCHAR(50) NOT NULL DEFAULT '',
                    ADD COLUMN IF NOT EXISTS weight NUMERIC(10,3) NOT NULL DEFAULT 0
                `);
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
                await pool.query(planSql);
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
                await pool.query(eqSql);
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
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ success: false, message: '请提供有效的用户名和密码' });
    }

    try {
        // 从 PG sys_users 表查询
        const result = await pool.query(
            'SELECT id, username, password_hash, role, is_active, display_name FROM sys_users WHERE username = $1',
            [username]
        );

        if (result.rowCount === 0) {
            logAudit(req, { module: 'AUTH', action: 'LOGIN_FAIL', details: { username, reason: 'USER_NOT_FOUND' } });
            return res.status(401).json({ success: false, message: '用户不存在' });
        }

        const user = result.rows[0];

        if (!user.is_active) {
            return res.status(403).json({ success: false, message: '账号已被禁用，请联系管理员' });
        }

        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            logAudit(req, { module: 'AUTH', action: 'LOGIN_FAIL', details: { username, reason: 'PASSWORD_ERROR' } });
            return res.status(401).json({ success: false, message: '密码错误' });
        }

        // 更新最后登录时间
        pool.query('UPDATE sys_users SET last_login_at = NOW() WHERE id = $1', [user.id]).catch(() => { });

        // --- 刷新自动登出/会话清理优化 ---
        // 我们不再强制清理同 IP 的旧会话，以避免误杀。改为交给下方的总数限制逻辑统一处理。
        const rawUA = req.headers['user-agent'] || '';
        const deviceInfoStr = rawUA.length > 120 ? rawUA.slice(0, 120) + '...' : rawUA;
        const rawIP = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '';
        const ipAddrStr = normalizeIp(rawIP);

        // 检查并发登录限制 (上限 5 个活跃会话)
        const sessionCountRes = await pool.query(
            'SELECT COUNT(*) FROM sys_user_sessions WHERE user_id = $1 AND revoked = FALSE AND expires_at > NOW()',
            [user.id]
        );
        const activeSessions = parseInt(sessionCountRes.rows[0].count);

        // 如果达到 5 个限制，则踢出最早的一个会话 (实现“强制登出第一个登陆的人”)
        if (activeSessions >= 5) {
            try {
                const oldestSession = await pool.query(
                    'SELECT jti FROM sys_user_sessions WHERE user_id = $1 AND revoked = FALSE AND expires_at > NOW() ORDER BY created_at ASC LIMIT 1',
                    [user.id]
                );
                if (oldestSession.rowCount > 0) {
                    const oldJti = oldestSession.rows[0].jti;
                    await pool.query(
                        'UPDATE sys_user_sessions SET revoked = TRUE, revoked_at = NOW() WHERE jti = $1',
                        [oldJti]
                    );
                    logger.info(`[SessionLimit] 账号 ${user.username} 达到 5 人上限，已强制登出最早会话 ${oldJti}`);
                }
            } catch (e) {
                logger.error('[SessionCleanup] Failed to kick oldest session:', e);
            }
        }

        // 生成唯一会话 ID (jti)
        const jti = crypto.randomBytes(24).toString('hex');
        const expiresAt = new Date(Date.now() + 5 * 60 * 60 * 1000); // 5小时

        // 解析设备信息
        const ua = req.headers['user-agent'] || '';
        const deviceInfo = ua.length > 120 ? ua.slice(0, 120) + '...' : ua;
        const ipAddress = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '';

        // 写入会话记录
        pool.query(
            'INSERT INTO sys_user_sessions (user_id, jti, device_info, ip_address, expires_at) VALUES ($1, $2, $3, $4, $5)',
            [user.id, jti, deviceInfo, ipAddrStr, expiresAt]
        ).catch(() => { });

        // 记录登录审计
        logAudit({ ...req, user: { id: user.id, username: user.username } },
            { module: 'AUTH', action: 'LOGIN_SUCCESS', details: { username: user.username } });

        // 签发 Token，过期限定在 2小时，内嵌 jti
        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role, jti },
            JWT_SECRET,
            { expiresIn: '4h' }
        );

        logger.info(`用户 ${username} 登陆成功，下发凭证`);
        return res.json({
            success: true,
            message: '登录成功',
            data: {
                token: token,
                username: user.username,
                display_name: user.display_name || user.username,
                role: user.role
            }
        });
    } catch (err) {
        logger.error('登录系统异常', err);
        return res.status(500).json({ success: false, message: '系统内部验证错误' });
    }
});

// API路由: 用户登出 (吊销当前 JTI)
app.post('/api/auth/logout', authenticateToken, async (req, res) => {
    try {
        if (req.user && req.user.jti) {
            await pool.query(
                'UPDATE sys_user_sessions SET revoked = TRUE, revoked_at = NOW() WHERE jti = $1',
                [req.user.jti]
            );
            logAudit(req, { module: 'AUTH', action: 'LOGOUT', details: { username: req.user.username } });
            logger.info(`用户 ${req.user.username} 登出，会话 ${req.user.jti} 已吊销`);
        }
        res.clearCookie(DSH_ACCESS_COOKIE, { ...dshCookieOptions(), maxAge: undefined });
        res.json({ success: true, message: '已成功退出登录' });
    } catch (err) {
        logger.error('登出失败：' + err.message);
        res.status(500).json({ success: false, message: '登出操作失败' });
    }
});

// Beacon 专用静默登出 (不返回 JSON，由浏览器在关闭/刷新时自动触发)
app.post('/api/auth/logout-beacon', async (req, res) => {
    try {
        const { token } = req.body;
        if (token) {
            const decoded = jwt.verify(token, JWT_SECRET);
            if (decoded && decoded.jti) {
                await pool.query(
                    'UPDATE sys_user_sessions SET revoked = TRUE, revoked_at = NOW() WHERE jti = $1',
                    [decoded.jti]
                );
                const rawIP = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '';
                const ua = req.headers['user-agent'] || 'Unknown';
                logger.info(`[Beacon] 会话 ${decoded.jti} (用户: ${decoded.username}, IP: ${normalizeIp(rawIP)}, UA: ${ua}) 已通过浏览器刷新/关闭自动吊销`);
            }
        }
        res.status(204).end();
    } catch (err) {
        res.status(204).end(); // 始终返回成功以防阻塞
    }
});



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
async function logAudit(req, { module, action, target_data, details, status = 'SUCCESS' }) {
    try {
        if (!req) req = {};
        const user = req.user || {}; // 从 authenticateToken 获取
        const ip = req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '';
        const ua = req.headers?.['user-agent'] || '';
        await pool.query(
            `INSERT INTO sys_audit_logs (user_id, username, module, action, target_data, details, status, ip_address, user_agent) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
                user.id || user.userId || null,
                user.username || 'ANONYMOUS',
                module,
                action,
                target_data ? (typeof target_data === 'string' ? target_data : JSON.stringify(target_data)) : '',
                details ? (typeof details === 'string' ? details : JSON.stringify(details)) : '',
                status,
                ip,
                ua
            ]
        );
    } catch (err) {
        logger.error('[AuditLog Error] ' + err.message);
    }
}
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
app.post('/api/update-data', async (req, res) => {
    try {
        console.log('[API请求] 收到手动更新请求');
        logAudit(req, { module: 'PREDICTION', action: 'UPDATE_DATA' });
        const result = await runPythonScript();
        res.json(result);
    } catch (error) {
        console.error('[API错误]', error);
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// API路由: 查询更新状态
app.get('/api/status', (req, res) => {
    // 计算下次更新时间（每小时的整点）
    const now = new Date();
    const nextUpdate = new Date(now);
    nextUpdate.setHours(now.getHours() + 1, 0, 0, 0);

    res.json({
        lastUpdate: lastUpdateStatus.lastUpdate,
        status: lastUpdateStatus.status,
        message: lastUpdateStatus.message,
        isRunning: lastUpdateStatus.isRunning,
        nextUpdate: nextUpdate.toISOString()
    });
});

// 健康检查
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

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
app.post('/api/news/generate', async (req, res) => {
    try {
        const caller = req.user?.username || 'web_user';
        const industry = req.body.industry || '';
        logAudit(req, { module: 'DAILY_NEWS', action: 'GENERATE', details: { industry } });
        const result = await generateDailyNews(caller, industry);
        res.json(result);
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 查询最新新闻状态
app.get('/api/news/latest', (req, res) => {
    res.json({
        lastUpdate: lastNewsUpdateStatus.lastUpdate,
        status: lastNewsUpdateStatus.status,
        isRunning: lastNewsUpdateStatus.isRunning
    });
});

// 获取历史新闻列表
app.get('/api/news/history', async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT id, report_date, industry, TO_CHAR(created_at + interval '8 hours', 'YYYY-MM-DD HH24:MI:SS') as created_at FROM app_news_history ORDER BY id DESC LIMIT 50"
        );
        res.json({ success: true, data: result.rows });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 获取历史新闻详情
app.get('/api/news/history/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM app_news_history WHERE id = $1', [id]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, message: '未找到该记录' });
        res.json({ success: true, data: result.rows[0] });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 删除单条历史记录
app.delete('/api/news/history/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM app_news_history WHERE id = $1', [id]);
        res.json({ success: true, message: '删除成功' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 清空历史记录
app.delete('/api/news/history', async (req, res) => {
    try {
        await pool.query('DELETE FROM app_news_history');
        res.json({ success: true, message: '所有历史记录已清空' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 添加自定义关键词 (聚合逻辑：同用户同分类存放在一行)
app.post('/api/news/keywords', authenticateToken, async (req, res) => {
    try {
        const { group_name, keyword } = req.body;
        const creator = req.user?.username || 'web_user';
        if (!group_name || !keyword) return res.status(400).json({ success: false, message: '缺失参数' });

        // 检查是否存在
        const check = await pool.query(
            'SELECT id, group_name, keyword, creator FROM ref_news_keywords WHERE group_name = $1 AND creator = $2 LIMIT 1',
            [group_name, creator]
        );

        if (check.rows.length > 0) {
            const row = check.rows[0];
            let list = Array.isArray(row.keyword) ? row.keyword : [row.keyword];
            if (!list.includes(keyword)) {
                list.push(keyword);
                await pool.query(
                    'UPDATE ref_news_keywords SET keyword = $1::jsonb WHERE id = $2',
                    [JSON.stringify(list), row.id]
                );
            }
            res.json({ success: true, data: { ...row, group_name: row.group_name || group_name, keyword: list, creator: row.creator } });
        } else {
            const result = await pool.query(
                'INSERT INTO ref_news_keywords (group_name, keyword, creator, sort_order) VALUES ($1, $2::jsonb, $3, 999) RETURNING *',
                [group_name, JSON.stringify([keyword]), creator]
            );
            res.json({ success: true, data: result.rows[0] });
        }
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 删除自定义关键词 (聚合逻辑：从数组中移除)
app.delete('/api/news/keywords/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { keyword } = req.query;
        const currentUser = req.user?.username || 'web_user';

        const check = await pool.query('SELECT creator, keyword FROM ref_news_keywords WHERE id = $1', [id]);
        if (check.rows.length === 0) return res.status(404).json({ success: false, message: '未找到该关键词' });

        const record = check.rows[0];
        if (!record.creator || record.creator !== currentUser) {
            return res.status(403).json({ success: false, message: '权限不足：无法删除他人添加的关键词' });
        }

        let list = Array.isArray(record.keyword) ? record.keyword : [record.keyword];
        if (keyword) {
            list = list.filter(k => k !== keyword);
            if (list.length > 0) {
                await pool.query('UPDATE ref_news_keywords SET keyword = $1::jsonb WHERE id = $2', [JSON.stringify(list), id]);
                return res.json({ success: true, message: '已移除词条' });
            }
        }
        await pool.query('DELETE FROM ref_news_keywords WHERE id = $1', [id]);
        res.json({ success: true, message: '已删除关键词记录' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

/* 
// 备注：以下旧版文件存储接口已弃用，统一迁移至下方 PostgreSQL 存储版本
// 获取每日推送偏好
app.get('/api/news/preferences', (req, res) => {
    res.json(getNewsPrefs());
});

// 保存每日推送偏好
app.post('/api/news/preferences', (req, res) => {
    try {
        const { defaultIndustry, countLimit, pushTime } = req.body;
        const newPrefs = {
            defaultIndustry: defaultIndustry || 'AI、人工智能、大模型',
            countLimit: countLimit || 12,
            pushTime: pushTime || '08:30'
        };
        fs.writeFileSync(NEWS_PREFS_PATH, JSON.stringify(newPrefs, null, 2), 'utf-8');
        console.log('[Prefs] 更新成功:', newPrefs);
        res.json({ success: true, data: newPrefs });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});
*/

// 新闻深度解析 API
app.post('/api/news/analyze', async (req, res) => {
    try {
        const caller = req.user?.username || 'web_user';
        const query = req.body.query || '';
        const newsContext = req.body.newsContext || [];
        logAudit(req, { module: 'DAILY_NEWS', action: 'ANALYZE', details: { query } });

        const apiKey = process.env.DIFY_NEWS_ANALYZE_API_KEY || process.env.DIFY_NEWS_API_KEY;
        const apiUrl = process.env.DIFY_NEWS_ANALYZE_API_URL || `${process.env.DIFY_NEWS_API_URL}/chat-messages`;

        // 将当天新闻拼接为字符串供模型参考
        const contextStr = newsContext.map((n, i) => `【${i + 1}】${n.title} (来源: ${n.source || '未知'})`).join('\n\n');

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: {
                    news_context: contextStr
                },
                query: query,
                response_mode: 'blocking',
                conversation_id: '',
                user: caller
            })
        });

        if (!response.ok) throw new Error(`Dify API 请求失败: ${await response.text()}`);

        const data = await response.json();

        // 提取返回的大文本 (兼容 Chatflow 的 answer 和旧版 Workflow 的 outputs)
        let resultText = '';
        if (data && data.answer) {
            resultText = data.answer;
        } else if (data && data.data && data.data.outputs) {
            const outputs = data.data.outputs;
            const firstOutputVal = Object.values(outputs)[0];
            if (typeof firstOutputVal === 'string') {
                resultText = firstOutputVal;
            } else if (typeof firstOutputVal === 'object') {
                resultText = JSON.stringify(firstOutputVal, null, 2);
            } else {
                resultText = String(firstOutputVal);
            }
        }
        res.json({ success: true, data: resultText || '(AI未返回有效的解析文本内容)' });
    } catch (e) {
        console.error('[新闻解析错误]', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ==================== 结束 每日新闻 工作流 ====================

// API路由: 调用智能引擎进行AI分析
app.post('/api/ai-analysis', async (req, res) => {
    try {
        const { selectedSkuIds, salesData } = req.body;

        // 数据验证
        if (!selectedSkuIds || !Array.isArray(selectedSkuIds) || selectedSkuIds.length === 0) {
            return res.status(400).json({ error: '缺少或无效的SKU列表' });
        }
        if (!salesData) {
            return res.status(400).json({ error: '缺少销售数据' });
        }

        console.log(`[智能分析引擎] 收到分析请求, SKU数量: ${selectedSkuIds.length}`);
        logAudit(req, { module: 'MARKET_INSIGHT', action: 'RUN_ANALYSIS', details: { sku_count: selectedSkuIds.length } });

        // 过滤数据（只保留选中的SKU）
        const filteredData = {
            monthly_matrix: salesData.monthly_matrix.filter(
                row => selectedSkuIds.includes(row.sku_id)
            ),
            quarterly_matrix: salesData.quarterly_matrix.filter(
                row => selectedSkuIds.includes(row.sku_id)
            ),
            meta_info: salesData.meta_info
        };

        console.log(`[Dify API] 数据切片完成, 月度: ${filteredData.monthly_matrix.length}, 季度: ${filteredData.quarterly_matrix.length}`);

        // ====== 【第一步：品牌提取】调用 DIFY_BRAND_EXTRACT_API_KEY 自动更新品牌字典 ======
        // 提取本次请求涉及的所有商品名（去重）
        const productNamesForExtract = [
            ...new Set([
                ...filteredData.monthly_matrix.map(r => r.product_name),
                ...filteredData.quarterly_matrix.map(r => r.product_name)
            ].filter(Boolean))
        ];

        console.log(`[Dify API] Step 1/2 - 触发品牌提取（${productNamesForExtract.length} 个商品名），等待 brand_dictionary 更新...`);
        const extractResult = await extractBrandsFromProducts(productNamesForExtract);
        if (extractResult.success) {
            const addedMsg = extractResult.added != null ? `，新增 ${extractResult.added} 个品牌` : '';
            console.log(`[Dify API] Step 1/2 完成 ✅ 品牌字典已更新${addedMsg}`);
        } else {
            console.warn(`[Dify API] Step 1/2 品牌提取失败（${extractResult.message}），继续使用现有品牌字典`);
        }
        // ============================================================================

        // ====== 【第二步：品牌脱敏】从 PG 加载最新品牌字典，替换 product_name 中的品牌名 ======
        console.log(`[Dify API] Step 2/2 - 加载最新品牌字典并进行脱敏...`);
        let brandDict = [];
        try {
            const brandRes = await pool.query('SELECT id, brand_name FROM brand_dictionary ORDER BY id');
            brandDict = brandRes.rows;
            console.log(`[Dify API] 已加载品牌字典，共 ${brandDict.length} 条（正在脱敏 product_name）`);
        } catch (brandErr) {
            console.warn('[Dify API] ⚠️ 品牌字典加载失败，将以原始数据继续:', brandErr.message);
        }
        const maskedFilteredData = maskProductNamesByBrandDict(filteredData, brandDict);
        // 脱敏日志（仅打印前3条作为抽样核验）
        if (brandDict.length > 0 && maskedFilteredData.monthly_matrix.length > 0) {
            const samples = maskedFilteredData.monthly_matrix.slice(0, 3).map(r => `[${r.sku_id}] ${r.product_name}`);
            console.log(`[Dify API] 脱敏后 product_name 样例:\n  ${samples.join('\n  ')}`);
        }
        // =====================================================================

        // 获取Dify Chatflow配置
        const DIFY_API_KEY = process.env.DIFY_CHATFLOW_API_KEY || 'app-xxx';
        const DIFY_API_URL = process.env.DIFY_CHATFLOW_API_URL || 'http://39.108.221.22/v1/chat-messages';

        // 构造Dify Chatflow请求体（使用脱敏后的数据）
        const difyRequestBody = {
            inputs: {},
            query: JSON.stringify(maskedFilteredData, null, 2),
            response_mode: "streaming",
            conversation_id: "",
            user: req.user?.username || "web_user"
        };

        console.log(`[Dify API] 调用Dify API: ${DIFY_API_URL}`);

        // 调用Dify API（使用fetch）
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
            console.error(`[Dify API] 错误: ${difyResponse.status} - ${errorText}`);
            return res.status(difyResponse.status).json({
                error: `Dify API调用失败: ${difyResponse.status}`,
                details: errorText
            });
        }

        // 设置SSE响应头
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no'); // 禁用nginx缓冲

        console.log(`[Dify API] 开始转发流式响应`);

        // 转发流式响应
        const reader = difyResponse.body.getReader();
        const decoder = new TextDecoder();

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    console.log(`[Dify API] 流式响应完成`);
                    break;
                }

                const chunk = decoder.decode(value, { stream: true });
                res.write(chunk);
            }
        } catch (streamError) {
            console.error(`[Dify API] 流式响应错误:`, streamError);
        } finally {
            res.end();
        }
    } catch (error) {
        console.error('[Dify API] 处理错误:', error);
        if (!res.headersSent) {
            res.status(500).json({
                error: '处理AI分析请求时出错',
                message: error.message
            });
        }
    }
});

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
app.post('/api/dify/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: '未找到文件数据' });
        }
        logAudit(req, { module: 'LAYOUT_COMPARE', action: 'UPLOAD_FILE', target_data: fixUploadedFileName(req.file.originalname) });

        const apiKey = process.env.DIFY_LAYOUT_COMPARE_API_KEY;
        let apiUrl = process.env.DIFY_LAYOUT_COMPARE_API_URL;
        if (apiUrl && !apiUrl.endsWith('/v1')) {
            apiUrl = `${apiUrl.replace(/\/$/, '')}/v1`;
        }

        if (!apiKey || !apiUrl) {
            return res.status(500).json({ success: false, message: '服务端未配置 Dify Layout Compare API_KEY' });
        }

        const formData = new FormData();
        // 诊改优化：从磁盘读取文件，不再依赖已失效的内存 buffer
        const fileContent = fs.readFileSync(req.file.path);
        const { Blob: NodeBlob } = await import('buffer');
        const blob = new NodeBlob([fileContent], { type: req.file.mimetype });
        formData.append('file', blob, req.file.originalname);
        formData.append('user', req.user?.username || 'web_os_user');

        const difyRes = await fetch(`${apiUrl}/files/upload`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`
            },
            body: formData
        });

        const resText = await difyRes.text();
        if (!difyRes.ok) {
            console.error(`[Dify 上传失败] 状态码: ${difyRes.status}, 响应: ${resText}`);
            throw new Error(`Dify 文件上传失败 (${difyRes.status}): ${resText.substring(0, 200)}`);
        }

        try {
            const data = JSON.parse(resText);
            res.json({ success: true, file_id: data.id });
        } catch (parseError) {
            throw new Error(`无法解析 Dify 响应为 JSON。可能由于 API_URL 错误。\n收到的原始文本(部分): ${resText.substring(0, 200)}`);
        }
    } catch (e) {
        console.error('[Dify 上传失败]', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// 2. 触发 Dify 版式对比工作流
app.post('/api/layout-compare/run', async (req, res) => {
    try {
        const { leftImageId, rightImageId, isSingle } = req.body;
        logAudit(req, { module: 'LAYOUT_COMPARE', action: 'RUN_COMPARE', details: { leftImageId, rightImageId, isSingle } });

        if (!leftImageId) {
            return res.status(400).json({ success: false, message: '必须提供至少一张图的文件ID' });
        }

        const apiKey = process.env.DIFY_LAYOUT_COMPARE_API_KEY;
        let apiUrl = process.env.DIFY_LAYOUT_COMPARE_API_URL;
        if (apiUrl && !apiUrl.endsWith('/v1')) {
            apiUrl = `${apiUrl.replace(/\/$/, '')}/v1`;
        }

        if (!apiKey || !apiUrl) {
            return res.status(500).json({ success: false, message: '服务端未配置 Dify Layout Compare API_KEY' });
        }

        // 构造发送到 Dify Workflow 的标准大图数据封装
        const fileList = [];
        if (leftImageId) {
            fileList.push({
                type: 'image',
                transfer_method: 'local_file',
                upload_file_id: leftImageId
            });
        }
        if (rightImageId) {
            fileList.push({
                type: 'image',
                transfer_method: 'local_file',
                upload_file_id: rightImageId
            });
        }

        const payload = {
            inputs: {
                image_a: leftImageId,
                image_b: rightImageId,
                is_single_image: isSingle
            },
            files: fileList,
            response_mode: 'blocking',
            user: req.user?.username || 'web_os_user'
        };

        const difyRes = await fetch(`${apiUrl}/workflows/run`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const resText = await difyRes.text();
        if (!difyRes.ok) {
            console.error(`[Dify 工作流调用报错] 状态码: ${difyRes.status}, 响应: ${resText}`);
            throw new Error(`Dify 工作流调用报错 (${difyRes.status}): ${resText.substring(0, 200)}`);
        }

        try {
            const bodyData = JSON.parse(resText);

            // 尝试解析并返回报告结果
            let finalReport = '';
            const rawOutputs = bodyData?.data?.outputs || bodyData?.data || bodyData;

            if (rawOutputs && typeof rawOutputs === 'object' && Object.keys(rawOutputs).length > 0) {
                if (rawOutputs.text !== undefined) {
                    finalReport = typeof rawOutputs.text === 'object' ? JSON.stringify(rawOutputs.text) : String(rawOutputs.text);
                } else if (rawOutputs.result !== undefined) {
                    finalReport = typeof rawOutputs.result === 'object' ? JSON.stringify(rawOutputs.result) : String(rawOutputs.result);
                } else if (rawOutputs.output !== undefined) {
                    finalReport = typeof rawOutputs.output === 'object' ? JSON.stringify(rawOutputs.output) : String(rawOutputs.output);
                } else {
                    const firstKeyVal = Object.values(rawOutputs)[0];
                    finalReport = typeof firstKeyVal === 'object' ? JSON.stringify(firstKeyVal, null, 2) : String(firstKeyVal);
                }

                // 如果解构出来是个纯未定义字样，索性把整包展示以便查错
                if (finalReport === 'undefined') {
                    finalReport = "【未定义抓取】系统发现输出参数为 undefined，原始回传报文如下：\n```json\n" + JSON.stringify(rawOutputs, null, 2) + "\n```";
                }
            } else {
                finalReport = "【警示】未截获有效的输出源。详细通讯帧：\n```json\n" + JSON.stringify(bodyData, null, 2) + "\n```";
            }

            // 过滤大模型可能附带的思考过程 (<think>...</think>)
            if (typeof finalReport === 'string') {
                finalReport = finalReport.replace(/<think>[\s\S]*?<\/think>(\\n|\s)*/gi, '').trim();
                // 还原可能被转义的普通换行符为真实换行符，确保 Markdown 正确解析
                finalReport = finalReport.replace(/\\n/g, '\n');
            }

            res.json({ success: true, data: finalReport });
        } catch (parseErr) {
            throw new Error(`无法解析 Dify 响应为 JSON。可能由于 API_URL 错误。\n收到的原始文本(部分): ${resText.substring(0, 200)}`);
        }


    } catch (e) {
        console.error('[版式对比请求失败]', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ====================== 发票校验功能集成 ======================

// 1. 发票校验 - 文件上传中转（PDF/xlsx → Dify file_id）
app.post('/api/invoice-verify/upload', authenticateToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: '未找到文件数据' });
        }
        logAudit(req, { module: 'INVOICE_VERIFY', action: 'UPLOAD_FILE', target_data: fixUploadedFileName(req.file.originalname) });

        const apiKey = process.env.DIFY_INVOICE_VERIFY_API_KEY;
        let apiUrl = process.env.DIFY_INVOICE_VERIFY_API_URL;
        if (apiUrl && !apiUrl.endsWith('/v1')) {
            apiUrl = `${apiUrl.replace(/\/$/, '')}/v1`;
        }

        if (!apiKey || !apiUrl) {
            return res.status(500).json({ success: false, message: '服务端未配置 DIFY_INVOICE_VERIFY_API_KEY' });
        }

        const formData = new FormData();
        const fileContent = fs.readFileSync(req.file.path);
        const { Blob: NodeBlob } = await import('buffer');
        const blob = new NodeBlob([fileContent], { type: req.file.mimetype });
        formData.append('file', blob, req.file.originalname);
        formData.append('user', req.user?.username || 'web_os_user');

        const difyRes = await fetch(`${apiUrl}/files/upload`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`
            },
            body: formData
        });

        const resText = await difyRes.text();
        if (!difyRes.ok) {
            console.error(`[Dify 发票上传失败] 状态码: ${difyRes.status}, 响应: ${resText}`);
            throw new Error(`Dify 文件上传失败 (${difyRes.status}): ${resText.substring(0, 200)}`);
        }

        try {
            const data = JSON.parse(resText);
            res.json({ success: true, file_id: data.id });
        } catch (parseError) {
            throw new Error(`无法解析 Dify 响应为 JSON。收到的原始文本(部分): ${resText.substring(0, 200)}`);
        }
    } catch (e) {
        console.error('[发票校验上传失败]', e);
        res.status(500).json({ success: false, message: e.message });
    } finally {
        // 统一清理临时文件
        if (req.file?.path) { try { fs.unlinkSync(req.file.path); } catch (_) { /* 忽略 */ } }
    }
});

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

app.post('/api/invoice-verify/run', authenticateToken, async (req, res) => {
    try {
        const { pdfIds, xlsxIds, pdfNames, xlsxNames } = req.body;
        logAudit(req, { module: 'INVOICE_VERIFY', action: 'RUN_VERIFY', details: { pdfIds, xlsxIds, pdfNames, xlsxNames } });

        if (!pdfIds || pdfIds.length === 0 || !xlsxIds || xlsxIds.length === 0) {
            return res.status(400).json({ success: false, message: '必须提供 PDF 和 XLSX 文件ID' });
        }

        // ── D4 试点迁移（TASK_CENTER_PILOT 含 invoice_verify 时启用）──────────
        // 建任务 → 执行 → 通知闭环；成功后用归一化输出构造与 Dify 阻塞响应同形的
        // bodyData，复用既有解析/落库/响应逻辑 —— 行为零变化。未启用时走下方旧直连路径。
        if (legacyBridge.isPilotSkill('invoice_verify')) {
            const r = await legacyBridge.runThroughTaskCenter({
                skillKey: 'invoice_verify',
                title: `发票校验：${(pdfNames || []).join('、') || '发票PDF'} × ${(xlsxNames || []).join('、') || '对账单'}`,
                user: req.user,
                inputs: {
                    invoice_files: pdfIds.map((id) => ({ type: 'document', transfer_method: 'local_file', upload_file_id: id })),
                    statement_files: xlsxIds.map((id) => ({ type: 'document', transfer_method: 'local_file', upload_file_id: id })),
                },
            });
            if (!r.ok) {
                console.error(`[发票校验-任务中心] ${r.taskNo} 失败 ${r.errorCode}: ${r.message}`);
                return res.status(500).json({ success: false, message: `任务执行失败（${r.taskNo}）：${r.message}` });
            }
            return await respondInvoiceBody(req, res, { data: { outputs: r.outputs ?? {} } }, { pdfNames, xlsxNames });
        }

        const apiKey = process.env.DIFY_INVOICE_VERIFY_API_KEY;
        let apiUrl = process.env.DIFY_INVOICE_VERIFY_API_URL;
        if (apiUrl && !apiUrl.endsWith('/v1')) {
            apiUrl = `${apiUrl.replace(/\/$/, '')}/v1`;
        }

        if (!apiKey || !apiUrl) {
            return res.status(500).json({ success: false, message: '服务端未配置 DIFY_INVOICE_VERIFY_API_KEY' });
        }

        // 构造文件列表（用于 files 数组 备用）
        const fileList = [];
        pdfIds.forEach(id => {
            fileList.push({ type: 'document', transfer_method: 'local_file', upload_file_id: id });
        });
        xlsxIds.forEach(id => {
            fileList.push({ type: 'document', transfer_method: 'local_file', upload_file_id: id });
        });

        // 构造 Dify inputs：将两类文件分别映射到 invoice_files 和 statement_files
        const invoiceFileRefs = pdfIds.map(id => ({
            type: 'document',
            transfer_method: 'local_file',
            upload_file_id: id
        }));
        const statementFileRefs = xlsxIds.map(id => ({
            type: 'document',
            transfer_method: 'local_file',
            upload_file_id: id
        }));

        const payload = {
            inputs: {
                invoice_files: invoiceFileRefs,
                statement_files: statementFileRefs
            },
            response_mode: 'blocking',
            user: req.user?.username || 'web_os_user'
        };

        const difyRes = await fetch(`${apiUrl}/workflows/run`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        // 使用流式读取，避免大响应截断
        const chunks = [];
        const reader = difyRes.body;
        if (reader) {
            const streamReader = reader[Symbol.asyncIterator] ? reader : difyRes.body;
            for await (const chunk of streamReader) {
                chunks.push(Buffer.from(chunk));
            }
        }
        const resText = Buffer.concat(chunks).toString('utf-8');

        if (!difyRes.ok) {
            console.error(`[Dify 发票校验工作流报错] 状态码: ${difyRes.status}, 响应: ${resText.substring(0, 500)}`);
            throw new Error(`Dify 工作流调用报错 (${difyRes.status}): ${resText.substring(0, 300)}`);
        }

        console.log(`[发票校验] Dify 响应长度: ${resText.length} 字符`);

        try {
            const bodyData = JSON.parse(resText);
            return await respondInvoiceBody(req, res, bodyData, { pdfNames, xlsxNames });
        } catch (parseErr) {
            console.error('[发票校验 JSON解析失败]', parseErr.message);
            console.error('[发票校验] resText 前 500 字符:', resText.substring(0, 500));
            console.error('[发票校验] resText 后 200 字符:', resText.substring(resText.length - 200));
            throw new Error(`无法解析 Dify 响应为 JSON: ${parseErr.message}`);
        }

    } catch (e) {
        console.error('[发票校验请求失败]', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// 3. 发票校验 - 获取历史记录
app.get('/api/invoice-verify/history', authenticateToken, async (req, res) => {
    try {
        const username = req.user?.username;
        const result = await pool.query(
            'SELECT id, pdf_name, xlsx_name, result_text, supplier_name, status, created_at, username FROM invoice_verify_history WHERE username = $1 ORDER BY created_at DESC LIMIT 20',
            [username]
        );
        res.json({ success: true, data: result.rows });
    } catch (e) {
        console.error('[发票校验历史查询失败]', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// 4. 发票校验 - 删除历史记录
app.delete('/api/invoice-verify/history/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const username = req.user?.username;
        // 只能删除自己的记录
        const result = await pool.query('DELETE FROM invoice_verify_history WHERE id = $1 AND username = $2', [id, username]);
        if (result.rowCount === 0) {
            return res.status(403).json({ success: false, message: '无权删除该记录' });
        }
        res.json({ success: true, message: '删除成功' });
    } catch (e) {
        console.error('[发票校验历史删除失败]', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// 5. 发票校验 - 更新历史记录状态
app.put('/api/invoice-verify/history/:id/status', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const username = req.user?.username;
        // 验证状态值
        const validStatuses = ['待确认', '已确认', '已退票'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ success: false, message: '无效的状态值' });
        }
        // 查询当前状态，只有“待确认”才允许修改
        const current = await pool.query(
            'SELECT status FROM invoice_verify_history WHERE id = $1 AND username = $2',
            [id, username]
        );
        if (current.rowCount === 0) {
            return res.status(403).json({ success: false, message: '无权更新该记录' });
        }
        if (current.rows[0].status !== '待确认') {
            return res.status(403).json({ success: false, message: '只有待确认状态才允许修改' });
        }
        // 更新状态
        await pool.query(
            'UPDATE invoice_verify_history SET status = $1 WHERE id = $2 AND username = $3',
            [status, id, username]
        );
        res.json({ success: true, message: '状态更新成功' });
    } catch (e) {
        console.error('[发票校验状态更新失败]', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ====================== 商品库录入功能集成 ======================

// 1. 商品库录入 - 文件上传中转（xlsx → Dify file_id）
app.post('/api/product-entry/upload', authenticateToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: '未找到文件数据' });
        }
        logAudit(req, { module: 'PRODUCT_ENTRY', action: 'UPLOAD_FILE', target_data: fixUploadedFileName(req.file.originalname) });

        const apiKey = process.env.DIFY_PRODUCT_ENTRY_API_KEY;
        let apiUrl = process.env.DIFY_PRODUCT_ENTRY_API_URL;
        if (apiUrl && !apiUrl.endsWith('/v1')) {
            apiUrl = `${apiUrl.replace(/\/$/, '')}/v1`;
        }

        if (!apiKey || !apiUrl) {
            return res.status(500).json({ success: false, message: '服务端未配置 DIFY_PRODUCT_ENTRY_API_KEY' });
        }

        const formData = new FormData();
        const fileContent = fs.readFileSync(req.file.path);
        const { Blob: NodeBlob } = await import('buffer');
        const blob = new NodeBlob([fileContent], { type: req.file.mimetype });
        formData.append('file', blob, req.file.originalname);
        formData.append('user', req.user?.username || 'web_os_user');

        const difyRes = await fetch(`${apiUrl}/files/upload`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`
            },
            body: formData
        });

        const resText = await difyRes.text();
        if (!difyRes.ok) {
            console.error(`[Dify 商品库录入上传失败] 状态码: ${difyRes.status}, 响应: ${resText}`);
            throw new Error(`Dify 文件上传失败 (${difyRes.status}): ${resText.substring(0, 200)}`);
        }

        try {
            const data = JSON.parse(resText);
            res.json({ success: true, file_id: data.id });
        } catch (parseError) {
            throw new Error(`无法解析 Dify 响应为 JSON。收到的原始文本(部分): ${resText.substring(0, 200)}`);
        }
    } catch (e) {
        console.error('[商品库录入上传失败]', e);
        res.status(500).json({ success: false, message: e.message });
    } finally {
        // 清理临时文件
        if (req.file?.path) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (unlinkErr) {
                console.warn(`[商品库录入] 清理临时文件失败: ${unlinkErr.message}`);
            }
        }
    }
});

// 2. 商品库录入 - 获取 Sheet 列表（调用 Dify 工作流）
app.post('/api/product-entry/sheets', authenticateToken, async (req, res) => {
    try {
        const { fileId, fileName, supplier } = req.body;
        logAudit(req, { module: 'PRODUCT_ENTRY', action: 'GET_SHEETS', details: { fileId, fileName, supplier } });

        if (!fileId) {
            return res.status(400).json({ success: false, message: '必须提供文件ID' });
        }

        const apiKey = process.env.DIFY_PRODUCT_ENTRY_API_KEY;
        let apiUrl = process.env.DIFY_PRODUCT_ENTRY_API_URL;
        if (apiUrl && !apiUrl.endsWith('/v1')) {
            apiUrl = `${apiUrl.replace(/\/$/, '')}/v1`;
        }

        if (!apiKey || !apiUrl) {
            return res.status(500).json({ success: false, message: '服务端未配置 DIFY_PRODUCT_ENTRY_API_KEY' });
        }

        const fileRef = {
            type: 'document',
            transfer_method: 'local_file',
            upload_file_id: fileId
        };

        const payload = {
            inputs: {
                product_file: fileRef,
                supplier: supplier || ''
            },
            response_mode: 'streaming',
            user: req.user?.username || 'web_os_user'
        };

        const difyRes = await fetch(`${apiUrl}/workflows/run`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!difyRes.ok) {
            const errChunks = [];
            for await (const chunk of difyRes.body) { errChunks.push(Buffer.from(chunk)); }
            const errText = Buffer.concat(errChunks).toString('utf-8');
            console.error(`[Dify 商品库获取Sheet列表报错] 状态码: ${difyRes.status}, 响应: ${errText.substring(0, 500)}`);
            throw new Error(`Dify 工作流调用报错 (${difyRes.status}): ${errText.substring(0, 300)}`);
        }

        // 流式模式：解析 SSE 事件
        let sheets = [];
        let brands = [];
        let suppliers = [];
        let formToken = null;
        let workflowRunId = null;
        let taskId = null;

        const sseReader = difyRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const streamTimeout = 120000;
        const streamStart = Date.now();

        while (Date.now() - streamStart < streamTimeout) {
            const { done, value } = await sseReader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const jsonStr = line.slice(6).trim();
                if (!jsonStr) continue;

                try {
                    const event = JSON.parse(jsonStr);
                    const eventType = event?.event;
                    // 只记录关键事件，跳过高频节点事件
                    if (!['node_started','node_finished','iteration_started','iteration_next','iteration_completed'].includes(eventType)) {
                        // SSE 事件日志已精简
                    }

                    // 捕获 task_id 和 workflow_run_id
                    if (!taskId && event?.task_id) {
                        taskId = event.task_id;
                    }
                    if (!workflowRunId && event?.workflow_run_id) {
                        workflowRunId = event.workflow_run_id;
                    }

                    // 更新解析进度（用 fileId 作为 key）
                    if (eventType === 'node_started') {
                        const nodeTitle = event?.data?.title || '';
                        if (nodeTitle && fileId) {
                            workflowProgress.set(`parse_${fileId}`, `正在执行: ${nodeTitle}`);
                        }
                    } else if (eventType === 'node_finished') {
                        const nodeTitle = event?.data?.title || '';
                        if (nodeTitle && fileId) {
                            workflowProgress.set(`parse_${fileId}`, `已完成: ${nodeTitle}`);
                        }
                    }

                    if (eventType === 'human_input_required') {
                        // 人工介入节点：提取 form_token 和 inputs（sheet/brand 列表）
                        formToken = event?.data?.form_token || event?.form_token || null;
                        const inputs = event?.data?.inputs || event?.inputs || [];

                        if (Array.isArray(inputs) && inputs.length > 0) {
                            const optionInputs = inputs.filter(inp => inp?.option_source?.value);

                            if (optionInputs.length >= 2) {
                                for (let i = 0; i < optionInputs.length; i++) {
                                    const inp = optionInputs[i];
                                    const value = inp.option_source.value;
                                    let parsed = [];
                                    if (typeof value === 'string') {
                                        try { parsed = JSON.parse(value); } catch (e) { parsed = value.split(',').map(s => s.trim()).filter(s => s); }
                                    } else if (Array.isArray(value)) { parsed = value; }

                                    const varName = inp?.variable || inp?.name || '';
                                    if (varName.includes('brand') || varName.includes('品牌')) {
                                        brands = parsed;
                                    } else if (varName.includes('supplier') || varName.includes('供应商')) {
                                        suppliers = parsed;
                                    } else if (varName.includes('sheet') || varName.includes('Sheet')) {
                                        sheets = parsed;
                                    } else {
                                        if (sheets.length === 0) {
                                            sheets = parsed;
                                        } else if (brands.length === 0) {
                                            brands = parsed;
                                        } else {
                                            suppliers = parsed;
                                        }
                                    }
                                }
                            } else if (optionInputs.length === 1) {
                                const value = optionInputs[0].option_source.value;
                                if (typeof value === 'string') {
                                    try { sheets = JSON.parse(value); } catch (e) { sheets = value.split(',').map(s => s.trim()).filter(s => s); }
                                } else if (Array.isArray(value)) { sheets = value; }
                            }
                        }
                        // 拿到人工介入数据后即可停止读取
                        try { sseReader.cancel(); } catch (_) {}
                        break;
                    }

                    if (eventType === 'workflow_finished' || eventType === 'workflow_failed' || eventType === 'error') {
                        break;
                    }
                } catch (parseErr) {
                    console.warn(`[商品库录入] SSE 事件解析失败: ${parseErr.message}`);
                }
            }

            if (formToken || sheets.length > 0) break;
        }

        console.log(`[商品库录入] 解析完成: sheets=${sheets.length}, brands=${brands.length}, suppliers=${suppliers.length}, formToken=${!!formToken}`);

        // 清理解析进度
        if (fileId) workflowProgress.delete(`parse_${fileId}`);

        res.json({ success: true, sheets, brands, suppliers, formToken, workflowRunId, taskId, fileId, fileName });
    } catch (e) {
        console.error('[商品库录入获取Sheet列表失败]', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// 3. 商品库录入 - 确认 Sheet 选择（恢复 Dify 人工介入工作流）
app.post('/api/product-entry/confirm-sheet', authenticateToken, async (req, res) => {
    try {
        const { fileId, fileName, selectedSheet, supplier, selectedBrand, selectedSupplier, formToken, workflowRunId } = req.body;
        logAudit(req, { module: 'PRODUCT_ENTRY', action: 'CONFIRM_SHEET', details: { fileId, fileName, selectedSheet, supplier, selectedBrand, selectedSupplier, workflowRunId } });

        if (!selectedSheet) {
            return res.status(400).json({ success: false, message: '必须选择 Sheet' });
        }
        if (!formToken || !workflowRunId) {
            return res.status(400).json({ success: false, message: '缺少工作流恢复信息（formToken/workflowRunId）' });
        }

        const apiKey = process.env.DIFY_PRODUCT_ENTRY_API_KEY;
        let apiUrl = process.env.DIFY_PRODUCT_ENTRY_API_URL;
        if (apiUrl && !apiUrl.endsWith('/v1')) {
            apiUrl = `${apiUrl.replace(/\/$/, '')}/v1`;
        }

        if (!apiKey || !apiUrl) {
            return res.status(500).json({ success: false, message: '服务端未配置 DIFY_PRODUCT_ENTRY_API_KEY' });
        }

        // 先获取表单定义，动态获取 action
        const formDefRes = await fetch(`${apiUrl}/form/human_input/${formToken}`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });

        let submitAction = 'Select';
        if (formDefRes.ok) {
            const formDef = await formDefRes.json();
            const userActions = formDef?.user_actions;
            if (Array.isArray(userActions) && userActions.length > 0) {
                submitAction = userActions[0].id || userActions[0].action || userActions[0].name || 'Select';
            }
        }

        // 提交人工介入表单（恢复工作流）
        const submitPayload = {
            inputs: {
                selected_sheet: selectedSheet,
                selected_brand: selectedBrand || '',
                selected_vendor: selectedSupplier || ''
            },
            action: submitAction,
            user: req.user?.username || 'web_os_user'
        };
        if (supplier && supplier.trim()) {
            submitPayload.inputs.supplier = supplier.trim();
        }

        const difyRes = await fetch(`${apiUrl}/form/human_input/${formToken}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(submitPayload)
        });

        const chunks = [];
        const reader = difyRes.body;
        if (reader) {
            const streamReader = reader[Symbol.asyncIterator] ? reader : difyRes.body;
            for await (const chunk of streamReader) {
                chunks.push(Buffer.from(chunk));
            }
        }
        const resText = Buffer.concat(chunks).toString('utf-8');

        if (!difyRes.ok) {
            console.error(`[Dify 商品库提交表单报错] 状态码: ${difyRes.status}, 响应: ${resText.substring(0, 500)}`);
            throw new Error(`Dify 表单提交报错 (${difyRes.status}): ${resText.substring(0, 300)}`);
        }

        // 表单提交成功后，通过 SSE 事件流获取后续工作流事件
        const userName = submitPayload.user;
        const eventsUrl = `${apiUrl}/workflow/${workflowRunId}/events?user=${encodeURIComponent(userName)}&continue_on_pause=true`;

        let finalOutputs = {};
        let secondPauseData = null;
        let taskId = null;  // 用于停止工作流
        let workflowDone = false;

        try {
            const eventsRes = await fetch(eventsUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Accept': 'text/event-stream'
                }
            });

            if (!eventsRes.ok) {
                const errText = await eventsRes.text();
                console.error(`[商品库录入] SSE 连接失败: ${errText.substring(0, 300)}`);
                throw new Error(`SSE 事件流连接失败 (${eventsRes.status})`);
            }

            // 解析 SSE 事件流
            const sseReader = eventsRes.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            const streamTimeout = 900000; // 15分钟超时
            const streamStart = Date.now();

            while (Date.now() - streamStart < streamTimeout) {
                const { done, value } = await sseReader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop(); // 保留不完整的行

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const jsonStr = line.slice(6).trim();
                    if (!jsonStr) continue;

                    try {
                        const event = JSON.parse(jsonStr);
                        const eventType = event?.event;
                        if (!['node_started','node_finished','iteration_started','iteration_next','iteration_completed'].includes(eventType)) {
                            // SSE 事件日志已精简
                        }

                        // 捕获 task_id（用于停止工作流）
                        if (!taskId && event?.task_id) {
                            taskId = event.task_id;
                        }

                        // 更新解析进度（用 workflowRunId 作为 key）
                        if (eventType === 'node_started') {
                            const nodeTitle = event?.data?.title || '';
                            if (nodeTitle && workflowRunId) {
                                workflowProgress.set(`sheet_${workflowRunId}`, `正在执行: ${nodeTitle}`);
                            }
                        } else if (eventType === 'node_finished') {
                            const nodeTitle = event?.data?.title || '';
                            if (nodeTitle && workflowRunId) {
                                workflowProgress.set(`sheet_${workflowRunId}`, `已完成: ${nodeTitle}`);
                            }
                        }

                        if (eventType === 'human_input_required') {
                            // 第二个人工介入节点！提取 form_token
                            const newFormToken = event?.data?.form_token || event?.form_token;
                            const nodeTitle = event?.data?.node_title || '';
                            // 更新进度：用节点标题提示用户
                            if (nodeTitle && workflowRunId) {
                                workflowProgress.set(`sheet_${workflowRunId}`, `已完成: ${nodeTitle}，等待确认...`);
                            }

                            if (newFormToken) {
                                // 获取表单定义（包含解析出的商品数据）
                                const formDefRes = await fetch(`${apiUrl}/form/human_input/${newFormToken}`, {
                                    method: 'GET',
                                    headers: { 'Authorization': `Bearer ${apiKey}` }
                                });

                                if (formDefRes.ok) {
                                    const formDef = await formDefRes.json();

                                    const formInputs = formDef?.inputs || formDef?.fields || [];
                                    const parsedData = {};

                                    // 从 form_content 解析商品列表（JSON 字符串，可能尾部有变量引用）
                                    const formContent = formDef?.form_content;
                                    if (formContent && typeof formContent === 'string') {
                                        // 提取 JSON 数组部分（去掉尾部的 #$output.xxx# 等变量引用）
                                        const jsonMatch = formContent.match(/^\s*(\[[\s\S]*\])/);
                                        if (jsonMatch) {
                                            try {
                                                const productList = JSON.parse(jsonMatch[1]);
                                                if (Array.isArray(productList) && productList.length > 0) {
                                                    parsedData.productList = productList;
                                                }
                                            } catch (e) {
                                                console.warn(`[商品库录入] form_content JSON 解析失败: ${e.message}`);
                                            }
                                        }
                                    }

                                    // 也从 inputs 的 default.value 中提取
                                    for (const input of formInputs) {
                                        const varName = input?.output_variable_name;
                                        const defaultVal = input?.default?.value;
                                        const optionSource = input?.option_source;
                                        if (varName && optionSource?.value) {
                                            parsedData[varName] = optionSource.value;
                                        }
                                        if (varName && defaultVal && typeof defaultVal === 'string' && defaultVal.trim().startsWith('[')) {
                                            try {
                                                const arr = JSON.parse(defaultVal);
                                                if (Array.isArray(arr) && arr.length > 0 && !parsedData.productList) {
                                                    parsedData.productList = arr;
                                                }
                                            } catch (_) {}
                                        }
                                    }

                                    secondPauseData = {
                                        formToken: newFormToken,
                                        workflowRunId,
                                        data: parsedData
                                    };
                                } else {
                                    console.error(`[商品库录入] 获取表单定义失败: ${formDefRes.status}`);
                                    // 即使没有表单定义，也保存 formToken
                                    secondPauseData = { formToken: newFormToken, workflowRunId, data: {} };
                                }
                            }
                            break;
                        } else if (eventType === 'workflow_finished') {
                            const outputs = event?.data?.outputs || event?.data?.data?.outputs || {};
                            finalOutputs = outputs;
                            // 检查是否包含错误信息（包括用户主动停止）
                            const wfError = event?.data?.error || event?.data?.status;
                            if (wfError && wfError !== 'succeeded' && wfError !== 'finished') {
                                const errMsg = event?.data?.error || `工作流异常结束，状态: ${wfError}`;
                                // 用户主动停止，不视为错误
                                if (isUserStop(errMsg)) {
                                    console.log(`[商品库录入] 工作流已被用户停止`);
                                    break;
                                }
                                console.error(`[商品库录入] 工作流完成但包含错误: ${errMsg}`);
                                throw new Error(`工作流执行失败: ${errMsg}`);
                            }
                            console.log(`[商品库录入] 工作流完成`);
                            break;
                        } else if (eventType === 'workflow_failed' || eventType === 'error') {
                            const errMsg = event?.data?.error || event?.message || '工作流执行失败';
                            // 用户主动停止，不视为错误
                            if (isUserStop(errMsg)) {
                                console.log(`[商品库录入] 工作流已被用户停止`);
                                break;
                            }
                            console.error(`[商品库录入] 工作流失败: ${errMsg}`);
                            throw new Error(`工作流执行失败: ${errMsg}`);
                        }
                    } catch (parseErr) {
                        if (parseErr.message?.includes('工作流执行失败')) throw parseErr;
                        console.warn(`[商品库录入] SSE 事件解析失败: ${parseErr.message}`);
                    }
                }

                if (secondPauseData || Object.keys(finalOutputs).length > 0) break;
            }

            // 超时后取消读取器
            try { sseReader.cancel(); } catch (_) {}
        } catch (sseErr) {
            // SSE 连接终止是正常行为（工作流暂停时），只在真正异常时打印错误
            if (sseErr.message?.includes('terminated')) {
                console.log(`[商品库录入] SSE 事件流已终止: ${sseErr.message}`);
            } else {
                console.error(`[商品库录入] SSE 事件流异常: ${sseErr.message}`);
            }
            
            // SSE 断开后，持续重连等待
            if (!secondPauseData && Object.keys(finalOutputs).length === 0) {
                const maxReconnectAttempts = 5;
                const reconnectWaitMs = 3000;
                
                for (let attempt = 1; attempt <= maxReconnectAttempts; attempt++) {
                    await new Promise(resolve => setTimeout(resolve, reconnectWaitMs));
                    
                    try {
                        const reconnectRes = await fetch(eventsUrl, {
                            method: 'GET',
                            headers: {
                                'Authorization': `Bearer ${apiKey}`,
                                'Accept': 'text/event-stream'
                            }
                        });
                        if (!reconnectRes.ok) continue;
                        
                        const reconnectReader = reconnectRes.body.getReader();
                        const decoder = new TextDecoder();
                        let buffer = '';
                        const readTimeout = 60000;
                        const readStart = Date.now();
                        
                        while (Date.now() - readStart < readTimeout) {
                            const { done, value } = await reconnectReader.read();
                            if (done) break;
                            
                            buffer += decoder.decode(value, { stream: true });
                            const lines = buffer.split('\n');
                            buffer = lines.pop();
                            
                            for (const line of lines) {
                                if (!line.startsWith('data: ')) continue;
                                const jsonStr = line.slice(6).trim();
                                if (!jsonStr) continue;
                                
                                try {
                                    const event = JSON.parse(jsonStr);
                                    const eventType = event?.event;
                                    
                                    // 更新进度
                                    if (eventType === 'node_started') {
                                        const nodeTitle = event?.data?.title || '';
                                        if (nodeTitle && workflowRunId) {
                                            workflowProgress.set(`sheet_${workflowRunId}`, `正在执行: ${nodeTitle}`);
                                        }
                                    } else if (eventType === 'node_finished') {
                                        const nodeTitle = event?.data?.title || '';
                                        if (nodeTitle && workflowRunId) {
                                            workflowProgress.set(`sheet_${workflowRunId}`, `已完成: ${nodeTitle}`);
                                        }
                                    }
                                    
                                    if (eventType === 'human_input_required') {
                                        const newFormToken = event?.data?.form_token || event?.form_token;
                                        if (newFormToken) {
                                            const formDefRes = await fetch(`${apiUrl}/form/human_input/${newFormToken}`, {
                                                method: 'GET',
                                                headers: { 'Authorization': `Bearer ${apiKey}` }
                                            });
                                            if (formDefRes.ok) {
                                                const formDef = await formDefRes.json();
                                                const parsedData = {};
                                                const formContent = formDef?.form_content;
                                                if (formContent && typeof formContent === 'string') {
                                                    const jsonMatch = formContent.match(/^\s*(\[[\s\S]*\])/);
                                                    if (jsonMatch) {
                                                        try {
                                                            const productList = JSON.parse(jsonMatch[1]);
                                                            if (Array.isArray(productList)) parsedData.productList = productList;
                                                        } catch (e) {}
                                                    }
                                                }
                                                secondPauseData = { formToken: newFormToken, workflowRunId, data: parsedData };
                                            }
                                        }
                                        break;
                                    } else if (eventType === 'workflow_finished') {
                                        finalOutputs = event?.data?.outputs || {};
                                        // 检查是否包含错误信息（包括用户主动停止）
                                        const wfError = event?.data?.error || event?.data?.status;
                                        if (wfError && wfError !== 'succeeded' && wfError !== 'finished') {
                                            const errMsg = event?.data?.error || `状态: ${wfError}`;
                                            if (isUserStop(errMsg)) {
                                                break;
                                            }
                                            throw new Error(`工作流执行失败: ${errMsg}`);
                                        }
                                        break;
                                    } else if (eventType === 'workflow_failed' || eventType === 'error') {
                                        const errMsg = event?.data?.error || event?.message || '未知错误';
                                        if (isUserStop(errMsg)) {
                                            break;
                                        }
                                        throw new Error(`工作流执行失败: ${errMsg}`);
                                    }
                                } catch (parseErr) {
                                    if (parseErr.message?.includes('工作流执行失败')) throw parseErr;
                                }
                            }
                            if (secondPauseData || Object.keys(finalOutputs).length > 0) break;
                        }
                        try { reconnectReader.cancel(); } catch (_) {}
                        if (secondPauseData || Object.keys(finalOutputs).length > 0) break;
                    } catch (reconnectErr) {
                        console.error(`[商品库录入] 重连异常: ${reconnectErr.message}`);
                    }
                }
            }
        }

        // 检查是否超时（没有获取到任何结果）
        const noResult = !secondPauseData && Object.keys(finalOutputs).length === 0 && !workflowDone;
        if (noResult) {
            // 清理进度
            if (workflowRunId) workflowProgress.delete(`sheet_${workflowRunId}`);
            res.json({ 
                success: false, 
                message: '工作流执行时间过长，未获取到结果。请尝试重新操作，或联系技术人员检查 Dify 工作流状态。',
                timeout: true,
                workflowRunId,
                fileId, 
                fileName 
            });
            return;
        }

        // 如果有第二个人工介入数据，返回给前端让用户确认
        if (secondPauseData) {
            console.log(`[商品库录入] 返回第二个人工介入数据给前端, taskId: ${taskId}`);
            // 清理进度
            if (workflowRunId) workflowProgress.delete(`sheet_${workflowRunId}`);
            res.json({ 
                success: true, 
                paused: true, 
                formToken: secondPauseData.formToken,
                workflowRunId: secondPauseData.workflowRunId,
                taskId: taskId,  // 用于停止工作流
                parsedData: secondPauseData.data,
                fileId, 
                fileName 
            });
            return;
        }

        try {
            let markdownText = '';
            let skuList = [];

            // 提取 Markdown 文本
            markdownText = finalOutputs.text || finalOutputs.result || finalOutputs.markdown || '';

            // 提取结构化 SKU 数据
            const skuJsonStr = finalOutputs.sku_json || finalOutputs.sku_data || '';
            if (skuJsonStr) {
                try {
                    skuList = JSON.parse(typeof skuJsonStr === 'string' ? skuJsonStr : JSON.stringify(skuJsonStr));
                } catch (e) {
                    console.warn('[商品库录入] sku_json 解析失败', e);
                }
            }

            // 清理进度
            if (workflowRunId) workflowProgress.delete(`sheet_${workflowRunId}`);
            res.json({ success: true, data: markdownText, skuList, fileId, fileName });
        } catch (parseError) {
            console.error('[商品库录入] 结果解析失败', parseError);
            res.json({ success: true, data: '', skuList: [], fileId, fileName });
        }
    } catch (e) {
        console.error('[商品库录入确认Sheet失败]', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// 4. 商品库录入 - 调用解析工作流
app.post('/api/product-entry/parse', authenticateToken, async (req, res) => {
    try {
        const { fileIds, fileNames, supplier } = req.body;
        logAudit(req, { module: 'PRODUCT_ENTRY', action: 'PARSE', details: { fileIds, fileNames, supplier } });

        if (!fileIds || fileIds.length === 0) {
            return res.status(400).json({ success: false, message: '必须提供至少一个文件ID' });
        }

        const apiKey = process.env.DIFY_PRODUCT_ENTRY_API_KEY;
        let apiUrl = process.env.DIFY_PRODUCT_ENTRY_API_URL;
        if (apiUrl && !apiUrl.endsWith('/v1')) {
            apiUrl = `${apiUrl.replace(/\/$/, '')}/v1`;
        }

        if (!apiKey || !apiUrl) {
            return res.status(500).json({ success: false, message: '服务端未配置 DIFY_PRODUCT_ENTRY_API_KEY' });
        }

        // 构造文件引用对象（单个文件）
        const fileRef = {
            type: 'document',
            transfer_method: 'local_file',
            upload_file_id: fileIds[0]
        };

        // 构造 inputs，supplier 为可选参数
        const inputs = {
            product_file: fileRef
        };
        if (supplier && supplier.trim()) {
            inputs.supplier = supplier.trim();
        }

        const payload = {
            inputs,
            response_mode: 'blocking',
            user: req.user?.username || 'web_os_user'
        };

        const difyRes = await fetch(`${apiUrl}/workflows/run`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        // 流式读取响应，避免大响应截断
        const chunks = [];
        const reader = difyRes.body;
        if (reader) {
            const streamReader = reader[Symbol.asyncIterator] ? reader : difyRes.body;
            for await (const chunk of streamReader) {
                chunks.push(Buffer.from(chunk));
            }
        }
        const resText = Buffer.concat(chunks).toString('utf-8');

        if (!difyRes.ok) {
            console.error(`[Dify 商品库解析工作流报错] 状态码: ${difyRes.status}, 响应: ${resText.substring(0, 500)}`);
            throw new Error(`Dify 工作流调用报错 (${difyRes.status}): ${resText.substring(0, 300)}`);
        }

        try {
            const bodyData = JSON.parse(resText);
            let markdownText = '';
            let skuList = [];

            const rawOutputs = bodyData?.data?.outputs || bodyData?.data || bodyData;

            if (rawOutputs && typeof rawOutputs === 'object') {
                // 提取 Markdown 文本
                markdownText = rawOutputs.text || rawOutputs.result || rawOutputs.markdown || '';
                if (!markdownText && rawOutputs.outputs) {
                    markdownText = rawOutputs.outputs.text || rawOutputs.outputs.result || '';
                }

                // 提取结构化 SKU 数据（如果 Dify 工作流输出了 sku_json）
                const skuJsonStr = rawOutputs.sku_json || rawOutputs.sku_data || '';
                if (skuJsonStr) {
                    try {
                        skuList = JSON.parse(typeof skuJsonStr === 'string' ? skuJsonStr : JSON.stringify(skuJsonStr));
                    } catch (e) {
                        console.warn('[商品库录入] sku_json 解析失败', e);
                    }
                }
            } else if (typeof rawOutputs === 'string') {
                markdownText = rawOutputs;
            }

            res.json({ success: true, data: markdownText, skuList, fileIds, fileNames });
        } catch (parseError) {
            console.error('[商品库录入] Dify 响应解析失败', parseError);
            res.json({ success: true, data: resText.substring(0, 2000), skuList: [], fileIds, fileNames });
        }
    } catch (e) {
        console.error('[商品库录入解析失败]', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// 商品库录入 - 工作流进度跟踪（内存存储）
const workflowProgress = new Map();

// 6. 商品库录入 - 获取工作流进度
app.get('/api/product-entry/confirm-progress/:workflowRunId', authenticateToken, async (req, res) => {
    try {
        const { workflowRunId } = req.params;
        const progress = workflowProgress.get(workflowRunId);
        if (progress) {
            res.json({ success: true, progress });
        } else {
            res.json({ success: true, progress: '' });
        }
    } catch (e) {
        res.json({ success: true, progress: '' });
    }
});

// 商品库录入 - 获取解析进度（用 fileId 跟踪）
app.get('/api/product-entry/parse-progress/:fileId', authenticateToken, async (req, res) => {
    try {
        const { fileId } = req.params;
        const progress = workflowProgress.get(`parse_${fileId}`);
        if (progress) {
            res.json({ success: true, progress });
        } else {
            res.json({ success: true, progress: '' });
        }
    } catch (e) {
        res.json({ success: true, progress: '' });
    }
});

// 商品库录入 - 获取 Sheet 确认进度（用 workflowRunId 跟踪）
app.get('/api/product-entry/sheet-progress/:workflowRunId', authenticateToken, async (req, res) => {
    try {
        const { workflowRunId } = req.params;
        const progress = workflowProgress.get(`sheet_${workflowRunId}`);
        if (progress) {
            res.json({ success: true, progress });
        } else {
            res.json({ success: true, progress: '' });
        }
    } catch (e) {
        res.json({ success: true, progress: '' });
    }
});

// 5. 商品库录入 - 确认录入工作流（提交第二个人工介入表单）
app.post('/api/product-entry/confirm', authenticateToken, async (req, res) => {
    try {
        const { fileIds, fileNames, skuData, parseResult, supplier, formToken, workflowRunId } = req.body;
        logAudit(req, { module: 'PRODUCT_ENTRY', action: 'CONFIRM', details: { fileIds, fileNames, skuCount: skuData?.skus?.length, spuCount: skuData?.spu_groups?.length, supplier, formToken, workflowRunId } });

        if (!skuData) {
            return res.status(400).json({ success: false, message: '必须提供 SKU 数据' });
        }

        const apiKey = process.env.DIFY_PRODUCT_ENTRY_API_KEY;
        let apiUrl = process.env.DIFY_PRODUCT_ENTRY_API_URL;
        if (apiUrl && !apiUrl.endsWith('/v1')) {
            apiUrl = `${apiUrl.replace(/\/$/, '')}/v1`;
        }

        if (!apiKey || !apiUrl) {
            return res.status(500).json({ success: false, message: '服务端未配置 DIFY_PRODUCT_ENTRY_API_KEY' });
        }

        const userName = req.user?.username || 'web_os_user';

        // 如果有 formToken，说明是恢复暂停的工作流（提交第二个人工介入表单）
        if (formToken) {
            // 使用前端已转换的中文格式 product_groups，回退到旧格式
            const productGroups = skuData.product_groups || null;

            // 先获取表单定义，确定正确的 action 和 input 变量名
            const formDefRes = await fetch(`${apiUrl}/form/human_input/${formToken}`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });

            let submitAction = 'merge';
            let inputVarName = 'merge_product_list';

            if (formDefRes.ok) {
                const formDef = await formDefRes.json();

                const userActions = formDef?.user_actions;
                if (Array.isArray(userActions) && userActions.length > 0) {
                    submitAction = userActions[0].id || userActions[0].action || userActions[0].name || 'merge';
                }
                const inputs = formDef?.inputs;
                if (Array.isArray(inputs) && inputs.length > 0) {
                    inputVarName = inputs[0].output_variable_name || inputs[0].variable || inputs[0].name || 'merge_product_list';
                }
            }

            const submitData = productGroups || skuData.spu_groups.map(group => ({
                spu_name: group.spu_name,
                skus: group.sku_rows.map(rowNum => skuData.skus.find(s => s.row === rowNum) || {})
            }));

            const submitPayload = {
                inputs: {
                    [inputVarName]: JSON.stringify(submitData, null, 2)
                },
                action: submitAction,
                user: userName
            };

            const difyRes = await fetch(`${apiUrl}/form/human_input/${formToken}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(submitPayload)
            });

            const chunks = [];
            const reader = difyRes.body;
            if (reader) {
                const streamReader = reader[Symbol.asyncIterator] ? reader : difyRes.body;
                for await (const chunk of streamReader) {
                    chunks.push(Buffer.from(chunk));
                }
            }
            const resText = Buffer.concat(chunks).toString('utf-8');

            if (!difyRes.ok) {
                console.error(`[Dify 商品库提交表单报错] 状态码: ${difyRes.status}, 响应: ${resText.substring(0, 500)}`);
                throw new Error(`Dify 表单提交报错 (${difyRes.status}): ${resText.substring(0, 300)}`);
            }

            // 通过 SSE 事件流等待工作流完成
            let finalOutputs = {};
            let pausedAtCompletion = null; // 如果在第三步人工介入暂停
            let taskId = null;  // 用于停止工作流
            let workflowDone = false;  // 标记是否收到终止事件
            const eventsUrl = `${apiUrl}/workflow/${workflowRunId}/events?user=${encodeURIComponent(userName)}&continue_on_pause=true`;

            try {
                const eventsRes = await fetch(eventsUrl, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Accept': 'text/event-stream'
                    }
                });

                if (!eventsRes.ok) {
                    const errText = await eventsRes.text();
                    console.error(`[商品库录入] SSE 连接失败: ${errText.substring(0, 300)}`);
                } else {
                    const sseReader = eventsRes.body.getReader();
                    const decoder = new TextDecoder();
                    let buffer = '';
                    const streamTimeout = 1200000;
                    const streamStart = Date.now();

                    while (Date.now() - streamStart < streamTimeout) {
                        const { done, value } = await sseReader.read();
                        if (done) break;

                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop();

                        for (const line of lines) {
                            if (!line.startsWith('data: ')) continue;
                            const jsonStr = line.slice(6).trim();
                            if (!jsonStr) continue;
                            try {
                                const event = JSON.parse(jsonStr);
                                const eventType = event?.event;
                                if (!['node_started','node_finished','iteration_started','iteration_next','iteration_completed'].includes(eventType)) {
                                    // SSE 事件日志已精简
                                }

                                // 捕获 task_id（用于停止工作流）— task_id 在事件顶层
                                if (!taskId && event?.task_id) {
                                    taskId = event.task_id;
                                }

                                // 更新进度信息
                                if (eventType === 'node_started') {
                                    const nodeTitle = event?.data?.title || '';
                                    if (nodeTitle && workflowRunId) {
                                        workflowProgress.set(workflowRunId, `正在执行: ${nodeTitle}`);
                                    }
                                } else if (eventType === 'node_finished') {
                                    const nodeTitle = event?.data?.title || '';
                                    if (nodeTitle && workflowRunId) {
                                        workflowProgress.set(workflowRunId, `已完成: ${nodeTitle}`);
                                    }
                                }

                                if (eventType === 'human_input_required') {
                                    // 检测到第三步人工介入（补全信息）
                                    const completionFormToken = event?.data?.form_token || event?.form_token;
                                    if (completionFormToken) {
                                        try {
                                            const formDefUrl = `${apiUrl}/form/human_input/${completionFormToken}`;
                                            const formDefRes = await fetch(formDefUrl, {
                                                method: 'GET',
                                                headers: { 'Authorization': `Bearer ${apiKey}` }
                                            });
                                            const formDefRaw = await formDefRes.text();

                                            if (formDefRes.ok) {
                                                const formDef = JSON.parse(formDefRaw);
                                                const formContent = formDef?.form_content;

                                                let completionList = [];
                                                if (formContent && typeof formContent === 'string') {
                                                    const jsonMatch = formContent.match(/^\s*(\[[\s\S]*\])/);
                                                    if (jsonMatch) {
                                                        try {
                                                            completionList = JSON.parse(jsonMatch[1]);
                                                        } catch (jsonErr) {
                                                            console.error(`[商品库录入] JSON 解析失败: ${jsonErr.message}`);
                                                        }
                                                    }
                                                }
                                                pausedAtCompletion = {
                                                    formToken: completionFormToken,
                                                    workflowRunId,
                                                    completionList: Array.isArray(completionList) ? completionList : []
                                                };
                                                console.log(`[商品库录入] 人工介入: 补全信息数据项=${pausedAtCompletion.completionList.length}`);
                                            } else {
                                                console.error(`[商品库录入] 表单定义请求失败: 状态码=${formDefRes.status}`);
                                            }
                                        } catch (formErr) {
                                            console.warn(`[商品库录入] 获取补全信息表单定义失败: ${formErr.message}`);
                                            pausedAtCompletion = { formToken: completionFormToken, workflowRunId, completionList: [] };
                                        }
                                    }
                                    break;
                                } else if (eventType === 'workflow_finished') {
                                    finalOutputs = event?.data?.outputs || {};
                                    // 检查 workflow_finished 中是否包含错误信息
                                    const wfError = event?.data?.error || event?.data?.status;
                                    if (wfError && wfError !== 'succeeded' && wfError !== 'finished') {
                                        const errMsg = event?.data?.error || `工作流异常结束，状态: ${wfError}`;
                                        // 用户主动停止，不视为错误
                                        if (isUserStop(errMsg)) {
                                            console.log(`[商品库录入] 工作流已被用户停止`);
                                            workflowDone = true;
                                            break;
                                        }
                                        console.error(`[商品库录入] 工作流完成但包含错误: ${errMsg}`);
                                        throw new Error(`工作流执行失败: ${errMsg}`);
                                    }
                                    console.log(`[商品库录入] 工作流完成`);
                                    workflowDone = true;
                                    break;
                                } else if (eventType === 'workflow_failed' || eventType === 'error') {
                                    const errMsg = event?.data?.error || event?.message || '未知错误';
                                    // 用户主动停止，不视为错误
                                    if (isUserStop(errMsg)) {
                                        console.log(`[商品库录入] 工作流已被用户停止`);
                                        workflowDone = true;
                                        break;
                                    }
                                    console.error(`[商品库录入] 工作流失败: ${errMsg}`);
                                    throw new Error(`工作流执行失败: ${errMsg}`);
                                }
                            } catch (parseErr) {
                                if (parseErr.message?.includes('工作流执行失败')) throw parseErr;
                                console.warn(`[商品库录入] SSE 事件解析失败: ${parseErr.message}`);
                            }
                        }
                        if (workflowDone || pausedAtCompletion) break;
                    }
                    try { sseReader.cancel(); } catch (_) {}
                }
            } catch (sseErr) {
                // SSE 连接终止是正常行为（工作流暂停时），只在真正异常时打印错误
                if (sseErr.message?.includes('terminated')) {
                    console.log(`[商品库录入] SSE 事件流已终止: ${sseErr.message}`);
                } else {
                    console.error(`[商品库录入] SSE 事件流异常: ${sseErr.message}`);
                }

                // SSE 断开后，持续重连等待（工作流可能还在执行）
                if (!pausedAtCompletion && !workflowDone && Object.keys(finalOutputs).length === 0) {
                    const maxReconnectAttempts = 10;  // 最多重连 10 次
                    const reconnectWaitMs = 5000;     // 每次间隔 5 秒
                    
                    for (let reconnectAttempt = 1; reconnectAttempt <= maxReconnectAttempts; reconnectAttempt++) {
                        await new Promise(resolve => setTimeout(resolve, reconnectWaitMs));
                        
                        try {
                            const reconnectRes = await fetch(eventsUrl, {
                                method: 'GET',
                                headers: {
                                    'Authorization': `Bearer ${apiKey}`,
                                    'Accept': 'text/event-stream'
                                }
                            });
                            if (!reconnectRes.ok) continue;
                            
                            const reconnectReader = reconnectRes.body.getReader();
                            const decoder = new TextDecoder();
                            let buffer = '';
                            const readTimeout = 60000;  // 每次读取等待 60 秒
                            const readStart = Date.now();
                            
                            while (Date.now() - readStart < readTimeout) {
                                const { done, value } = await reconnectReader.read();
                                if (done) break;
                                buffer += decoder.decode(value, { stream: true });
                                const lines = buffer.split('\n');
                                buffer = lines.pop();
                                
                                for (const line of lines) {
                                    if (!line.startsWith('data: ')) continue;
                                    const jsonStr = line.slice(6).trim();
                                    if (!jsonStr) continue;
                                    try {
                                        const event = JSON.parse(jsonStr);
                                        const eventType = event?.event;
                                        
                                        // 更新进度信息
                                        if (eventType === 'node_started') {
                                            const nodeTitle = event?.data?.title || '';
                                            if (nodeTitle && workflowRunId) {
                                                workflowProgress.set(workflowRunId, `正在执行: ${nodeTitle}`);
                                            }
                                        } else if (eventType === 'node_finished') {
                                            const nodeTitle = event?.data?.title || '';
                                            if (nodeTitle && workflowRunId) {
                                                workflowProgress.set(workflowRunId, `已完成: ${nodeTitle}`);
                                            }
                                        }
                                        
                                        if (eventType === 'human_input_required') {
                                            const completionFormToken = event?.data?.form_token || event?.form_token;
                                            if (completionFormToken) {
                                                const formDefRes = await fetch(`${apiUrl}/form/human_input/${completionFormToken}`, {
                                                    method: 'GET', headers: { 'Authorization': `Bearer ${apiKey}` }
                                                });
                                                if (formDefRes.ok) {
                                                    const formDef = await formDefRes.json();
                                                    const formContent = formDef?.form_content;
                                                    let completionList = [];
                                                    if (formContent && typeof formContent === 'string') {
                                                        const jsonMatch = formContent.match(/^\s*(\[[\s\S]*\])/);
                                                        if (jsonMatch) { try { completionList = JSON.parse(jsonMatch[1]); } catch (_) {} }
                                                    }
                                                    pausedAtCompletion = { formToken: completionFormToken, workflowRunId, completionList };
                                                }
                                            }
                                            break;
                                        } else if (eventType === 'workflow_finished') {
                                            finalOutputs = event?.data?.outputs || {};
                                            const wfError2 = event?.data?.error || event?.data?.status;
                                            if (wfError2 && wfError2 !== 'succeeded' && wfError2 !== 'finished') {
                                                const errMsg = event?.data?.error || `状态: ${wfError2}`;
                                                // 用户主动停止，不视为错误
                                                if (isUserStop(errMsg)) {
                                                    workflowDone = true;
                                                    break;
                                                }
                                                throw new Error(`工作流执行失败: ${errMsg}`);
                                            }
                                            workflowDone = true;
                                            break;
                                        } else if (eventType === 'workflow_failed' || eventType === 'error') {
                                            const errMsg = event?.data?.error || event?.message || '未知错误';
                                            // 用户主动停止，不视为错误
                                            if (isUserStop(errMsg)) {
                                                workflowDone = true;
                                                break;
                                            }
                                            throw new Error(`工作流执行失败: ${errMsg}`);
                                        }
                                    } catch (parseErr) {
                                        if (parseErr.message?.includes('工作流执行失败')) throw parseErr;
                                    }
                                }
                                if (workflowDone || pausedAtCompletion) break;
                            }
                            try { reconnectReader.cancel(); } catch (_) {}
                            if (workflowDone || pausedAtCompletion) break;
                        } catch (reconnectErr) {
                            console.error(`[商品库录入] 重连异常: ${reconnectErr.message}`);
                        }
                    }
                }
            }

            // 如果工作流在第三步人工介入暂停（补全信息）
            if (pausedAtCompletion) {
                workflowProgress.delete(workflowRunId);  // 清理进度
                res.json({
                    success: true,
                    paused: true,
                    completionFormToken: pausedAtCompletion.formToken,
                    completionWorkflowRunId: pausedAtCompletion.workflowRunId,
                    completionTaskId: taskId,  // 用于停止工作流
                    completionList: pausedAtCompletion.completionList
                });
                return;
            }

            // 清理进度
            workflowProgress.delete(workflowRunId);

            // 检查是否成功获取结果
            console.log(`[商品库录入] 确认录入结果检查: finalOutputs=${Object.keys(finalOutputs).length}, workflowDone=${workflowDone}`);
            if (Object.keys(finalOutputs).length === 0 && !workflowDone) {
                throw new Error('工作流执行失败，未获取到结果，请稍后重试');
            }

            // 提取结果
            let confirmResult = finalOutputs.text || finalOutputs.result || finalOutputs.markdown || JSON.stringify(finalOutputs, null, 2);

            // 保存历史记录
            const skuCount = skuData?.skus?.length || 0;
            const spuCount = skuData?.spu_groups?.length || 0;
            await pool.query(
                `INSERT INTO product_entry_history (file_names, parse_result, confirm_result, sku_count, spu_count, status, username)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [(fileNames || []).join(', '), parseResult || '', confirmResult, skuCount, spuCount, 'confirmed', userName]
            );

            res.json({ success: true, data: confirmResult });
            return;
        }

        // 没有 formToken，回退到启动新工作流（兼容旧逻辑）
        console.log(`[商品库录入] 无 formToken，启动新工作流...`);

        const fileRef = {
            type: 'document',
            transfer_method: 'local_file',
            upload_file_id: fileIds?.[0]
        };

        const inputs = {
            product_file: fileRef,
            sku_data: JSON.stringify(skuData)
        };
        if (supplier && supplier.trim()) {
            inputs.supplier = supplier.trim();
        }

        const payload = {
            inputs,
            response_mode: 'blocking',
            user: userName
        };

        const difyRes = await fetch(`${apiUrl}/workflows/run`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const chunks = [];
        const reader = difyRes.body;
        if (reader) {
            const streamReader = reader[Symbol.asyncIterator] ? reader : difyRes.body;
            for await (const chunk of streamReader) {
                chunks.push(Buffer.from(chunk));
            }
        }
        const resText = Buffer.concat(chunks).toString('utf-8');

        if (!difyRes.ok) {
            console.error(`[Dify 商品库录入工作流报错] 状态码: ${difyRes.status}, 响应: ${resText.substring(0, 500)}`);
            throw new Error(`Dify 工作流调用报错 (${difyRes.status}): ${resText.substring(0, 300)}`);
        }

        let confirmResult = '';
        try {
            const bodyData = JSON.parse(resText);
            const rawOutputs = bodyData?.data?.outputs || bodyData?.data || bodyData;
            if (rawOutputs && typeof rawOutputs === 'object') {
                confirmResult = rawOutputs.text || rawOutputs.result || rawOutputs.markdown || JSON.stringify(rawOutputs, null, 2);
            } else if (typeof rawOutputs === 'string') {
                confirmResult = rawOutputs;
            }
        } catch {
            confirmResult = resText.substring(0, 2000);
        }

        // 保存历史记录
        const skuCount = skuData?.skus?.length || 0;
        const spuCount = skuData?.spu_groups?.length || 0;
        await pool.query(
            `INSERT INTO product_entry_history (file_names, parse_result, confirm_result, sku_count, spu_count, status, username)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [(fileNames || []).join(', '), parseResult || '', confirmResult, skuCount, spuCount, 'confirmed', userName]
        );

        res.json({ success: true, data: confirmResult });
    } catch (e) {
        console.error('[商品库录入确认失败]', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// 6. 商品库录入 - 获取补全信息列表（调用 Dify 工作流）
app.post('/api/product-entry/completion-info', authenticateToken, async (req, res) => {
    try {
        const { formToken, workflowRunId } = req.body;

        if (!formToken) {
            return res.status(400).json({ success: false, message: '缺少 formToken' });
        }

        const apiKey = process.env.DIFY_PRODUCT_ENTRY_API_KEY;
        let apiUrl = process.env.DIFY_PRODUCT_ENTRY_API_URL;
        if (apiUrl && !apiUrl.endsWith('/v1')) {
            apiUrl = `${apiUrl.replace(/\/$/, '')}/v1`;
        }

        if (!apiKey || !apiUrl) {
            return res.status(500).json({ success: false, message: '服务端未配置 DIFY_PRODUCT_ENTRY_API_KEY' });
        }

        // 获取表单定义，提取补全信息
        const formDefRes = await fetch(`${apiUrl}/form/human_input/${formToken}`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });

        if (!formDefRes.ok) {
            const errText = await formDefRes.text();
            console.error(`[商品库录入] 获取补全信息表单失败: ${errText.substring(0, 300)}`);
            throw new Error(`获取补全信息表单失败 (${formDefRes.status})`);
        }

        const formDef = await formDefRes.json();
        const formContent = formDef?.form_content;
        let completionList = [];

        if (formContent && typeof formContent === 'string') {
            const jsonMatch = formContent.match(/^\s*(\[[\s\S]*\])/);
            if (jsonMatch) {
                try {
                    completionList = JSON.parse(jsonMatch[1]);
                } catch (e) {
                    console.warn(`[商品库录入] 补全信息 form_content JSON 解析失败: ${e.message}`);
                    completionList = [];
                }
            }
        }

        res.json({
            success: true,
            paused: true,
            formToken,
            workflowRunId,
            completionList: Array.isArray(completionList) ? completionList : []
        });
    } catch (e) {
        console.error('[商品库录入获取补全信息失败]', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// 7. 商品库录入 - 确认补全信息选择（恢复 Dify 人工介入工作流）
app.post('/api/product-entry/confirm-completion', authenticateToken, async (req, res) => {
    try {
        const { formToken, workflowRunId, completionList, fileNames } = req.body;

        if (!formToken) {
            return res.status(400).json({ success: false, message: '缺少 formToken' });
        }

        const apiKey = process.env.DIFY_PRODUCT_ENTRY_API_KEY;
        let apiUrl = process.env.DIFY_PRODUCT_ENTRY_API_URL;
        if (apiUrl && !apiUrl.endsWith('/v1')) {
            apiUrl = `${apiUrl.replace(/\/$/, '')}/v1`;
        }

        if (!apiKey || !apiUrl) {
            return res.status(500).json({ success: false, message: '服务端未配置 DIFY_PRODUCT_ENTRY_API_KEY' });
        }

        const userName = req.user?.username || 'web_os_user';

        // 先获取表单定义，确定正确的 action 和 input 变量名
        const formDefRes = await fetch(`${apiUrl}/form/human_input/${formToken}`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });

        let submitAction = 'submit';
        let inputVarName = 'completion_info';

        if (formDefRes.ok) {
            const formDef = await formDefRes.json();

            const userActions = formDef?.user_actions;
            if (Array.isArray(userActions) && userActions.length > 0) {
                submitAction = userActions[0].id || userActions[0].action || userActions[0].name || 'submit';
            }

            const inputs = formDef?.inputs;
            if (Array.isArray(inputs) && inputs.length > 0) {
                inputVarName = inputs[0].output_variable_name || inputs[0].variable || inputs[0].name || 'completion_info';
            }
        } else {
            console.warn(`[商品库录入] 获取补全表单定义失败: ${formDefRes.status}`);
        }

        const submitPayload = {
            inputs: {
                [inputVarName]: JSON.stringify(completionList || [], null, 2)
            },
            action: submitAction,
            user: userName
        };

        const difyRes = await fetch(`${apiUrl}/form/human_input/${formToken}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(submitPayload)
        });

        const chunks = [];
        const reader = difyRes.body;
        if (reader) {
            const streamReader = reader[Symbol.asyncIterator] ? reader : difyRes.body;
            for await (const chunk of streamReader) {
                chunks.push(Buffer.from(chunk));
            }
        }
        const resText = Buffer.concat(chunks).toString('utf-8');

        if (!difyRes.ok) {
            console.error(`[Dify 商品库补全信息提交报错] 状态码: ${difyRes.status}, 响应: ${resText.substring(0, 500)}`);
            throw new Error(`Dify 补全信息提交报错 (${difyRes.status}): ${resText.substring(0, 300)}`);
        }

        // 通过 SSE 事件流等待工作流完成
        let finalOutputs = {};
        let workflowDone = false;  // 标记是否收到终止事件
        const eventsUrl = `${apiUrl}/workflow/${workflowRunId}/events?user=${encodeURIComponent(userName)}`;

        try {
            const eventsRes = await fetch(eventsUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Accept': 'text/event-stream'
                }
            });

            if (!eventsRes.ok) {
                const errText = await eventsRes.text();
                console.error(`[商品库录入] SSE 事件流错误: ${errText.substring(0, 300)}`);
            } else {
                const sseReader = eventsRes.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                const streamTimeout = 1200000;
                const streamStart = Date.now();

                while (Date.now() - streamStart < streamTimeout) {
                    const { done, value } = await sseReader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop();

                    for (const line of lines) {
                        if (!line.startsWith('data: ')) continue;
                        const jsonStr = line.slice(6).trim();
                        if (!jsonStr) continue;
                        try {
                            const event = JSON.parse(jsonStr);
                            const eventType = event?.event;
                            if (!['node_started','node_finished','iteration_started','iteration_next','iteration_completed'].includes(eventType)) {
                                // SSE 事件日志已精简
                            }

                            if (eventType === 'workflow_finished') {
                                finalOutputs = event?.data?.outputs || {};
                                // 检查 workflow_finished 中是否包含错误信息
                                const wfError = event?.data?.error || event?.data?.status;
                                if (wfError && wfError !== 'succeeded' && wfError !== 'finished') {
                                    const errMsg = event?.data?.error || `工作流异常结束，状态: ${wfError}`;
                                    // 用户主动停止，不视为错误
                                    if (isUserStop(errMsg)) {
                                        console.log(`[商品库录入] 工作流已被用户停止`);
                                        workflowDone = true;
                                        break;
                                    }
                                    console.error(`[商品库录入] 工作流完成但包含错误: ${errMsg}`);
                                    throw new Error(`工作流执行失败: ${errMsg}`);
                                }
                                console.log(`[商品库录入] 工作流完成`);
                                workflowDone = true;
                                break;
                            } else if (eventType === 'workflow_failed' || eventType === 'error') {
                                const errMsg = event?.data?.error || event?.message || '未知错误';
                                // 用户主动停止，不视为错误
                                if (isUserStop(errMsg)) {
                                    console.log(`[商品库录入] 工作流已被用户停止`);
                                    workflowDone = true;
                                    break;
                                }
                                console.error(`[商品库录入] 工作流失败: ${errMsg}`);
                                throw new Error(`工作流执行失败: ${errMsg}`);
                            }
                        } catch (parseErr) {
                            if (parseErr.message?.includes('工作流执行失败')) throw parseErr;
                        }
                    }
                    if (workflowDone) break;
                }
                try { sseReader.cancel(); } catch (_) {}
            }
        } catch (sseErr) {
            console.warn(`[商品库录入] SSE 事件流断开: ${sseErr.message}，切换到轮询模式`);
        }

        // SSE 未拿到结果且工作流未结束，回退到轮询
        if (Object.keys(finalOutputs).length === 0 && !workflowDone) {
            const pollEndpoint = `${apiUrl}/workflows/run/${workflowRunId}`;
            // 先等 3 秒让工作流有时间执行
            await new Promise(resolve => setTimeout(resolve, 3000));
            for (let attempt = 1; attempt <= 20; attempt++) {
                try {
                    const pollRes = await fetch(pollEndpoint, {
                        method: 'GET',
                        headers: { 'Authorization': `Bearer ${apiKey}` }
                    });
                    if (!pollRes.ok) {
                        await new Promise(resolve => setTimeout(resolve, 3000));
                        continue;
                    }
                    const data = await pollRes.json();
                    const status = data?.status;
                    if (status === 'succeeded' || status === 'finished') {
                        finalOutputs = data?.outputs || {};
                        workflowDone = true;
                        break;
                    } else if (status === 'failed') {
                        throw new Error(`工作流执行失败: ${data?.error || '未知错误'}`);
                    } else if (status === 'stopped') {
                        console.log(`[商品库录入] 工作流已被停止`);
                        workflowDone = true;
                        break;
                    }
                    // 还在运行中，继续等待
                } catch (e) {
                    if (e.message?.includes('工作流执行失败')) throw e;
                    console.warn(`[商品库录入] 轮询异常: ${e.message}`);
                }
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }

        // 检查是否成功获取结果
        console.log(`[商品库录入] 工作流结果检查: finalOutputs=${Object.keys(finalOutputs).length}, workflowDone=${workflowDone}`);
        if (Object.keys(finalOutputs).length === 0 && !workflowDone) {
            throw new Error('工作流执行失败，未获取到结果，请稍后重试');
        }
        
        // 提取结果
        let confirmResult = '';
        // 清理进度缓存
        workflowProgress.delete(workflowRunId);
        if (Object.keys(finalOutputs).length > 0) {
            confirmResult = finalOutputs.text || finalOutputs.result || finalOutputs.markdown || JSON.stringify(finalOutputs, null, 2);
        } else {
            confirmResult = JSON.stringify({ status: '补全信息已提交', completion_count: completionList?.length || 0 }, null, 2);
        }

        // 保存历史记录
        await pool.query(
            `INSERT INTO product_entry_history (file_names, parse_result, confirm_result, sku_count, spu_count, status, username)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [(fileNames || []).join(', ') || '', '', confirmResult, completionList?.length || 0, 0, 'confirmed', userName]
        );

        res.json({ success: true, data: confirmResult });
    } catch (e) {
        console.error('[商品库录入确认补全信息失败]', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// 7.5 商品库录入 - 停止工作流任务
app.post('/api/product-entry/stop-workflow', authenticateToken, async (req, res) => {
    try {
        const { taskId, workflowRunId } = req.body;
        // 优先使用 task_id，回退 workflow_run_id
        const stopId = taskId || workflowRunId;
        if (!stopId) {
            return res.json({ success: true, message: '无任务ID，跳过' });
        }

        const apiKey = process.env.DIFY_PRODUCT_ENTRY_API_KEY;
        let apiUrl = process.env.DIFY_PRODUCT_ENTRY_API_URL;
        if (apiUrl && !apiUrl.endsWith('/v1')) {
            apiUrl = `${apiUrl.replace(/\/$/, '')}/v1`;
        }
        if (!apiKey || !apiUrl) {
            return res.status(500).json({ success: false, message: '未配置 DIFY API' });
        }

        const userName = req.user?.username || 'web_os_user';
        // Dify 停止工作流端点: POST /v1/workflows/tasks/{task_id}/stop
        const stopUrl = `${apiUrl}/workflows/tasks/${stopId}/stop`;
        console.log(`[商品库录入] 停止工作流任务: ${stopId} (type=${taskId ? 'task_id' : 'workflow_run_id'}), URL: ${stopUrl}`);

        const stopRes = await fetch(stopUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ user: userName })
        });

        const resText = await stopRes.text();

        if (stopRes.ok) {
            res.json({ success: true });
        } else {
            console.warn(`[商品库录入] 停止工作流失败 (${stopRes.status}): ${resText.substring(0, 300)}`);
            res.json({ success: false, message: `停止失败 (${stopRes.status})`, detail: resText.substring(0, 300) });
        }
    } catch (e) {
        console.warn(`[商品库录入] 停止工作流异常: ${e.message}`);
        res.json({ success: false, message: '停止请求异常', error: e.message });
    }
});

// 8. 商品库录入 - 获取历史记录
app.get('/api/product-entry/history', authenticateToken, async (req, res) => {
    try {
        const username = req.user.username;
        const result = await pool.query(
            'SELECT id, file_names, parse_result, confirm_result, sku_count, spu_count, status, created_at, username FROM product_entry_history WHERE username = $1 ORDER BY created_at DESC LIMIT 20',
            [username]
        );
        res.json({ success: true, data: result.rows });
    } catch (e) {
        console.error('[商品库录入历史查询失败]', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// 9. 商品库录入 - 删除历史记录
app.delete('/api/product-entry/history/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const username = req.user.username;
        // 只能删除自己的记录
        const result = await pool.query('DELETE FROM product_entry_history WHERE id = $1 AND username = $2', [id, username]);
        if (result.rowCount === 0) {
            return res.status(403).json({ success: false, message: '无权删除该记录' });
        }
        res.json({ success: true, message: '删除成功' });
    } catch (e) {
        console.error('[商品库录入历史删除失败]', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ====================== 电商广告法合规检测整合 ======================

app.post('/api/risk-detection/ecommerce/upload', authenticateToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: '未找到文件数据' });
        }
        logAudit(req, { module: 'RISK_DETECTION', action: 'ECOM_UPLOAD_FILE', target_data: fixUploadedFileName(req.file.originalname) });

        const apiKey = process.env.DIFY_ECOM_RISK_API_KEY;
        let apiUrl = process.env.DIFY_ECOM_RISK_API_URL;
        if (apiUrl && !apiUrl.endsWith('/v1')) apiUrl = `${apiUrl.replace(/\/$/, '')}/v1`;

        if (!apiKey || !apiUrl) {
            return res.status(500).json({ success: false, message: '系统未配置 DIFY_ECOM_RISK_API_KEY' });
        }

        const formData = new FormData();
        const fileContent = fs.readFileSync(req.file.path);
        const { Blob: NodeBlob } = await import('buffer');
        const blob = new NodeBlob([fileContent], { type: req.file.mimetype });
        formData.append('file', blob, req.file.originalname);
        formData.append('user', req.user?.username || 'web_os_user');

        const difyRes = await fetch(`${apiUrl}/files/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}` },
            body: formData
        });

        const resText = await difyRes.text();
        if (!difyRes.ok) throw new Error(`Dify 文件上传报错 (${difyRes.status}): ${resText.substring(0, 200)}`);

        const data = JSON.parse(resText);
        res.json({ success: true, file_id: data.id });
    } catch (e) {
        console.error('[电商风控图片上传失败]', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/risk-detection/ecommerce/run', authenticateToken, async (req, res) => {
    try {
        const { country, industry, detectionType, title, description, fileId } = req.body;
        logAudit(req, { module: 'RISK_DETECTION', action: 'RUN_ECOM_RISK', details: { country, industry, detectionType, titleLength: title?.length, hasFile: !!fileId } });

        const apiKey = process.env.DIFY_ECOM_RISK_API_KEY;
        let apiUrl = process.env.DIFY_ECOM_RISK_API_URL;
        if (apiUrl && !apiUrl.endsWith('/v1')) apiUrl = `${apiUrl.replace(/\/$/, '')}/v1`;

        if (!apiKey || !apiUrl) return res.status(500).json({ success: false, message: '系统未配置电商风险检测 API' });

        const inputs = {
            country: country || '',
            industry: industry || '',
        };

        if (detectionType === 'text') {
            inputs.title = title || '';
            inputs.description = description || '';
        }

        const payload = {
            inputs,
            response_mode: 'blocking',
            user: req.user?.username || 'web_os_user'
        };

        if (detectionType === 'image' && fileId) {
            payload.files = [{
                type: 'image',
                transfer_method: 'local_file',
                upload_file_id: fileId
            }];
        }

        let endpoint = `${apiUrl}/chat-messages`;
        payload.query = inputs.title ? `检测标题：${inputs.title}\n描述：${inputs.description}` : (inputs.description || '请开始执行合规风险检测任务。');

        const difyRes = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const resText = await difyRes.text();

        if (!difyRes.ok) throw new Error(`电商风控大模型调用失败 (${difyRes.status}): ${resText.substring(0, 200)}`);

        const bodyData = JSON.parse(resText);
        let rawReport = '';

        // 兼容 chat 和 completion 模式的返回
        if (bodyData.answer) {
            rawReport = bodyData.answer;
        } else {
            // 兼容 workflows 模式的返回
            const outputs = bodyData?.data?.outputs || bodyData?.data || bodyData;
            if (outputs && typeof outputs === 'object' && Object.keys(outputs).length > 0) {
                rawReport = outputs.text || outputs.result || outputs.output || Object.values(outputs)[0] || '';
                rawReport = typeof rawReport === 'object' ? JSON.stringify(rawReport) : String(rawReport);
            } else {
                rawReport = JSON.stringify(bodyData);
            }
        }

        res.json({ success: true, data: rawReport });
    } catch (e) {
        console.error('[电商风控请求失败]', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ====================== 研发配方法规检测整合 ======================

app.post('/api/risk-detection/rnd/upload', authenticateToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: '未找到文件数据' });
        }
        logAudit(req, { module: 'RISK_DETECTION', action: 'RND_UPLOAD_FILE', target_data: fixUploadedFileName(req.file.originalname) });

        const apiKey = process.env.DIFY_RND_RISK_API_KEY;
        let apiUrl = process.env.DIFY_RND_RISK_API_URL;
        if (apiUrl && !apiUrl.endsWith('/v1')) apiUrl = `${apiUrl.replace(/\/$/, '')}/v1`;

        if (!apiKey || !apiUrl) {
            return res.status(500).json({ success: false, message: '系统未配置 DIFY_RND_RISK_API_KEY' });
        }

        const formData = new FormData();
        const fileContent = fs.readFileSync(req.file.path);
        const { Blob: NodeBlob } = await import('buffer');
        const blob = new NodeBlob([fileContent], { type: req.file.mimetype });
        formData.append('file', blob, req.file.originalname);
        formData.append('user', req.user?.username || 'web_os_user');

        const difyRes = await fetch(`${apiUrl}/files/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}` },
            body: formData
        });

        const resText = await difyRes.text();
        if (!difyRes.ok) throw new Error(`Dify 文件上传报错 (${difyRes.status}): ${resText.substring(0, 200)}`);

        const data = JSON.parse(resText);
        res.json({ success: true, file_id: data.id });
    } catch (e) {
        console.error('[研发配方附件上传失败]', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/risk-detection/rnd/run', authenticateToken, async (req, res) => {
    try {
        const { country, industry, detectionType, ingredient_text, fileId } = req.body;
        logAudit(req, { module: 'RISK_DETECTION', action: 'RUN_RND_RISK', details: { country, industry, detectionType, hasText: !!ingredient_text, hasFile: !!fileId } });

        const apiKey = process.env.DIFY_RND_RISK_API_KEY;
        let apiUrl = process.env.DIFY_RND_RISK_API_URL;
        if (apiUrl && !apiUrl.endsWith('/v1')) apiUrl = `${apiUrl.replace(/\/$/, '')}/v1`;

        if (!apiKey || !apiUrl) return res.status(500).json({ success: false, message: '系统未配置研发风险检测 API' });

        const inputs = {
            country: country || '',
            industry: industry || '',
        };

        if (detectionType === 'text') {
            inputs.ingredient_text = ingredient_text || '';
        }

        const payload = {
            inputs,
            response_mode: 'blocking',
            user: req.user?.username || 'web_os_user'
        };

        if ((detectionType === 'image' || detectionType === 'document') && fileId) {
            payload.files = [{
                type: detectionType === 'image' ? 'image' : 'document',
                transfer_method: 'local_file',
                upload_file_id: fileId
            }];
        }

        let endpoint = `${apiUrl}/chat-messages`;
        payload.query = inputs.ingredient_text ? `检测配方：\n${inputs.ingredient_text}` : '请开始执行配方合规风险检测任务。';

        const difyRes = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const resText = await difyRes.text();

        if (!difyRes.ok) throw new Error(`研发配方风控大模型调用失败 (${difyRes.status}): ${resText.substring(0, 200)}`);

        const bodyData = JSON.parse(resText);
        let rawReport = '';

        if (bodyData.answer) {
            rawReport = bodyData.answer;
        } else {
            const outputs = bodyData?.data?.outputs || bodyData?.data || bodyData;
            if (outputs && typeof outputs === 'object' && Object.keys(outputs).length > 0) {
                rawReport = outputs.text || outputs.result || outputs.output || Object.values(outputs)[0] || '';
                rawReport = typeof rawReport === 'object' ? JSON.stringify(rawReport) : String(rawReport);
            } else {
                rawReport = JSON.stringify(bodyData);
            }
        }

        res.json({ success: true, data: rawReport });
    } catch (e) {
        console.error('[研发风控请求失败]', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

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
app.post('/api/generate-monthly-forecast', async (req, res) => {
    try {
        console.log('[API] 收到手动触发月度预测请求');
        logAudit(req, { module: 'PREDICTION', action: 'GENERATE_BASELINE' });
        await generateMonthlyBaseline();
        const baselinePath = path.join(__dirname, '../public', 'monthly_forecast_baseline.json');
        if (fs.existsSync(baselinePath)) {
            const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
            res.json({
                status: 'done',
                message: '月度预测生成完成',
                forecast_month: baseline.forecast_month,
                total_skus: baseline.metadata?.total_skus || 0,
                generated_at: baseline.generated_at
            });
        } else {
            res.status(500).json({ status: 'error', message: '预测生成后未找到基线文件' });
        }
    } catch (error) {
        res.status(500).json({ status: 'error', error: error.message });
    }
});

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
app.post('/api/track-deviation', async (req, res) => {
    try {
        logAudit(req, { module: 'PREDICTION', action: 'TRACK_DEVIATION' });
        res.json({ status: 'started', message: '偏差跟踪已启动' });
        // 异步执行，不阻塞响应
        trackSalesDeviation();
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API端点：获取偏差告警
app.get('/api/deviation-alerts', (req, res) => {
    try {
        const trackingPath = path.join(__dirname, '../public', 'forecast_tracking.json');
        if (fs.existsSync(trackingPath)) {
            const tracking = JSON.parse(fs.readFileSync(trackingPath, 'utf-8'));

            // 非管理员脱敏
            if (req.user && req.user.role !== 'admin' && tracking.deviations) {
                tracking.deviations = tracking.deviations.map(d => ({
                    ...d,
                    product_name: maskName(d.product_name)
                }));
            }

            res.json(tracking);
        } else {

            res.json({ deviations: [], unread_alerts: 0 });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== 动态滚动修正功能结束 ====================

// ==================== AI 工作流后端代理（市场洞察模块）====================
// 将 API Key 保存在后端，前端不持由 Key

// 代理：文件上传 → 分析引擎 /files/upload
app.post('/api/ai-workflow/upload', upload.single('file'), async (req, res) => {
    try {
        const DIFY_API_KEY = process.env.DIFY_WORKFLOW_API_KEY;
        const DIFY_BASE_URL = (process.env.DIFY_WORKFLOW_BASE_URL || 'http://39.108.221.22/v1').replace(/\/$/, '');

        if (!DIFY_API_KEY) {
            return res.status(503).json({ error: 'DIFY_WORKFLOW_API_KEY 未配置' });
        }
        if (!req.file) {
            return res.status(400).json({ error: '未收到文件' });
        }

        console.log(`[AI工作流代理] 上传文件: ${req.file.originalname} (${req.file.size} bytes)`);

        // 构造转发给分析引擎的 multipart 请求
        // 诊改优化：由于使用 diskStorage，从磁盘读取暂存文件内容
        const fileContent = fs.readFileSync(req.file.path);
        const { Blob: NodeBlob } = await import('buffer');
        const formData = new FormData();
        const blob = new NodeBlob([fileContent], { type: req.file.mimetype });
        formData.append('file', blob, req.file.originalname);
        formData.append('user', req.user?.username || req.body.user || 'web-client-user');

        const difyRes = await fetch(`${DIFY_BASE_URL}/files/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${DIFY_API_KEY}` },
            body: formData
        });

        const data = await difyRes.json();
        if (!difyRes.ok) {
            console.error('[AI工作流代理] 文件上传失败:', difyRes.status, data);
            return res.status(difyRes.status).json(data);
        }

        console.log(`[AI工作流代理] 文件上传成功, ID: ${data.id}`);
        res.json(data);
    } catch (error) {
        console.error('[AI工作流代理] 文件上传错误:', error);
        res.status(500).json({ error: error.message });
    }
});

// 代理：工作流执行 → 分析引擎 /workflows/run（流式转发）
app.post('/api/ai-workflow/run', async (req, res) => {
    try {
        const DIFY_API_KEY = process.env.DIFY_WORKFLOW_API_KEY;
        const DIFY_BASE_URL = (process.env.DIFY_WORKFLOW_BASE_URL || 'http://39.108.221.22/v1').replace(/\/$/, '');

        if (!DIFY_API_KEY) {
            return res.status(503).json({ error: 'DIFY_WORKFLOW_API_KEY 未配置' });
        }

        console.log('[AI工作流代理] 转发工作流执行请求');

        const difyRes = await fetch(`${DIFY_BASE_URL}/workflows/run`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${DIFY_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ ...req.body, user: req.user?.username || req.body.user || 'web-client-user' })
        });

        if (!difyRes.ok) {
            const errText = await difyRes.text();
            console.error(`[AI工作流代理] 分析引擎错误: ${difyRes.status}`);
            return res.status(difyRes.status).json({ error: `分析引擎接口错误: ${difyRes.status}`, details: errText });
        }

        // 流式转发 SSE
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');

        const reader = difyRes.body.getReader();
        const decoder = new TextDecoder();
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) { console.log('[AI工作流代理] 流式响应完成'); break; }
                res.write(decoder.decode(value, { stream: true }));
            }
        } catch (e) {
            console.error('[AI工作流代理] 流式错误:', e);
        } finally {
            res.end();
        }
    } catch (error) {
        console.error('[AI工作流代理] 工作流执行错误:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
});

// ==================== AI 工作流后端代理结束 ====================

// ==================== 市场洞察专用分析引擎代理 ====================
app.post('/api/market-insight/run', async (req, res) => {
    try {
        const apiKey = process.env.DIFY_MARKET_INSIGHT_API_KEY;
        const apiUrl = process.env.DIFY_MARKET_INSIGHT_API_URL || 'http://39.108.221.22/v1/chat-messages';
        logAudit(req, { module: 'MARKET_INSIGHT', action: 'RUN_CHATFLOW', details: { query: req.body.query } });

        // ── D4 试点迁移（TASK_CENTER_PILOT 含 market_insight 时启用）──────────
        // 建任务 → 执行 → 通知闭环；响应改为完整 JSON（弃 SSE）。
        // ⚠️ 本仓库暂无该模块新前端消费此路由，启用前需消费方支持 JSON。
        if (legacyBridge.isPilotSkill('market_insight')) {
            try {
                const r = await legacyBridge.runThroughTaskCenter({
                    skillKey: 'market_insight',
                    title: `市场洞察：${String(req.body?.query || '默认分析').slice(0, 24)}`,
                    user: req.user?.id ? req.user : { id: 0, username: 'market_anonymous', role: 'user' },
                    inputs: { message: req.body?.query || '进行市场洞察分析' },
                });
                if (!r.ok) {
                    console.error(`[市场洞察-任务中心] ${r.taskNo} 失败 ${r.errorCode}: ${r.message}`);
                    return res.status(500).json({ success: false, message: `任务执行失败（${r.taskNo}）：${r.message}` });
                }
                return res.json({ success: true, data: legacyBridge.stripThinkTags(legacyBridge.extractAnswer(r.outputs)) });
            } catch (err) {
                console.error('[市场洞察-任务中心] 异常:', err.message);
                return res.status(500).json({ success: false, message: `AI 诊断异常: ${err.message}` });
            }
        }

        if (!apiKey) {
            console.warn('[市场分析引擎] API_KEY 未配置，请在.env中填写');
            return res.status(503).json({ error: '后端 API_KEY 未配置，请联系管理员。' });
        }

        console.log('[市场分析引擎] 转发市场洞察分析请求');

        // Chatflow 必须包含 query，如果前端没传则补齐
        const payload = {
            ...req.body,
            user: req.user?.username || req.body.user || 'web-client-user'
        };
        if (!payload.query) payload.query = "进行市场洞察分析";

        // 审计日志：打印输入的变量结构（脱敏处理 Key 但保留结构）
        console.log('[市场分析引擎] 发送至分析引擎的完整 Payload:', JSON.stringify({
            ...payload,
            inputs: { ...payload.inputs }
        }, null, 2));

        const difyRes = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!difyRes.ok) {
            const errText = await difyRes.text();
            console.error(`[市场分析引擎] 接口错误: ${difyRes.status}`, errText);
            return res.status(difyRes.status).json({ error: `分析引擎接口错误: ${difyRes.status}`, details: errText });
        }

        // 流式转发 SSE
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');

        const reader = difyRes.body.getReader();
        const decoder = new TextDecoder();
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                res.write(decoder.decode(value, { stream: true }));
            }
        } catch (e) {
            console.error('[市场分析引擎] 流式转发中断:', e);
        } finally {
            res.end();
        }
    } catch (error) {
        console.error('[市场分析引擎] 系统错误:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
});

// 市场洞察专用文件上传代理
app.post('/api/market-insight/upload', upload.single('file'), async (req, res) => {
    // ... (现有逻辑保持不变)
    try {
        if (!req.file) return res.status(400).json({ error: '未检测到上传文件' });
        logAudit(req, { module: 'MARKET_INSIGHT', action: 'UPLOAD_FILE', target_data: req.file.originalname });

        const apiKey = process.env.DIFY_MARKET_INSIGHT_API_KEY;
        const apiUrl = (process.env.DIFY_MARKET_INSIGHT_API_URL || 'http://39.108.221.22/v1').replace(/\/chat-messages$/, '').replace(/\/$/, '');

        if (!apiKey) {
            return res.status(503).json({ error: 'DIFY_MARKET_INSIGHT_API_KEY 未配置' });
        }

        console.log(`[市场洞察上传] 系统转发图片: ${req.file.originalname}`);

        const { Blob: NodeBlob } = await import('buffer');
        const formData = new FormData();
        // 诊改优化：从磁盘读取暂存文件转发至 Dify
        const fileContent = fs.readFileSync(req.file.path);
        const blob = new NodeBlob([fileContent], { type: req.file.mimetype });
        formData.append('file', blob, req.file.originalname);
        formData.append('user', req.user?.username || req.body.user || 'web-client-user');

        const difyRes = await fetch(`${apiUrl}/files/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}` },
            body: formData
        });

        const data = await difyRes.json();
        if (!difyRes.ok) {
            console.error('[市场洞察上传] 失败:', difyRes.status, data);
            return res.status(difyRes.status).json(data);
        }

        res.json(data);
    } catch (error) {
        console.error('[市场洞察上传] 异常:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== 合同审核专用分析引擎代理 ====================

// 1. 运行合同审核
app.post('/api/contract-audit/run', async (req, res) => {
    try {
        const apiKey = process.env.DIFY_CONTRACT_AUDIT_API_KEY;
        const apiUrl = process.env.DIFY_CONTRACT_AUDIT_API_URL || 'http://39.108.221.22/v1/chat-messages';
        logAudit(req, { module: 'CONTRACT_AUDIT', action: 'RUN_AUDIT' });

        // ── D4 试点迁移（TASK_CENTER_PILOT 含 contract_review 时启用）──────────
        // 建任务 → 执行 → 通知闭环；响应改为完整 JSON（前端按 content-type 双模式兼容）。
        if (legacyBridge.isPilotSkill('contract_review')) {
            try {
                const body = req.body || {};
                const fileIds = Array.isArray(body.file_ids) ? body.file_ids.map(String) : [];
                const r = await legacyBridge.runThroughTaskCenter({
                    skillKey: 'contract_review',
                    title: `合同审核：${String(body.query || '').slice(0, 24)}`,
                    user: req.user?.id ? req.user : { id: 0, username: 'contract_anonymous', role: 'user' },
                    inputs: { message: body.query || '请审核这份合同' },
                    files: fileIds,
                });
                if (!r.ok) {
                    console.error(`[合同审核-任务中心] ${r.taskNo} 失败 ${r.errorCode}: ${r.message}`);
                    return res.status(500).json({ success: false, message: `任务执行失败（${r.taskNo}）：${r.message}` });
                }
                const text = String(
                    r.outputs?._extra?.answer ?? r.outputs?.answer
                    ?? legacyBridge.extractAnswerText(r.outputs ?? {}) ?? '',
                );
                return res.json({ success: true, data: text });
            } catch (err) {
                console.error('[合同审核-任务中心] 异常:', err.message);
                if (!res.headersSent) return res.status(500).json({ success: false, message: `AI 诊断异常: ${err.message}` });
                return;
            }
        }

        if (!apiKey) {
            return res.status(503).json({ error: '后端 DIFY_CONTRACT_AUDIT_API_KEY 未配置，请联系管理员。' });
        }

        console.log('[合同审核引擎] 转发合同审核分析请求');

        // 旧直连路径：前端已改传平台暂存 file_ids —— 这里水合后转传 Dify（行为对齐旧协议）
        let payload = {
            ...req.body,
            user: req.user?.username || req.body.user || 'web-client-user'
        };
        if (Array.isArray(req.body?.file_ids) && req.body.file_ids.length > 0) {
            const baseUpload = String(apiUrl).replace(/\/chat-messages.*$/, '/files/upload');
            const bufs = await loadStagedBuffers(req.body.file_ids.map(String));
            const difyFiles = [];
            for (const f of bufs) {
                const fd = new FormData();
                fd.append('file', new Blob([f.buffer], { type: f.mimeType }), f.name);
                fd.append('user', payload.user);
                const upRes = await fetch(baseUpload, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${apiKey}` },
                    body: fd,
                });
                if (!upRes.ok) {
                    const errText = await upRes.text().catch(() => `HTTP ${upRes.status}`);
                    throw new Error(`Dify 文件上传失败 (${upRes.status}): ${errText.slice(0, 200)}`);
                }
                const upData = await upRes.json();
                difyFiles.push({
                    type: String(f.mimeType || '').startsWith('image/') ? 'image' : 'document',
                    transfer_method: 'local_file',
                    upload_file_id: upData.id,
                });
            }
            delete payload.file_ids;
            payload.files = difyFiles;
        }

        const difyRes = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!difyRes.ok) {
            const errText = await difyRes.text();
            console.error(`[合同审核引擎] 接口错误: ${difyRes.status}`, errText);
            return res.status(difyRes.status).json({ error: `分析引擎接口错误: ${difyRes.status}`, details: errText });
        }

        // 流式转发 SSE
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');

        const reader = difyRes.body.getReader();
        const decoder = new TextDecoder();
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                res.write(decoder.decode(value, { stream: true }));
            }
        } catch (e) {
            console.error('[合同审核引擎] 流式转发中断:', e);
        } finally {
            res.end();
        }
    } catch (error) {
        console.error('[合同审核引擎] 系统错误:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
});

// 2. 合同文件上传代理
app.post('/api/contract-audit/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: '未检测到上传文件' });
        logAudit(req, { module: 'CONTRACT_AUDIT', action: 'UPLOAD_FILE', target_data: req.file.originalname });

        const apiKey = process.env.DIFY_CONTRACT_AUDIT_API_KEY;
        const apiUrl = (process.env.DIFY_CONTRACT_AUDIT_API_URL || 'http://39.108.221.22/v1').replace(/\/chat-messages$/, '').replace(/\/$/, '');

        if (!apiKey) {
            return res.status(503).json({ error: 'DIFY_CONTRACT_AUDIT_API_KEY 未配置' });
        }

        console.log(`[合同审核上传] 系统转发文件: ${req.file.originalname}`);

        const { Blob: NodeBlob } = await import('buffer');
        const formData = new FormData();
        // 诊改优化：从磁盘读取暂存文件内容转发至 Dify
        const fileContent = fs.readFileSync(req.file.path);
        const blob = new NodeBlob([fileContent], { type: req.file.mimetype });
        formData.append('file', blob, req.file.originalname);
        formData.append('user', req.user?.username || req.body.user || 'web-client-user');

        const difyRes = await fetch(`${apiUrl}/files/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}` },
            body: formData
        });

        const data = await difyRes.json();
        if (!difyRes.ok) {
            console.error('[合同审核上传] 失败:', difyRes.status, data);
            return res.status(difyRes.status).json(data);
        }

        res.json(data);
    } catch (error) {
        console.error('[合同审核上传] 异常:', error);
        res.status(500).json({ error: error.message });
    }
});



// ==================== 公司制度问答助手分析引擎 ==================
const getRulesHeaders = () => ({
    'Authorization': `Bearer ${process.env.DIFY_RULES_ASSISTANT_API_KEY || ''}`,
    'Content-Type': 'application/json'
});
const rulesBaseUrl = process.env.DIFY_RULES_ASSISTANT_API_URL || 'http://39.108.221.22/v1';

// 1. 发送消息 (支持流式)
app.post('/api/rules/chat-messages', async (req, res) => {
    try {
        logAudit(req, { module: 'RULES_ASSISTANT', action: 'CHAT', details: { query: req.body.query } });
        const response = await fetch(`${rulesBaseUrl}/chat-messages`, {
            method: 'POST',
            headers: getRulesHeaders(),
            body: JSON.stringify(req.body)
        });
        if (!response.ok) {
            const err = await response.text();
            return res.status(response.status).json({ error: err });
        }
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(decoder.decode(value, { stream: true }));
        }
        res.end();
    } catch (error) {
        if (!res.headersSent) res.status(500).json({ error: error.message });
    }
});

// 2. 获取会话列表
app.get('/api/rules/conversations', async (req, res) => {
    try {
        const user = req.query.user || 'web_user';
        const limit = req.query.limit || 20;
        const response = await fetch(`${rulesBaseUrl}/conversations?user=${user}&limit=${limit}`, {
            headers: { 'Authorization': getRulesHeaders().Authorization }
        });
        const data = await response.json();
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. 获取历史消息
app.get('/api/rules/messages', async (req, res) => {
    try {
        const { user = 'web_user', conversation_id } = req.query;
        if (!conversation_id) return res.status(400).json({ error: 'Missing conversation_id' });
        const response = await fetch(`${rulesBaseUrl}/messages?user=${user}&conversation_id=${conversation_id}`, {
            headers: { 'Authorization': getRulesHeaders().Authorization }
        });
        const data = await response.json();
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. 重命名会话
app.post('/api/rules/conversations/:id/name', async (req, res) => {
    try {
        const { name, user = 'web_user' } = req.body;
        const auto_generate = req.body.auto_generate ?? false;
        const response = await fetch(`${rulesBaseUrl}/conversations/${req.params.id}/name`, {
            method: 'POST',
            headers: getRulesHeaders(),
            body: JSON.stringify({ name, auto_generate, user })
        });
        const data = await response.json();
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 5. 删除会话
app.delete('/api/rules/conversations/:id', async (req, res) => {
    try {
        const { user = 'web_user' } = req.body;
        const response = await fetch(`${rulesBaseUrl}/conversations/${req.params.id}`, {
            method: 'DELETE',
            headers: getRulesHeaders(),
            body: JSON.stringify({ user })
        });
        const data = await response.json();
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

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

app.post('/api/order-suggestion', async (req, res) => {
    try {
        const { analysis_type, tier, summary, tier_distribution, risk_distribution, customer } = req.body;

        if (!analysis_type || !['group_strategy', 'single_customer'].includes(analysis_type)) {
            return res.status(400).json({ error: '无效的 analysis_type，需为 group_strategy 或 single_customer' });
        }
        if (analysis_type === 'group_strategy' && !tier) {
            return res.status(400).json({ error: '分组策略分析需提供 tier 字段' });
        }
        if (analysis_type === 'single_customer' && !customer) {
            return res.status(400).json({ error: '单客户分析需提供 customer 字段' });
        }

        const DIFY_API_KEY = process.env.DIFY_ORDER_SUGGESTION_API_KEY;
        const DIFY_API_URL = process.env.DIFY_ORDER_SUGGESTION_API_URL || 'http://39.108.221.22/v1/chat-messages';

        if (!DIFY_API_KEY) {
            return res.status(503).json({ error: 'DIFY_ORDER_SUGGESTION_API_KEY 未配置，请在 .env 中填写' });
        }

        // 构造发送给 Dify 的 query（JSON 格式）
        let processedCustomer = customer;
        let originalName = '';
        const isSingle = analysis_type === 'single_customer' && customer;

        // JIT 脱敏逻辑改造
        if (isSingle) {
            originalName = customer.name;
            const features = await extractCustomerFeaturesJIT(customer.id, customer.name, req.user?.username || 'api_user');

            processedCustomer = {
                ...customer,
                name: `{{C_${customer.id}}}`, // 占位符掩盖真实姓名
                ...features                  // 注入从 PG 或 AI 提取的特征
            };
        }

        const payload = analysis_type === 'group_strategy'
            ? { analysis_type, tier, summary, tier_distribution, risk_distribution }
            : { analysis_type, customer: processedCustomer };

        const difyBody = {
            inputs: { analysis_data: JSON.stringify(payload) },
            query: JSON.stringify(payload),
            response_mode: 'streaming',
            conversation_id: '',
            user: req.user?.username || 'web_user_order_suggestion'
        };

        logAudit(req, { module: 'ORDER_SUGGESTION', action: 'RUN_SUGGESTION', details: { type: analysis_type, summary: !!summary } });
        console.log(`[订货建议] 最终 Payload:`, JSON.stringify(payload, null, 2));
        console.log(`[订货建议] 调用分析引擎, analysis_type=${analysis_type}, tier/customer=${tier || customer?.name || customer?.id}`);

        const difyResponse = await fetch(DIFY_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${DIFY_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(difyBody)
        });

        if (!difyResponse.ok) {
            const errText = await difyResponse.text();
            console.error(`[订货建议] 接口错误: ${difyResponse.status} - ${errText}`);
            return res.status(difyResponse.status).json({ error: `分析引擎调用失败: ${difyResponse.status}`, details: errText });
        }

        // SSE 流式转发
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');

        const reader = difyResponse.body.getReader();
        const decoder = new TextDecoder();
        const placeholderStr = isSingle ? `{{C_${customer.id}}}` : null;
        // 使用正则防止 AI 在输出时产生微小变体（如空格），同时匹配可能被转义的情况
        const placeholderRegex = placeholderStr ? new RegExp(`{{C_?\\s*${customer.id}\\s*}}`, 'g') : null;
        let leftover = '';

        if (isSingle) {
            console.log(`[订货建议] 准备复敏: 占位符=${placeholderStr}, 目标=${originalName}`);
        }

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    if (leftover) res.write(leftover);
                    console.log('[订货建议] 流式响应完成');
                    break;
                }

                let chunk = decoder.decode(value, { stream: true });
                let fullText = leftover + chunk;

                // 复敏逻辑
                if (placeholderRegex && originalName) {
                    if (fullText.search(placeholderRegex) !== -1) {
                        console.log(`[订货建议] 检测到占位符! 正在执行替换...`);
                        fullText = fullText.replace(placeholderRegex, originalName);
                    }

                    // 留出缓冲区
                    const safeTail = 40;
                    if (fullText.length > safeTail) {
                        res.write(fullText.substring(0, fullText.length - safeTail));
                        leftover = fullText.substring(fullText.length - safeTail);
                    } else {
                        leftover = fullText;
                    }
                } else {
                    res.write(chunk);
                }
            }
        } catch (e) {
            console.error('[订货建议] 流式响应错误:', e);
        } finally {
            res.end();
        }
    } catch (error) {
        console.error('[订货建议] 处理错误:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
});

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
app.post('/api/update-customer-analysis', async (req, res) => {
    if (customerAnalysisStatus.isRunning) {
        return res.status(429).json({ error: '客户分析任务正在执行中，请稍后再试' });
    }
    logAudit(req, { module: 'CUSTOMER_ANALYSIS', action: 'UPDATE_DATA' });
    customerAnalysisStatus.isRunning = true;
    customerAnalysisStatus.status = 'running';
    customerAnalysisStatus.message = '正在执行Python脚本...';

    console.log(`[客户分析] ${new Date().toISOString()} 开始执行 a3_customer_analysis.py`);

    // 添加 PYTHONIOENCODING=utf-8 解决 Windows GBK 编码导致的 emoji 乱码问题
    const python = spawn('python', ['scripts/a3_customer_analysis.py'], {
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
    });
    let output = '';
    let errorOutput = '';

    python.stdout.on('data', (data) => {
        const text = data.toString('utf8');
        output += text;
        console.log(`[客户分析-Python] ${text.trim()}`);
    });

    python.stderr.on('data', (data) => {
        const text = data.toString('utf8');
        errorOutput += text;
        console.error(`[客户分析-错误] ${text.trim()}`);
    });

    python.on('close', (code) => {
        customerAnalysisStatus.isRunning = false;

        if (code === 0) {
            try {
                // 从 Python 完整输出中提取 JSON（在分隔符后的部分）
                const separator = '==================== 客户分析结果-JSON格式 ====================';
                const jsonStart = output.indexOf(separator);
                let jsonStr = '';
                if (jsonStart !== -1) {
                    jsonStr = output.substring(jsonStart + separator.length).trim();
                } else {
                    const firstBrace = output.indexOf('{');
                    if (firstBrace !== -1) jsonStr = output.substring(firstBrace).trim();
                }

                if (!jsonStr) throw new Error('未能从 Python输出中提取JSON数据');

                // 修复 NaN → null（Python JSON 输出中可能含有 NaN）
                jsonStr = jsonStr.replace(/\bNaN\b/g, 'null');

                const analysisData = JSON.parse(jsonStr);

                const destPath = path.join(__dirname, '../public', 'customer_analysis.json');
                fs.writeFileSync(destPath, JSON.stringify(analysisData, null, 2));

                customerAnalysisStatus.lastUpdate = new Date().toISOString();
                customerAnalysisStatus.status = 'success';
                customerAnalysisStatus.message = '客户分析数据更新成功';

                console.log('[客户分析] 数据已保存到 ' + destPath);
                res.json({
                    success: true,
                    message: '客户分析数据更新成功',
                    timestamp: customerAnalysisStatus.lastUpdate,
                    overview: analysisData.analysis_overview
                });
            } catch (parseError) {
                console.error('[客户分析] JSON解析失败:', parseError.message);
                customerAnalysisStatus.status = 'error';
                customerAnalysisStatus.message = `JSON解析失败: ${parseError.message}`;
                res.status(500).json({ error: `JSON解析失败: ${parseError.message}` });
            }
        } else {
            console.error(`[客户分析] Python脚本执行失败，退出码: ${code}`);
            customerAnalysisStatus.status = 'error';
            customerAnalysisStatus.message = `Python脚本执行失败 (退出码: ${code})`;
            res.status(500).json({ error: `Python脚本执行失败: ${errorOutput || '未知错误'}` });
        }
    });

    python.on('error', (error) => {
        customerAnalysisStatus.isRunning = false;
        customerAnalysisStatus.status = 'error';
        customerAnalysisStatus.message = `无法启动Python: ${error.message}`;
        console.error('[客户分析] Python启动错误:', error);
        res.status(500).json({ error: `无法启动Python: ${error.message}` });
    });
});

// API端点：获取客户分析数据（读取 JSON 文件）
app.get('/api/customer-analysis', (req, res) => {
    try {
        const dataPath = path.join(__dirname, '../public', 'customer_analysis.json');
        if (!fs.existsSync(dataPath)) {
            return res.json({ exists: false, data: null, message: '暂无数据，请先点击"更新数据"按鈕' });
        }
        const raw = fs.readFileSync(dataPath, 'utf-8');
        let data = JSON.parse(raw);

        // 非管理员脱敏
        if (req.user && req.user.role !== 'admin') {
            if (data.customer_analysis) {
                data.customer_analysis = data.customer_analysis.map(c => ({
                    ...c,
                    '客户名称': maskName(c['客户名称']),
                    '最近订单金额': maskAmount(c['最近订单金额']),
                    '联系电话': maskPhone(c['联系电话'])
                }));
            }
        }

        res.json({ exists: true, data, lastModified: fs.statSync(dataPath).mtime });

    } catch (error) {
        console.error('[客户分析] 读取失败:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== AI 图生图（Doubao seedream-4.0 - 纯Node.js实现）====================
const uploadMemory = multer({ storage: multer.memoryStorage() });

app.post('/api/generate-image', uploadMemory.array('images', 5), async (req, res) => {
    try {
        const files = req.files;
        const prompt = req.body.prompt;
        const model = req.body.model || 'doubao-seedream-4-5-251128';

        console.log(`[AI生图] 接收到原始参数: model=${req.body.model}, promptLen=${prompt?.length || 0}`);

        if (!files || files.length === 0) {
            return res.status(400).json({ error: '请至少上传一张参考图' });
        }
        if (!prompt || !prompt.trim()) {
            return res.status(400).json({ error: '请提供提示词' });
        }
        logAudit(req, { module: 'AI_IMAGE', action: 'GENERATE', details: { prompt, size: req.body.size, model } });

        const ARK_API_KEY = process.env.ARK_API_KEY;
        if (!ARK_API_KEY || ARK_API_KEY === '请填入你的ARK_API_KEY') {
            return res.status(503).json({ error: 'ARK_API_KEY 未配置，请在 .env 文件中填写' });
        }

        const size = req.body.size || '2048x2048';
        console.log(`[AI生图] 准备调用 API: 模型=${model}, 分辨率=${size}, 参考图=${files.length}张`);

        // 将上传的图片转为 base64 Data URI
        const base64Images = files.map(f => {
            const mime = f.mimetype || 'image/jpeg';
            return `data:${mime};base64,${f.buffer.toString('base64')}`;
        });

        // 构建 Doubao API 请求体
        const requestBody = {
            model: model,
            prompt: prompt,
            image: base64Images.length === 1 ? base64Images[0] : base64Images,
            sequential_image_generation: 'auto',
            sequential_image_generation_options: { max_images: 10 },
            response_format: 'url',
            size: size,
            stream: true,
            watermark: false
        };


        // 调用 Doubao API（OpenAI compatible endpoint）
        const arkRes = await fetch('https://ark.cn-beijing.volces.com/api/v3/images/generations', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${ARK_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!arkRes.ok) {
            const errText = await arkRes.text();
            console.error(`[AI生图] Doubao API 错误 ${arkRes.status}:`, errText);
            return res.status(arkRes.status).json({ error: `Doubao API 错误: ${arkRes.status}`, details: errText });
        }

        // 设置 SSE 响应头，流式推送给前端
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');

        const sendEvent = (data) => {
            if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        // 解析 Doubao SSE 流
        const reader = arkRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let imageCount = 0;

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data:')) continue;
                    const jsonStr = trimmed.slice(5).trim();
                    if (jsonStr === '[DONE]') continue;
                    try {
                        const event = JSON.parse(jsonStr);
                        const eventType = event.type || event.event;

                        if (eventType === 'image_generation.partial_succeeded') {
                            const url = event.url || event.data?.url;
                            if (url) {
                                imageCount++;
                                console.log(`[AI生图] 第${imageCount}张图片就绪`);
                                sendEvent({ type: 'partial', url, index: imageCount });
                            }
                        } else if (eventType === 'image_generation.completed') {
                            console.log(`[AI生图] 全部完成，共${imageCount}张`);
                            sendEvent({ type: 'complete', total: imageCount });
                        } else if (eventType === 'image_generation.partial_failed') {
                            const errMsg = event.error?.message || '单张生成失败';
                            console.warn(`[AI生图] 单张失败:`, errMsg);
                            sendEvent({ type: 'partial_failed', message: errMsg });
                        }
                    } catch {
                        // 忽略无法解析的行
                    }
                }
            }
        } catch (streamErr) {
            console.error('[AI生图] 流读取错误:', streamErr);
            sendEvent({ type: 'error', message: streamErr.message });
        } finally {
            res.end();
        }

        console.log(`[AI生图] 请求处理完成，共生成 ${imageCount} 张图片`);

    } catch (error) {
        console.error('[AI生图] 处理错误:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        } else {
            res.end();
        }
    }
});

// ==================== AI 图生图结束 ====================


// ==================== 客户分析功能结束 ====================


// ==================== 智能匹配 API ====================
app.use('/api/smart-match', coreServicesLimiter);

app.post('/api/smart-match', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: '请上传图片' });
        }
        logAudit(req, { module: 'BEAUTY_RND', action: 'SMART_MATCH', target_data: req.file.originalname });

        // 读取 Demo 数据库
        const dbPath = path.join(__dirname, '../public', 'cosmetic_db.json');
        const cosmetics = JSON.parse(await fs.promises.readFile(dbPath, 'utf-8'));

        // 用户附加的关键词过滤条件（前端可选传）
        const userCategory = req.body.category || '';
        const userColor = req.body.color_name || '';
        const userFinish = req.body.finish || '';

        // 将图片转为 base64 供 AI 分析
        // 诊改优化：从磁盘读取暂存文件并进行 base64 编码
        const base64Image = fs.readFileSync(req.file.path).toString('base64');
        const mimeType = req.file.mimetype || 'image/jpeg';

        let aiAnalysis = null;

        // 调用火山引擎 Doubao Vision 分析图片
        const ARK_API_KEY = process.env.ARK_API_KEY;
        if (ARK_API_KEY) {
            try {
                const visionResp = await fetch('https://ark.cn-beijing.volces.com/api/v3/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${ARK_API_KEY}`
                    },
                    body: JSON.stringify({
                        model: 'doubao-1-5-vision-pro-32k-250115',
                        messages: [
                            {
                                role: 'user',
                                content: [
                                    {
                                        type: 'image_url',
                                        image_url: { url: `data:${mimeType};base64,${base64Image}` }
                                    },
                                    {
                                        type: 'text',
                                        text: `请分析这张化妆品图片，只需返回 JSON，格式如下（不要有多余文字）：
{"category":"唇部/眼部/底妆/护肤/面部/香氛之一","subcategory":"具体品类如口红/唇膏/眼影/粉底液/精华/面霜等","color_name":"颜色名称如正红/豆沙/裸色/无色等","finish":"哑光/水光/珠光/滋润/清爽/闪烁/雾面之一","tags":["最多5个关键词"]}`
                                    }
                                ]
                            }
                        ],
                        max_tokens: 200
                    })
                });
                if (visionResp.ok) {
                    const visionData = await visionResp.json();
                    const content = visionData.choices?.[0]?.message?.content || '';
                    const jsonMatch = content.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        aiAnalysis = JSON.parse(jsonMatch[0]);
                        logger.info('[smart-match] AI 分析结果: ' + JSON.stringify(aiAnalysis));
                    }
                }
            } catch (visionErr) {
                logger.warn('[smart-match] AI 分析失败，降级到关键词匹配: ' + visionErr.message);
            }
        }

        // 打分函数：综合 AI 分析结果 + 用户选择关键词
        const scored = cosmetics.map(item => {
            let score = 0;

            // AI 分析命中加分
            if (aiAnalysis) {
                if (aiAnalysis.category && item.category === aiAnalysis.category) score += 40;
                if (aiAnalysis.subcategory && item.subcategory === aiAnalysis.subcategory) score += 25;
                if (aiAnalysis.color_name && item.color_name.includes(aiAnalysis.color_name)) score += 15;
                if (aiAnalysis.finish && item.finish === aiAnalysis.finish) score += 10;
                if (Array.isArray(aiAnalysis.tags)) {
                    aiAnalysis.tags.forEach(tag => {
                        if (item.tags.some(t => t.includes(tag) || tag.includes(t))) score += 5;
                    });
                }
            }

            // 用户手动选的关键词加分
            if (userCategory && item.category.includes(userCategory)) score += 20;
            if (userColor && item.color_name.includes(userColor)) score += 15;
            if (userFinish && item.finish.includes(userFinish)) score += 10;

            // 随机扰动（展示效果）
            score += Math.floor(Math.random() * 8);

            // 归一化到 0-100
            const maxScore = aiAnalysis ? 110 : 45;
            const similarity = Math.min(Math.round((score / maxScore) * 100), 99);

            return { ...item, similarity };
        });

        // 按相似度排序，取 Top 6
        const results = scored
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, 6);

        res.json({
            success: true,
            aiAnalysis: aiAnalysis || { note: 'AI 分析不可用，已使用关键词匹配' },
            results
        });
    } catch (err) {
        logger.error('[smart-match] 出错: ' + err.message);
        res.status(500).json({ error: '智能匹配失败：' + err.message });
    }
});

// ==================== 智能匹配 API 结束 ====================


// ==================== 出海本地化营销内容生成 API ====================
app.post('/api/sea-marketing/generate', async (req, res) => {
    try {
        const apiKey = process.env.DIFY_SEA_MARKETING_API_KEY;
        const apiUrl = process.env.DIFY_SEA_MARKETING_API_URL;
        if (!apiKey || !apiUrl) {
            return res.status(500).json({ error: '服务端未配置出海营销大模型的 API Key 或 URL' });
        }
        const { product_name, product_info, ingredient, target_language, target_platform, marketing_style } = req.body;
        logAudit(req, { module: 'SEA_MARKETING', action: 'GENERATE_CONTENT', details: { product_name, target_platform } });

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: {
                    product_name,
                    product_info,
                    ingredient,
                    target_language,
                    target_platform,
                    marketing_style
                },
                query: `Target Platform: ${target_platform}`,
                response_mode: 'blocking',
                user: req.user ? req.user.username : 'system'
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`分析引擎接口请求失败: ${errText}`);
        }

        const data = await response.json();
        res.json({ success: true, data });
    } catch (err) {
        logger.error('[sea-marketing] 出错: ' + err.message);
        res.status(500).json({ error: '营销内容生成失败：' + err.message });
    }
});

// ==================== 美妆智能研发内容生成 API ====================
app.post('/api/beauty-rnd/generate', async (req, res) => {
    try {
        const apiKey = process.env.DIFY_BEAUTY_RND_API_KEY;
        const apiUrl = process.env.DIFY_BEAUTY_RND_API_URL || 'http://39.108.221.22/v1/chat-messages';
        if (!apiKey) {
            return res.status(503).json({ error: '服务端未配置美妆研发大模型的 API Key。' });
        }
        const { product_type, target_market, pain_point, cert_require, cost_limit, product_form, skin_type, blacklist, data_source } = req.body;
        logAudit(req, { module: 'BEAUTY_RND', action: 'GENERATE_REPORT', details: { product_type, target_market } });

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: {
                    product_type,
                    target_market,
                    pain_point,
                    cert_require,
                    cost_limit,
                    product_form,
                    skin_type,
                    blacklist,
                    data_source
                },
                query: `Product Type: ${product_type}`,
                response_mode: 'blocking',
                user: req.user ? req.user.username : 'system'
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`分析引擎接口请求失败: ${errText}`);
        }

        const data = await response.json();
        res.json({ success: true, data });
    } catch (err) {
        console.error('[beauty-rnd] 出错: ' + err.message);
        res.status(500).json({ error: '研发报告生成失败：' + err.message });
    }
});

// 获取会话列表
app.get('/api/beauty-rnd/conversations', async (req, res) => {
    try {
        const apiKey = process.env.DIFY_BEAUTY_RND_API_KEY;
        const apiUrl = (process.env.DIFY_BEAUTY_RND_API_URL || 'http://39.108.221.22/v1/chat-messages').replace(/\/chat-messages$/, '').replace(/\/$/, '');
        if (!apiKey) return res.status(503).json({ error: 'API Key 未配置' });

        const user = req.user?.username || req.query.user || 'system';
        const limit = req.query.limit || 50;

        const response = await fetch(`${apiUrl}/conversations?user=${user}&limit=${limit}`, {
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 获取会话详情消息
app.get('/api/beauty-rnd/messages', async (req, res) => {
    try {
        const apiKey = process.env.DIFY_BEAUTY_RND_API_KEY;
        const apiUrl = (process.env.DIFY_BEAUTY_RND_API_URL || 'http://39.108.221.22/v1/chat-messages').replace(/\/chat-messages$/, '').replace(/\/$/, '');
        if (!apiKey) return res.status(503).json({ error: 'API Key 未配置' });

        const user = req.user?.username || req.query.user || 'system';
        const conversation_id = req.query.conversation_id;

        if (!conversation_id) return res.status(400).json({ error: '缺少 conversation_id 参数' });

        const response = await fetch(`${apiUrl}/messages?user=${user}&conversation_id=${conversation_id}`, {
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 删除单个会话
app.delete('/api/beauty-rnd/conversations/:id', async (req, res) => {
    try {
        const apiKey = process.env.DIFY_BEAUTY_RND_API_KEY;
        const apiUrl = (process.env.DIFY_BEAUTY_RND_API_URL || 'http://39.108.221.22/v1/chat-messages').replace(/\/chat-messages$/, '').replace(/\/$/, '');
        if (!apiKey) return res.status(503).json({ error: 'API Key 未配置' });

        const user = req.user?.username || req.body.user || 'system';
        const response = await fetch(`${apiUrl}/conversations/${req.params.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ user })
        });
        
        let data = {};
        try {
            data = await response.json();
        } catch (e) {
            // Dify might return 204 No Content or empty string
            data = { result: 'success' };
        }
        
        res.json(data);
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

// 清空所有会话 (后端迭代删除)
app.delete('/api/beauty-rnd/conversations', async (req, res) => {
    try {
        const apiKey = process.env.DIFY_BEAUTY_RND_API_KEY;
        const apiUrl = (process.env.DIFY_BEAUTY_RND_API_URL || 'http://39.108.221.22/v1/chat-messages').replace(/\/chat-messages$/, '').replace(/\/$/, '');
        if (!apiKey) return res.status(503).json({ error: 'API Key 未配置' });

        const user = req.user?.username || 'system';

        // 1. 获取列表
        const listRes = await fetch(`${apiUrl}/conversations?user=${user}&limit=100`, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        const listData = await listRes.json();

        if (listData.data && listData.data.length > 0) {
            // 2. 迭代删除
            const deletePromises = listData.data.map(conv =>
                fetch(`${apiUrl}/conversations/${conv.id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ user })
                })
            );
            await Promise.all(deletePromises);
        }

        res.json({ success: true, message: 'All history cleared' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 获取自定义配方版本
app.get('/api/beauty-rnd/versions', async (req, res) => {
    try {
        const { conversation_id } = req.query;
        if (!conversation_id) return res.status(400).json({ error: '缺少 conversation_id' });
        const result = await pool.query(
            'SELECT version_id as "versionId", version_name as "versionName", timestamp, ingredients FROM sys_beauty_rnd_versions WHERE conversation_id = $1 ORDER BY id ASC',
            [conversation_id]
        );
        res.json({ success: true, versions: result.rows });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 保存自定义配方版本
app.post('/api/beauty-rnd/versions', async (req, res) => {
    try {
        const { conversation_id, version_id, version_name, timestamp, ingredients } = req.body;
        if (!conversation_id || !version_id || !ingredients) return res.status(400).json({ error: '缺少必要参数' });
        await pool.query(
            `INSERT INTO sys_beauty_rnd_versions (conversation_id, version_id, version_name, timestamp, ingredients) 
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (conversation_id, version_id) 
             DO UPDATE SET version_name = EXCLUDED.version_name, timestamp = EXCLUDED.timestamp, ingredients = EXCLUDED.ingredients`,
            [conversation_id, version_id, version_name, timestamp, JSON.stringify(ingredients)]
        );
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

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
app.get('/api/config/ai_scenes', authenticateToken, async (req, res) => {
    try {
        const scenesRes = await pool.query(
            `SELECT scene_id AS id, label, emoji, description AS desc 
             FROM ref_ai_scenes WHERE is_active = true ORDER BY sort_order, id`
        );
        const fieldsRes = await pool.query(
            `SELECT scene_id, field_id AS id, field_label AS label, options 
             FROM ref_ai_scene_fields WHERE is_active = true ORDER BY sort_order, id`
        );

        const scenes = scenesRes.rows.map(scene => {
            const fields = fieldsRes.rows
                .filter(f => f.scene_id === scene.id)
                .map(f => {
                    const splitOptions = Array.isArray(f.options)
                        ? f.options
                        : (f.options || '')
                            .split(/[\/、,，]+/)
                            .map(k => k.trim())
                            .filter(k => k !== '');
                    return {
                        id: f.id,
                        label: f.label,
                        options: splitOptions
                    };
                });
            return {
                id: scene.id,
                label: scene.label,
                emoji: scene.emoji,
                desc: scene.desc,
                fields: fields
            };
        });

        return res.json({ success: true, data: scenes });
    } catch (err) {
        logger.error('[PG] 读取AI场景配置失败', err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/config/:type', authenticateToken, async (req, res) => {
    const { type } = req.params;
    const { module: moduleFilter } = req.query;

    const TABLE_MAP = {
        product_types: { table: 'ref_product_types', hasModule: true, hasIsActive: true },
        markets: { table: 'ref_target_markets', hasModule: true, hasIsActive: true },
        certifications: { table: 'ref_certifications', hasModule: false, hasIsActive: true },
        pain_points: { table: 'ref_pain_point_tags', hasModule: false, hasIsActive: false },
        languages: { table: 'ref_languages', hasModule: false, hasIsActive: true },
        platforms: { table: 'ref_platforms', hasModule: false, hasIsActive: true },
        marketing_styles: { table: 'ref_marketing_styles', hasModule: false, hasIsActive: false },
        news_keywords: { table: 'ref_news_keywords', hasModule: false, hasIsActive: true },
        global_config: { table: 'app_global_config', hasModule: false, hasIsActive: false },
    };

    const meta = TABLE_MAP[type];
    if (!meta) {
        return res.status(400).json({ success: false, message: `不支持的配置类型: ${type}` });
    }

    try {
        let query, params = [];

        if (meta.table === 'app_global_config') {
            query = `SELECT config_key, config_value, description FROM app_global_config ORDER BY config_key`;
        } else if (meta.table === 'ref_news_keywords') {
            query = `SELECT id, group_name, keyword, sort_order, creator FROM ref_news_keywords ORDER BY group_name, sort_order, id`;
        } else if (meta.hasModule && moduleFilter) {
            query = `SELECT * FROM ${meta.table} WHERE module = $1 ORDER BY sort_order, id`;
            params = [moduleFilter];
        } else {
            query = `SELECT * FROM ${meta.table} ORDER BY sort_order, id`;
        }

        const result = await pool.query(query, params);
        return res.json({ success: true, data: result.rows });
    } catch (err) {
        logger.error(`[PG] /api/config/${type} 查询失败`, err);
        return res.status(500).json({ success: false, message: '数据库查询失败', error: err.message });
    }
});

/** PUT /api/config/global_config/:key  单条更新全局配置 */
app.put('/api/config/global_config/:key', authenticateToken, async (req, res) => {
    const { key } = req.params;
    const { value, description } = req.body;
    try {
        await pool.query(
            `INSERT INTO app_global_config (config_key, config_value, description, updated_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (config_key) DO UPDATE
               SET config_value = EXCLUDED.config_value,
                   description  = COALESCE(EXCLUDED.description, app_global_config.description),
                   updated_at   = NOW()`,
            [key, value, description || null]
        );
        return res.json({ success: true });
    } catch (err) {
        logger.error('[PG] 全局配置更新失败', err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

/** [ADMIN] PUT /api/admin/config/ai_fields/:id 更新生图场景字段选项 */
app.put('/api/admin/config/ai_fields/:id', authenticateToken, async (req, res) => {
    // 权限检查
    if (req.user?.role !== 'admin') {
        return res.status(403).json({ success: false, message: '权限不足，仅管理员可维护底层配置' });
    }
    const { id } = req.params;
    const { options } = req.body;

    if (!Array.isArray(options)) {
        return res.status(400).json({ success: false, message: '期望接收 JSON 数组格式的 options' });
    }

    try {
        await pool.query(
            `UPDATE ref_ai_scene_fields SET options = $1, updated_at = NOW() WHERE field_id = $2`,
            [JSON.stringify(options), id]
        );
        logAudit(req, { module: 'SYSTEM_CONFIG', action: 'UPDATE_AI_FIELD', target_data: id, details: { options } });
        return res.json({ success: true });
    } catch (err) {
        logger.error('[PG] 更新 AI 场景字段失败', err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

// ============================================================
// ■ 每日推送偏好 — 优先使用 JSON 文件存储 (应用户要求读取完整配置)
// ============================================================

/** GET /api/news/preferences  读取推送偏好 */
app.get('/api/news/preferences', authenticateToken, (req, res) => {
    res.json(getNewsPrefs());
});

/** POST /api/news/preferences  保存推送偏好 */
app.post('/api/news/preferences', authenticateToken, (req, res) => {
    try {
        const { defaultIndustry, countLimit, pushTime } = req.body;
        const newPrefs = {
            defaultIndustry: defaultIndustry || 'AI、人工智能、大模型',
            countLimit: countLimit || 12,
            pushTime: pushTime || '08:30'
        };
        fs.writeFileSync(NEWS_PREFS_PATH, JSON.stringify(newPrefs, null, 2), 'utf-8');
        console.log('[Prefs] 更新成功(JSON):', newPrefs);
        res.json({ success: true, data: newPrefs });
    } catch (e) {
        console.error('[Prefs] 保存失败:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});


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
app.get('/api/order-recognition/history', authenticateToken, async (req, res) => {
    try {
        const userId = await getUserId(req);
        const result = await pool.query(
            `SELECT * FROM sys_order_recognitions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
            [userId]
        );
        const list = result.rows.map(row => ({
            id: row.id,
            timestamp: new Date(row.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
            fileName: row.file_name,
            fileUrl: row.file_url,
            fileType: row.file_type,
            customerName: row.customer_name,
            summary: row.summary,
            fullContent: row.full_content
        }));
        res.json({ success: true, data: list });
    } catch (err) {
        logger.error('[material-quote] Fetch history error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/** POST /api/order-recognition/history  保存报价记录到数据库 */
app.post('/api/order-recognition/history', authenticateToken, async (req, res) => {
    try {
        const userId = await getUserId(req);
        const { id, fileName, fileUrl, fileType, customerName, summary, fullContent } = req.body;

        await pool.query(`
            INSERT INTO sys_order_recognitions (id, user_id, file_name, file_url, file_type, customer_name, summary, full_content)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (id) DO UPDATE SET
            customer_name = EXCLUDED.customer_name,
            summary = EXCLUDED.summary,
            full_content = EXCLUDED.full_content
        `, [id || `mq-${Date.now()}`, userId, fileName, fileUrl, fileType, customerName, summary, fullContent]);

        res.json({ success: true });
    } catch (err) {
        logger.error('[material-quote] Save history error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/** POST /api/order-recognition/memory  将纠错记录保存到 Dify 知识库 */
app.post('/api/order-recognition/memory', authenticateToken, async (req, res) => {
    try {
        const apiKey = process.env.DIFY_MEMORY_API_KEY || process.env.DIFY_KNOWLEDGE_API_KEY;
        const datasetId = '17482fe4-8818-4570-9cf6-7d30d14de84f';
        const baseUrl = process.env.DIFY_API_BASE_URL || 'http://39.108.221.22/v1';
        
        if (!apiKey) return res.status(503).json({ error: '未配置知识库 API Key' });

        const { customerName, ocrName, materialNo, materialName, materialSpec } = req.body;
        
        const textContent = `客户：${customerName}
OCR识别：${ocrName}
纠错物料编码：${materialNo}
纠错物料名称：${materialName}
纠错规格：${materialSpec}`;

        const difyRes = await fetch(`${baseUrl}/datasets/${datasetId}/document/create_by_text`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: `[纠错] ${customerName} - ${ocrName}`,
                text: textContent,
                indexing_technique: 'economy',
                process_rule: {
                    mode: 'automatic'
                }
            })
        });

        if (!difyRes.ok) {
            const errData = await difyRes.text();
            throw new Error(`Dify API Error: ${errData}`);
        }

        res.json({ success: true, message: '已加入纠错记忆库' });
    } catch (err) {
        logger.error('[order-recognition] Save memory error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/** DELETE /api/order-recognition/history/:id  删除单条记录（同步删除对应上传文件） */
app.delete('/api/order-recognition/history/:id', authenticateToken, async (req, res) => {
    try {
        const userId = await getUserId(req);
        // 先查出文件路径
        const fileRow = await pool.query(
            'SELECT file_url FROM sys_order_recognitions WHERE id = $1 AND user_id = $2',
            [req.params.id, userId]
        );
        if (fileRow.rows.length > 0 && fileRow.rows[0].file_url) {
            const fileUrl = fileRow.rows[0].file_url; // e.g. /uploads/material-quote/xxx.pdf
            // 将 URL 转为服务器本地绝对路径
            const relativePath = fileUrl.startsWith('/') ? fileUrl.slice(1) : fileUrl;
            const absPath = path.join(__dirname, '..', 'public', relativePath.replace(/^\//, ''));
            // 尝试删除文件，不存在则忽略
            fs.unlink(absPath, (unlinkErr) => {
                if (unlinkErr && unlinkErr.code !== 'ENOENT') {
                    logger.warn('[material-quote] 删除文件失败: ' + absPath + ' - ' + unlinkErr.message);
                }
            });
        }
        await pool.query('DELETE FROM sys_order_recognitions WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/** DELETE /api/order-recognition/history  清空当前用户所有记录（同步删除所有上传文件） */
app.delete('/api/order-recognition/history', authenticateToken, async (req, res) => {
    try {
        const userId = await getUserId(req);
        // 先查出所有文件路径
        const fileRows = await pool.query(
            'SELECT file_url FROM sys_order_recognitions WHERE user_id = $1 AND file_url IS NOT NULL',
            [userId]
        );
        // 批量删除物理文件
        fileRows.rows.forEach(row => {
            if (row.file_url) {
                const relativePath = row.file_url.startsWith('/') ? row.file_url.slice(1) : row.file_url;
                const absPath = path.join(__dirname, '..', 'public', relativePath.replace(/^\//, ''));
                fs.unlink(absPath, (unlinkErr) => {
                    if (unlinkErr && unlinkErr.code !== 'ENOENT') {
                        logger.warn('[material-quote] 批量删除文件失败: ' + absPath + ' - ' + unlinkErr.message);
                    }
                });
            }
        });
        await pool.query('DELETE FROM sys_order_recognitions WHERE user_id = $1', [userId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/** POST /api/order-recognition/analyze  物料报价与风控核算分析 */
app.post('/api/order-recognition/analyze', authenticateToken, async (req, res) => {
    try {
        const { customerName, baseCopperPrice, items } = req.body;
        if (!customerName || !items || !Array.isArray(items)) {
            return res.status(400).json({ success: false, error: '缺少必要参数 customerName 或 items' });
        }
        const enrichedItems = await analyzeMaterialQuote(pool, {
            customerName,
            baseCopperPrice: parseFloat(baseCopperPrice) || 73.4,
            items
        });
        res.json({ success: true, items: enrichedItems });
    } catch (err) {
        logger.error('[material-quote] Analyze error: ' + err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

const COPPER_PRICE_CACHE_PATH = path.join(__dirname, '../public', 'copper_price_cache.json');

/** GET /api/order-recognition/copper-price  获取缓存的最新铜价 */
app.get('/api/order-recognition/copper-price', authenticateToken, async (req, res) => {
    try {
        if (fs.existsSync(COPPER_PRICE_CACHE_PATH)) {
            const data = fs.readFileSync(COPPER_PRICE_CACHE_PATH, 'utf-8');
            res.json({ success: true, data: JSON.parse(data) });
        } else {
            res.json({ success: true, data: { price: null, fetched_at: null } });
        }
    } catch (err) {
        logger.error('[order-recognition] copper-price get error: ' + err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/** POST /api/order-recognition/copper-price/update  执行脚本获取最新铜价并缓存 */
app.post('/api/order-recognition/copper-price/update', authenticateToken, async (req, res) => {
    try {
        const { spawn } = await import('child_process');
        const scriptPath = path.join(__dirname, '../scripts/copper_price/sme_copper_price.py');
        const pyProcess = spawn('python', [scriptPath], {
            env: { ...process.env, PYTHONIOENCODING: 'utf8' }
        });
        
        let resultData = '';
        
        pyProcess.stdout.on('data', (data) => {
            resultData += data.toString();
        });
        
        pyProcess.on('close', (code) => {
            if (code === 0) {
                try {
                    const parsed = JSON.parse(resultData);
                    fs.writeFileSync(COPPER_PRICE_CACHE_PATH, JSON.stringify(parsed, null, 2), 'utf-8');
                    res.json({ success: true, data: parsed });
                } catch (e) {
                    res.status(500).json({ success: false, error: '解析铜价数据失败' });
                }
            } else {
                res.status(500).json({ success: false, error: '执行获取铜价脚本失败' });
            }
        });
    } catch (err) {
        logger.error('[order-recognition] copper-price update error: ' + err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/** GET /api/order-recognition/search-material  模糊搜索ERP物料库 */
app.get('/api/order-recognition/search-material', authenticateToken, async (req, res) => {
    try {
        const q = (req.query.q || '').toString().trim();
        if (!q) return res.json({ success: true, items: [] });

        const keywords = q.split(/\s+/).filter(k => k);
        let whereClauses = [];
        let params = [];
        let paramIndex = 1;

        for (const kw of keywords) {
            whereClauses.push(`(itemno ILIKE $${paramIndex} OR itemname ILIKE $${paramIndex} OR descript ILIKE $${paramIndex})`);
            params.push(`%${kw}%`);
            paramIndex++;
        }

        const result = await pool.query(
            `SELECT itemno, itemname, descript
             FROM t_jy_material
             WHERE ${whereClauses.join(' AND ')}
             ORDER BY
               CASE WHEN itemno ILIKE $1 THEN 0
                    WHEN itemname ILIKE $1 THEN 1
                    ELSE 2 END,
               itemname, descript
             LIMIT 50`,
            params
        );
        res.json({ success: true, items: result.rows });
    } catch (err) {
        logger.error('[order-recognition] search-material error: ' + err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/** POST /api/material-quote/sync-erp  审核并一键同步到 ERP 内部订单 */
app.post('/api/material-quote/sync-erp', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    try {
        const { customerName, copperPriceType = '现货价', copperBasePrice = 73.4, items } = req.body;
        if (!customerName || !items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, error: '缺少订单必要参数' });
        }

        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const randomNum = Math.floor(100 + Math.random() * 900);
        const orderId = `SO-${dateStr}${randomNum}`;

        await client.query('BEGIN');

        for (const item of items) {
            let materialNo = item.material_no;
            // 映射为标准料号以关联工艺参数、可用库存和机台并满足外键约束
            if (materialNo === '物料1') {
                materialNo = 'Mat-YJV4x25';
            } else if (materialNo === '物料2') {
                materialNo = 'Mat-VV4x50';
            } else if (materialNo === '物料3') {
                materialNo = 'Mat-YJV4x16';
            } else if (!['Mat-YJV4x25', 'Mat-YJV4x16', 'Mat-BV2.5', 'Mat-VV4x50'].includes(materialNo)) {
                materialNo = 'Mat-YJV4x25';
            }

            const qty = parseFloat(item.qty) || 1000.00;
            const unitPrice = parseFloat(item.unit_price) || 0.00;
            
            let unitWeight = 1.0;
            try {
                const specRes = await client.query('SELECT standard_unit_weight FROM sys_mock_material_specs WHERE material_no = $1', [materialNo]);
                if (specRes.rowCount > 0 && specRes.rows[0].standard_unit_weight) {
                    unitWeight = parseFloat(specRes.rows[0].standard_unit_weight);
                }
            } catch (err) {
                console.error('[server] Fetch spec weight error:', err);
            }
            const totalAmount = parseFloat((qty * unitWeight * unitPrice).toFixed(2));

            // A. 查询成品备货库存表，按照 FOR UPDATE 锁定，并尝试进行占用/锁库
            const stockRes = await client.query(
                `SELECT id, qty_on_hand, qty_allocated, warehouse_name 
                 FROM sys_mock_material_stock 
                 WHERE material_no = $1 
                 ORDER BY (qty_on_hand - qty_allocated) DESC 
                 FOR UPDATE`,
                [materialNo]
            );

            let remainingQtyToAllocate = qty;
            if (stockRes.rowCount > 0) {
                for (const row of stockRes.rows) {
                    if (remainingQtyToAllocate <= 0) break;
                    const onHand = parseFloat(row.qty_on_hand);
                    const allocated = parseFloat(row.qty_allocated);
                    const available = onHand - allocated;

                    if (available > 0) {
                        const allocateAmt = Math.min(remainingQtyToAllocate, available);
                        await client.query(
                            'UPDATE sys_mock_material_stock SET qty_allocated = qty_allocated + $1 WHERE id = $2',
                            [allocateAmt, row.id]
                        );
                        remainingQtyToAllocate -= allocateAmt;
                    }
                }
            }

            // B. 针对该物料料号，智能识别适用的机台队列负载 (选取出空闲度最高且能力适用的机台进行分配)
            let assignedMachine = 'Ext-03';
            const machineRes = await client.query(
                'SELECT machine_id, machine_name, capable_specs, current_load_percent, last_produced_spec FROM sys_mock_machine_queues'
            );
            if (machineRes.rowCount > 0) {
                const candidates = [];
                for (const mRow of machineRes.rows) {
                    const capableSpecs = mRow.capable_specs.split(',');
                    if (capableSpecs.includes(materialNo)) {
                        const load = parseInt(mRow.current_load_percent);
                        let bonus = 0;
                        if (mRow.last_produced_spec === materialNo) {
                            bonus = 30;
                        }
                        candidates.push({
                            machine_id: mRow.machine_id,
                            score: (100 - load) + bonus
                        });
                    }
                }
                if (candidates.length > 0) {
                    candidates.sort((a, b) => b.score - a.score);
                    assignedMachine = candidates[0].machine_id;
                }
            }

            // C. 评估计算交期
            const leadTimeRes = await client.query(
                'SELECT queue_duration_hours, standard_lead_time_km FROM sys_mock_machine_queues WHERE machine_id = $1',
                [assignedMachine]
            );
            let totalHours = 8.0;
            if (leadTimeRes.rowCount > 0) {
                const row = leadTimeRes.rows[0];
                const queueHours = parseFloat(row.queue_duration_hours);
                const leadSpeed = parseFloat(row.standard_lead_time_km);
                totalHours = queueHours + (qty / 1000.0) * leadSpeed;
            }
            const workingDays = Math.ceil(totalHours / 8.0);
            const deliveryDateObj = new Date(Date.now() + (workingDays + 1) * 24 * 60 * 60 * 1000);
            const deliveryDate = deliveryDateObj.toISOString().split('T')[0];

            // D. 插入记录到 sys_mock_erp_orders 表
            await client.query(
                `INSERT INTO sys_mock_erp_orders (id, customer_name, material_no, qty, unit_price, total_amount, delivery_date, copper_price_type, copper_base_price, machine_assigned)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                [orderId, customerName, materialNo, qty, unitPrice, totalAmount, deliveryDate, copperPriceType, parseFloat(copperBasePrice), assignedMachine]
            );
        }

        await client.query('COMMIT');
        logger.info(`[material-quote] 一键同步 ERP 成功。已生成订单号: ${orderId}，已进行锁定并扣减库存。`);
        res.json({ success: true, orderId });
    } catch (err) {
        await client.query('ROLLBACK');
        logger.error('[material-quote] ERP Sync error: ' + err.message);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});


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

/** GET /api/notifications - 拉取当前登录用户的通知列表 */
app.get('/api/notifications', authenticateToken, async (req, res) => {
    try {
        const userId = await getUserId(req);
        if (!userId) return res.status(401).json({ success: false, message: '无法识别用户身份' });

        const result = await pool.query(`SELECT * FROM sys_notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`, [userId]);

        const formatItem = (row) => ({
            id: row.id,
            userId: row.user_id,
            appId: row.app_id,
            appName: row.app_name,
            title: row.title,
            message: row.message,
            isRead: row.is_read,
            timestamp: new Date(row.created_at).getTime()
        });

        res.json({ success: true, data: result.rows.map(formatItem) });
    } catch (e) {
        logger.error('[PG] Get notifications error:', e);
        res.status(500).json({ success: false, message: '获取通知失败' });
    }
});

/** POST /api/notifications - 发送推送系统通知给指定用户 */
app.post('/api/notifications', authenticateToken, async (req, res) => {
    try {
        const userId = await getUserId(req);
        if (!userId) return res.status(401).json({ success: false, message: '无法识别用户身份' });

        const { id, appId, appName, title, message } = req.body;
        const newId = id || `n-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        await pool.query(`
            INSERT INTO sys_notifications (id, user_id, app_id, app_name, title, message)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (id) DO NOTHING
        `, [newId, userId, appId || '', appName || 'System', title || '', message || '']);
        res.json({ success: true, id: newId });
    } catch (e) {
        logger.error('[PG] Save notification error:', e);
        res.status(500).json({ success: false, message: '存储通知失败' });
    }
});

/** PUT /api/notifications/:id/read - 标记通知为已读 */
app.put('/api/notifications/:id/read', authenticateToken, async (req, res) => {
    try {
        const userId = await getUserId(req);
        await pool.query(`UPDATE sys_notifications SET is_read = TRUE, updated_at = NOW() WHERE id = $1 AND user_id = $2`, [req.params.id, userId]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

/** DELETE /api/notifications/:id - 删除单条通知 */
app.delete('/api/notifications/:id', authenticateToken, async (req, res) => {
    try {
        const userId = await getUserId(req);
        await pool.query(`DELETE FROM sys_notifications WHERE id = $1 AND user_id = $2`, [req.params.id, userId]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

/** DELETE /api/notifications - 清空当前用户所有通知 */
app.delete('/api/notifications', authenticateToken, async (req, res) => {
    try {
        const userId = await getUserId(req);
        await pool.query(`DELETE FROM sys_notifications WHERE user_id = $1`, [userId]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});





// ============================================================
// ■ 视频生成模块：B站分析 + Dify分镜生成
// ============================================================
app.post('/api/videogen/generate', authenticateToken, async (req, res) => {
    const { query } = req.body;
    if (!query || !query.trim()) {
        return res.status(400).json({ success: false, message: '请提供视频生成需求描述' });
    }

    const apiKey = process.env.DIFY_VIDEOGEN_API_KEY;
    const apiUrl = process.env.DIFY_VIDEOGEN_API_URL;

    if (!apiKey || apiKey === 'app-xxxxxxxxxxxxxxxxxxxxxxxx') {
        return res.status(500).json({ success: false, message: '请先在 .env 中配置 DIFY_VIDEOGEN_API_KEY' });
    }

    const rpaScriptPath = path.join(__dirname, '../RPA/bilibili_search_drission.py');
    const resultsJsonPath = path.join(__dirname, '../RPA/bilibili_detailed_results.json');

    // ── 步骤 1：执行 bilibili_search_drission.py ──
    logger.info(`[VideoGen] 开始执行 RPA 脚本，关键词：${query}`);
    try {
        await new Promise((resolve, reject) => {
            const pythonProcess = spawn('python', [rpaScriptPath], {
                env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
                cwd: path.join(__dirname, '../RPA')
            });

            let stderr = '';
            pythonProcess.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            pythonProcess.on('close', (code) => {
                if (code !== 0) {
                    logger.error(`[VideoGen RPA] 脚本退出码: ${code}, stderr: ${stderr}`);
                    // 非零退出码时仍尝试继续（结果文件可能已部分生成）
                }
                resolve(null);
            });
            pythonProcess.on('error', (err) => {
                reject(new Error(`RPA 脚本启动失败: ${err.message}`));
            });
        });
    } catch (rpaErr) {
        logger.error('[VideoGen] RPA 启动失败: ' + rpaErr.message);
        return res.status(500).json({ success: false, message: `RPA 脚本执行失败: ${rpaErr.message}` });
    }

    // ── 步骤 2：读取 bilibili_detailed_results.json ──
    let bilibiliData = [];
    try {
        if (fs.existsSync(resultsJsonPath)) {
            const raw = fs.readFileSync(resultsJsonPath, 'utf-8');
            bilibiliData = JSON.parse(raw);
            logger.info(`[VideoGen] 读取到 B站分析结果 ${bilibiliData.length} 条`);
        } else {
            logger.warn('[VideoGen] bilibili_detailed_results.json 不存在，将以空数据继续调用 Dify');
        }
    } catch (parseErr) {
        logger.warn('[VideoGen] 解析 bilibili_detailed_results.json 失败: ' + parseErr.message);
    }

    // 构建传给 Dify 的上下文：取前3条视频的核心信息
    const contextSnippet = bilibiliData.slice(0, 3).map((item, i) => {
        return `【热门视频${i + 1}】标题：${item.title || ''}，简介：${(item.description || '').slice(0, 100)}，AI总结：${(item.ai_summary || '').slice(0, 200)}`;
    }).join('\n');

    const difyQuery = `用户需求：${query}\n\nB站热门视频参考数据：\n${contextSnippet || '（暂无参考数据，请根据需求直接生成）'}\n\n请根据以上信息生成5个分镜脚本，以JSON数组返回。`;

    // ── 步骤 3：调用 Dify Chatflow ──
    logger.info('[VideoGen] 开始调用 Dify Chatflow...');
    let rawAnswer = '';
    try {
        const difyRes = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: {},
                query: difyQuery,
                response_mode: 'blocking',
                user: req.user?.username || 'system-user'
            })
        });

        const difyData = await difyRes.json();
        if (!difyRes.ok) {
            throw new Error(`Dify 调用失败: ${difyData.message || JSON.stringify(difyData)}`);
        }
        rawAnswer = difyData.answer || '';
        logger.info(`[VideoGen] Dify 返回成功，answer 长度: ${rawAnswer.length}`);
    } catch (difyErr) {
        logger.error('[VideoGen] Dify 调用失败: ' + difyErr.message);
        return res.status(500).json({ success: false, message: `AI 分镜生成失败: ${difyErr.message}` });
    }

    // ── 步骤 4：解析 Dify 返回的 JSON 数组 ──
    let scenes = [];
    try {
        // 尝试从 answer 中提取 JSON 数组（兼容 Markdown 代码块格式）
        const jsonMatch = rawAnswer.match(/```json\s*([\s\S]*?)```/) || rawAnswer.match(/(\[[\s\S]*\])/);
        const jsonStr = jsonMatch ? jsonMatch[1] : rawAnswer;
        scenes = JSON.parse(jsonStr.trim());
        if (!Array.isArray(scenes)) throw new Error('返回格式不是数组');
    } catch (parseErr) {
        logger.error('[VideoGen] 解析 Dify 返回 JSON 失败: ' + parseErr.message + '\n原始内容: ' + rawAnswer.slice(0, 500));
        return res.status(500).json({ success: false, message: 'AI 返回格式解析失败，请检查 Dify 配置确保输出标准 JSON 数组' });
    }

    // ── 步骤 5：映射为前端 StoryboardCard 格式 ──
    const storyboards = scenes.map((scene) => ({
        id: Math.random().toString(36).substring(2, 9),
        description: scene.scene_description || '',
        script: scene.narration || '',
        imagePrompt: scene.image_prompt || '',
        cameraPrompt: scene.video_motion_prompt || '',
        imageStatus: 'idle',
        imageUrl: ''
    }));

    logger.info(`[VideoGen] 成功生成 ${storyboards.length} 个分镜`);
    res.json({ success: true, storyboards });
});

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
app.post('/api/tender-search/run', authenticateToken, async (req, res) => {
    try {
        const { time_range, top_n, begin_date, end_date } = req.body;
        logAudit(req, {
            module: 'TENDER_SEARCH',
            action: 'RUN_SEARCH',
            details: { time_range, top_n, begin_date, end_date }
        });
        // ── D4 试点迁移（TASK_CENTER_PILOT 含 tender_search 时启用）──────────
        // 建任务 → 执行 → 通知闭环 → 结果解析+去重+入库（与旧路径同一共享模块）。
        if (legacyBridge.isPilotSkill('tender_search')) {
            const inputs = {};
            if (time_range !== undefined && time_range !== null && time_range !== '') inputs.time_range = String(time_range);
            if (top_n !== undefined && top_n !== null && top_n !== '') inputs.top_n = String(top_n);
            if (begin_date !== undefined && begin_date !== null && begin_date !== '') inputs.begin_date = String(begin_date);
            if (end_date !== undefined && end_date !== null && end_date !== '') inputs.end_date = String(end_date);
            const r = await legacyBridge.runThroughTaskCenter({
                skillKey: 'tender_search',
                title: `招标检索：${inputs.time_range || inputs.begin_date || '默认范围'}`,
                user: req.user,
                inputs,
            });
            if (!r.ok) {
                console.error(`[招标检索-任务中心] ${r.taskNo} 失败 ${r.errorCode}: ${r.message}`);
                return res.status(500).json({ success: false, message: `任务执行失败（${r.taskNo}）：${r.message}` });
            }
            return res.json(await ingestTenderOutputs(r.outputs ?? {}));
        }

        const result = await runTenderSearchDify({
            user: req.user?.username || 'web_os_user',
            time_range, top_n, begin_date, end_date
        });
        const status = result.success ? 200 : 500;
        res.status(status).json(result);
    } catch (error) {
        console.error('[招标检索 Error] ' + error.message);
        res.status(500).json({ success: false, message: error.message || '招标检索服务内部错误' });
    }
});

// 分页查询招标数据
app.get('/api/tender-search/list', authenticateToken, async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const pageSize = Math.max(1, Math.min(100, parseInt(req.query.page_size) || 20));
        const offset = (page - 1) * pageSize;
        const bidderName = req.query.bidder_name || '';
        const projectName = req.query.project_name || '';
        const region = req.query.region || '';
        const bizType = req.query.biz_type || '';
        const starredOnly = req.query.starred_only === 'true';

        let whereClauses = [];
        let params = [];
        let paramIdx = 1;

        if (bidderName) {
            whereClauses.push('bidder_name ILIKE $' + paramIdx);
            params.push('%' + bidderName + '%');
            paramIdx++;
        }
        if (projectName) {
            whereClauses.push('project_name ILIKE $' + paramIdx);
            params.push('%' + projectName + '%');
            paramIdx++;
        }
        if (region) {
            whereClauses.push('region ILIKE $' + paramIdx);
            params.push('%' + region + '%');
            paramIdx++;
        }
        if (bizType) {
            whereClauses.push('biz_type = $' + paramIdx);
            params.push(bizType);
            paramIdx++;
        }
        if (starredOnly) {
            whereClauses.push('is_starred = TRUE');
        }

        const whereStr = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

        // 总数
        const countRes = await pool.query('SELECT COUNT(*) FROM sys_tender_results ' + whereStr, params);
        const total = parseInt(countRes.rows[0].count) || 0;

        // 分页数据
        const dataRes = await pool.query(
            'SELECT id, batch_id, bid_id, bid_no, bidder_name, project_name, biz_type, project_amount, channel_type, region, bidder_count, budget_amount, file_acquire_time, file_acquire_method, bid_doc_fee, deadline, bid_method, source_site, link, candidate_names, winning_company, winning_amount, announcement_date, is_starred, synced_at, sync_status, created_at FROM sys_tender_results ' + whereStr + ' ORDER BY id DESC LIMIT $' + paramIdx + ' OFFSET $' + (paramIdx + 1),
            [...params, pageSize, offset]
        );

        res.json({
            success: true,
            total,
            page,
            page_size: pageSize,
            total_pages: Math.ceil(total / pageSize),
            items: dataRes.rows
        });
    } catch (error) {
        console.error('[招标检索] 查询失败: ' + error.message);
        res.status(500).json({ success: false, message: error.message || '查询失败' });
    }
});

// 切换星标状态
app.put('/api/tender-search/star/:id', authenticateToken, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (!id) return res.status(400).json({ success: false, message: '无效的 ID' });
        const { starred } = req.body; // true or false
        const newStatus = starred === true || starred === 'true';
        await pool.query('UPDATE sys_tender_results SET is_starred = $1 WHERE id = $2', [newStatus, id]);
        res.json({ success: true, id, is_starred: newStatus });
    } catch (error) {
        console.error('[招标检索] 星标操作失败: ' + error.message);
        res.status(500).json({ success: false, message: error.message || '操作失败' });
    }
});

// 手动触发星标记录详情同步
app.post('/api/tender-search/sync-detail', authenticateToken, async (req, res) => {
    try {
        logAudit(req, {
            module: 'TENDER_SEARCH',
            action: 'SYNC_DETAIL'
        });
        const result = await syncTenderStarredDetail({
            user: req.user?.username || 'web_os_user'
        });
        const status = result.success ? 200 : 500;
        res.status(status).json(result);
    } catch (error) {
        console.error('[招标检索] 详情同步失败: ' + error.message);
        res.status(500).json({ success: false, message: error.message || '同步失败' });
    }
});

// 上传文件到知识库
app.post('/api/tender-search/upload-to-knowledge', authenticateToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: '未找到文件数据' });
        }
        // 修复中文文件名乱码：multer 返回的 originalname 是 latin1 编码，需转为 utf8
        const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');

        logAudit(req, {
            module: 'TENDER_SEARCH',
            action: 'UPLOAD_TO_KNOWLEDGE',
            target_data: originalName
        });

        const result = await difyKnowledgeService.createByFile(
            req.file.path,
            originalName,
            req.user?.username || 'web_os_user',
            'tender_knowledge',
            req.file.mimetype,
            'custom'
        );

        res.json({ success: true, message: '上传成功', data: result });
    } catch (error) {
        console.error('[招标检索] 上传到知识库失败: ' + error.message);
        res.status(500).json({ success: false, message: error.message || '上传失败' });
    } finally {
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
    }
});

// ============================================================
// ■ 选品策略模块路由
// ============================================================

// 选品策略 - 文件上传中转（文件 → Dify upload_file_id）
app.post('/api/product-selection/upload', authenticateToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: '未收到文件' });

        const apiKey = process.env.DIFY_PRODUCT_SELECTION_API_KEY;
        let apiUrl = process.env.DIFY_PRODUCT_SELECTION_API_URL;
        if (!apiKey || !apiUrl) return res.status(503).json({ success: false, message: 'Dify 未配置' });

        const baseUrl = apiUrl.replace(/\/$/, '');
        const fileContent = fs.readFileSync(req.file.path);
        const { Blob: NodeBlob } = await import('buffer');
        const blob = new NodeBlob([fileContent], { type: req.file.mimetype });

        const formData = new FormData();
        formData.append('file', blob, req.file.originalname);
        formData.append('user', req.user?.username || 'web_os_user');

        const difyRes = await fetch(`${baseUrl}/files/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}` },
            body: formData
        });

        const resText = await difyRes.text();
        if (!difyRes.ok) {
            console.error(`[选品策略上传] Dify 失败: ${difyRes.status}, ${resText.substring(0, 300)}`);
            return res.status(difyRes.status).json({ success: false, message: `Dify 上传失败 (${difyRes.status})` });
        }

        const data = JSON.parse(resText);

        res.json({ success: true, upload_file_id: data.id, filename: req.file.originalname, mimetype: req.file.mimetype });
    } catch (e) {
        console.error('[选品策略上传] 错误:', e.message);
        res.status(500).json({ success: false, message: e.message });
    } finally {
        if (req.file?.path) {
            try { fs.unlinkSync(req.file.path); } catch (e) { }
        }
    }
});

// 选品策略 - 发送对话消息（SSE 流式返回）
app.post('/api/product-selection/chat', authenticateToken, async (req, res) => {
    try {
        const { conversation_id, message, files: uploadFiles } = req.body;
        const userId = req.user?.id;
        const caller = req.user?.username || 'web_os_user';

        if (!message && (!uploadFiles || uploadFiles.length === 0)) {
            return res.status(400).json({ success: false, message: '消息内容不能为空' });
        }

        const apiKey = process.env.DIFY_PRODUCT_SELECTION_API_KEY;
        let apiUrl = process.env.DIFY_PRODUCT_SELECTION_API_URL;
        if (!apiKey || !apiUrl) {
            return res.status(503).json({ success: false, message: 'Dify 未配置' });
        }
        const baseUrl = apiUrl.replace(/\/$/, '');
        const chatUrl = `${baseUrl}/chat-messages`;

        // 获取或创建会话
        let convId = conversation_id;
        if (!convId) {
            const title = (message || '新对话').substring(0, 20);
            const convResult = await pool.query(
                `INSERT INTO sys_product_selection_conversations (user_id, title, created_at, updated_at) VALUES ($1, $2, NOW(), NOW()) RETURNING id`,
                [userId, title]
            );
            convId = convResult.rows[0].id;
        } else {
            await pool.query(`UPDATE sys_product_selection_conversations SET updated_at = NOW() WHERE id = $1 AND user_id = $2`, [convId, userId]);
        }

        // 保存用户消息
        await pool.query(
            `INSERT INTO sys_product_selection_messages (conversation_id, role, content, files, created_at) VALUES ($1, 'user', $2, $3, NOW())`,
            [convId, message || '', uploadFiles ? JSON.stringify(uploadFiles) : null]
        );

        // 构造 Dify 请求
        // files 为顶层参数，不能放在 inputs 里
        const difyFiles = uploadFiles && uploadFiles.length > 0
            ? uploadFiles.map(f => ({
                type: f.mimetype?.startsWith('image/') ? 'image' : 'document',
                transfer_method: 'local_file',
                upload_file_id: f.upload_file_id
            }))
            : undefined;

        // 查询 Dify conversation_id 用于多轮对话上下文
        let difyConvId = '';
        if (convId) {
            const existingConv = await pool.query(
                `SELECT dify_conversation_id FROM sys_product_selection_conversations WHERE id = $1`,
                [convId]
            );
            if (existingConv.rows[0]?.dify_conversation_id) {
                difyConvId = existingConv.rows[0].dify_conversation_id;
            }
        }

        const payload = {
            inputs: {},
            query: message || '请分析上传的文件',
            response_mode: 'streaming',
            conversation_id: difyConvId,
            user: caller,
            ...(difyFiles && difyFiles.length > 0 && { files: difyFiles })
        };

        console.log(`[选品策略] 开始调用 Dify (streaming), 会话ID: ${convId}`);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 130000);

        let difyRes;
        try {
            difyRes = await fetch(chatUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload),
                signal: controller.signal
            });
        } finally {
            clearTimeout(timeout);
        }

        if (!difyRes.ok) {
            const errChunks = [];
            for await (const chunk of difyRes.body) { errChunks.push(Buffer.from(chunk)); }
            const errText = Buffer.concat(errChunks).toString('utf-8');
            console.error(`[选品策略 Dify 报错] ${difyRes.status}: ${errText.substring(0, 500)}`);
            return res.status(difyRes.status).json({ success: false, message: `Dify 调用失败 (${difyRes.status})` });
        }

        // SSE 响应头
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');

        const reader = difyRes.body.getReader();
        const decoder = new TextDecoder();
        let fullAnswer = '';
        let sseBuffer = '';
        let taskId = '';
        let assistantSaved = false;

        // 空闲超时保护
        let idleTimer;
        let isIdleTimeout = false;
        const resetIdleTimer = () => {
            clearTimeout(idleTimer);
            idleTimer = setTimeout(() => { isIdleTimeout = true; controller.abort(); }, 60000);
        };
        resetIdleTimer();

        try {
            while (true) {
                resetIdleTimer();
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                sseBuffer += chunk;
                const lines = sseBuffer.split('\n');
                sseBuffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.startsWith('data:')) continue;
                    const jsonStr = line.slice(5).trim();
                    if (!jsonStr) continue;

                    try {
                        const eventData = JSON.parse(jsonStr);
                        if (eventData.task_id) taskId = eventData.task_id;

                        if (eventData.event === 'message') {
                            fullAnswer += eventData.answer || '';
                            // 保存 Dify conversation_id 用于后续多轮对话
                            if (eventData.conversation_id && !difyConvId) {
                                difyConvId = eventData.conversation_id;
                                await pool.query(
                                    `UPDATE sys_product_selection_conversations SET dify_conversation_id = $1 WHERE id = $2`,
                                    [difyConvId, convId]
                                );
                            }
                            res.write(`data: ${JSON.stringify({ event: 'message', answer: eventData.answer, task_id: taskId })}\n\n`);
                        } else if (eventData.event === 'message_end') {
                            // 流式结束，保存 AI 回复到数据库
                            await pool.query(
                                `INSERT INTO sys_product_selection_messages (conversation_id, role, content, created_at) VALUES ($1, 'assistant', $2, NOW())`,
                                [convId, fullAnswer]
                            );
                            assistantSaved = true;
                            res.write(`data: ${JSON.stringify({ event: 'complete', answer: fullAnswer, conversation_id: convId })}\n\n`);
                        } else if (eventData.event === 'error') {
                            res.write(`data: ${JSON.stringify({ event: 'error', message: eventData.message || 'Dify 错误' })}\n\n`);
                        }
                    } catch (e) {
                        console.warn(`[选品策略 SSE] 解析失败: ${jsonStr.substring(0, 100)}`, e.message);
                    }
                }
            }
        } finally {
            clearTimeout(idleTimer);
            // 流中断时（用户手动停止等），保存已收集的内容并标记 stopped
            if (!assistantSaved && fullAnswer.length > 0) {
                try {
                    await pool.query(
                        `INSERT INTO sys_product_selection_messages (conversation_id, role, content, stopped, created_at) VALUES ($1, 'assistant', $2, TRUE, NOW())`,
                        [convId, fullAnswer]
                    );
                    console.log(`[选品策略] 流中断，已保存中断内容 (${fullAnswer.length} 字符), 会话ID: ${convId}`);
                } catch (saveErr) {
                    console.warn('[选品策略] 保存中断内容失败:', saveErr.message);
                }
            } else if (!assistantSaved && fullAnswer.length === 0) {
                // 没有任何内容就中断，也插入一条空消息标记停止
                try {
                    await pool.query(
                        `INSERT INTO sys_product_selection_messages (conversation_id, role, content, stopped, created_at) VALUES ($1, 'assistant', '', TRUE, NOW())`,
                        [convId]
                    );
                } catch (saveErr) {
                    console.warn('[选品策略] 保存空停止消息失败:', saveErr.message);
                }
            }
        }

        console.log(`[选品策略] 流式响应结束, 会话ID: ${convId}, answer长度: ${fullAnswer.length}`);
        res.end();

    } catch (error) {
        const msg = error.name === 'AbortError' ? 'Dify 调用超时' : error.message || '选品策略服务内部错误';
        console.error(`[选品策略 Error] ${msg}`);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: msg });
        } else {
            res.write(`data: ${JSON.stringify({ event: 'error', message: msg })}\n\n`);
            res.end();
        }
    }
});

// 选品策略 - 停止流式生成
app.post('/api/product-selection/stop', authenticateToken, async (req, res) => {
    try {
        const { task_id, conversation_id } = req.body;
        const userId = req.user?.id;
        if (!task_id) return res.status(400).json({ success: false, message: '缺少 task_id' });

        const apiKey = process.env.DIFY_PRODUCT_SELECTION_API_KEY;
        let apiUrl = process.env.DIFY_PRODUCT_SELECTION_API_URL;
        if (!apiKey || !apiUrl) return res.status(503).json({ success: false, message: 'Dify 未配置' });

        const baseUrl = apiUrl.replace(/\/chat-messages\/?$/, '').replace(/\/$/, '');
        const stopUrl = `${baseUrl}/chat-messages/${task_id}/stop`;

        const stopRes = await fetch(stopUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ user: req.user?.username || 'web_os_user' })
        });
        const stopText = await stopRes.text();
        console.log(`[选品策略] Dify stop: ${stopRes.status}`);

        // 标记数据库中最新的 assistant 消息为已停止
        try {
            if (conversation_id) {
                await pool.query(
                    `UPDATE sys_product_selection_messages SET stopped = TRUE
                     WHERE id = (
                         SELECT id FROM sys_product_selection_messages
                         WHERE conversation_id = $1 AND role = 'assistant'
                         ORDER BY created_at DESC LIMIT 1
                     )`,
                    [conversation_id]
                );
            } else if (userId) {
                // 新会话场景：通过用户最近会话查找
                await pool.query(
                    `UPDATE sys_product_selection_messages SET stopped = TRUE
                     WHERE id = (
                         SELECT m.id FROM sys_product_selection_messages m
                         JOIN sys_product_selection_conversations c ON m.conversation_id = c.id
                         WHERE c.user_id = $1 AND m.role = 'assistant'
                         ORDER BY m.created_at DESC LIMIT 1
                     )`,
                    [userId]
                );
            }
        } catch (dbErr) {
            console.warn('[选品策略] 标记停止状态失败:', dbErr.message);
        }

        res.json({ success: stopRes.ok, message: stopText });
    } catch (e) {
        console.error('[选品策略] 停止失败:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// 选品策略 - 获取会话列表
app.get('/api/product-selection/conversations', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.json({ success: true, data: [] });
        const result = await pool.query(
            `SELECT id, title, created_at, updated_at FROM sys_product_selection_conversations WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 50`,
            [userId]
        );
        res.json({ success: true, data: result.rows });
    } catch (e) {
        console.error('[选品策略] 获取会话列表失败:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// 选品策略 - 获取某会话的全部消息
app.get('/api/product-selection/conversations/:id/messages', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id;
        // 先验证会话归属
        const conv = await pool.query(`SELECT id FROM sys_product_selection_conversations WHERE id = $1 AND user_id = $2`, [id, userId]);
        if (conv.rows.length === 0) return res.status(403).json({ success: false, message: '无权访问' });
        // 再查询消息
        const result = await pool.query(
            `SELECT id, role, content, files, stopped, created_at FROM sys_product_selection_messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
            [id]
        );
        res.json({ success: true, data: result.rows });
    } catch (e) {
        console.error('[选品策略] 获取消息失败:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// 选品策略 - 删除会话（级联删除消息）
app.delete('/api/product-selection/conversations/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id;
        // 先验证会话归属
        const conv = await pool.query(
            `SELECT id FROM sys_product_selection_conversations WHERE id = $1 AND user_id = $2`,
            [id, userId]
        );
        if (conv.rows.length === 0) return res.status(403).json({ success: false, message: '无权删除' });
        // 使用事务级联删除
        await pool.query('BEGIN');
        try {
            await pool.query(`DELETE FROM sys_product_selection_messages WHERE conversation_id = $1`, [id]);
            await pool.query(`DELETE FROM sys_product_selection_conversations WHERE id = $1`, [id]);
            await pool.query('COMMIT');
        } catch (txErr) {
            await pool.query('ROLLBACK');
            throw txErr;
        }
        res.json({ success: true });
    } catch (e) {
        console.error('[选品策略] 删除会话失败:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// 选品策略 - 更新会话标题
app.put('/api/product-selection/conversations/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { title } = req.body;
        const userId = req.user?.id;
        if (!title) return res.status(400).json({ success: false, message: '标题不能为空' });
        await pool.query(
            `UPDATE sys_product_selection_conversations SET title = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3`,
            [title.substring(0, 200), id, userId]
        );
        res.json({ success: true });
    } catch (e) {
        console.error('[选品策略] 更新标题失败:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

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
app.post('/api/quote-verify/run', authenticateToken, async (req, res) => {
    try {
        const { supplierName } = req.body;
        if (!supplierName || !supplierName.trim()) {
            return res.status(400).json({ success: false, message: '请输入供应商名称' });
        }
        logAudit(req, { module: 'QUOTE_VERIFY', action: 'RUN_VERIFY', details: { supplierName } });

        // ── D4 试点迁移（TASK_CENTER_PILOT 含 quote_verify 时启用）──────────
        // 建任务 → 执行 → 通知闭环 → 归一化输出映射回旧响应形状；未启用走旧直连。
        if (legacyBridge.isPilotSkill('quote_verify')) {
            const r = await legacyBridge.runThroughTaskCenter({
                skillKey: 'quote_verify',
                title: `核查报价：${supplierName.trim()}`,
                user: req.user,
                inputs: { supplier_name: supplierName.trim() },
            });
            if (!r.ok) {
                console.error(`[核查报价A-任务中心] ${r.taskNo} 失败 ${r.errorCode}: ${r.message}`);
                return res.status(500).json({ success: false, message: `任务执行失败（${r.taskNo}）：${r.message}` });
            }
            const text = legacyBridge.stripThinkTags(legacyBridge.extractAnswerText(r.outputs ?? {}));
            return res.json({ success: true, data: text || '未获取到有效结果' });
        }

        const apiKey = process.env.DIFY_QUOTE_VERIFY_API_KEY;
        const apiUrl = process.env.DIFY_QUOTE_VERIFY_API_URL;
        if (!apiKey || !apiUrl) {
            return res.status(500).json({ success: false, message: '服务端未配置 DIFY_QUOTE_VERIFY_API_KEY 或 DIFY_QUOTE_VERIFY_API_URL' });
        }

        const payload = {
            inputs: { supplier_name: supplierName.trim() },
            response_mode: 'blocking',
            user: req.user?.username || 'web_os_user'
        };

        const difyRes = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const chunks = [];
        if (difyRes.body) {
            for await (const chunk of difyRes.body) {
                chunks.push(Buffer.from(chunk));
            }
        }
        const resText = Buffer.concat(chunks).toString('utf-8');

        if (!difyRes.ok) {
            console.error(`[Dify 核查报价工作流A报错] 状态码: ${difyRes.status}, 响应: ${resText.substring(0, 500)}`);
            throw new Error(`Dify 工作流调用报错 (${difyRes.status}): ${resText.substring(0, 300)}`);
        }

        console.log(`[核查报价A] Dify 响应长度: ${resText.length} 字符`);

        try {
            const bodyData = JSON.parse(resText);
            let resultText = '';
            const rawOutputs = bodyData?.data?.outputs || bodyData?.data || bodyData;

            if (rawOutputs && typeof rawOutputs === 'object') {
                if (rawOutputs.text !== undefined) {
                    resultText = typeof rawOutputs.text === 'object' ? JSON.stringify(rawOutputs.text, null, 2) : String(rawOutputs.text);
                } else if (rawOutputs.result !== undefined) {
                    resultText = typeof rawOutputs.result === 'object' ? JSON.stringify(rawOutputs.result, null, 2) : String(rawOutputs.result);
                } else if (rawOutputs.output !== undefined) {
                    resultText = typeof rawOutputs.output === 'object' ? JSON.stringify(rawOutputs.output, null, 2) : String(rawOutputs.output);
                } else {
                    const firstKeyVal = Object.values(rawOutputs)[0];
                    resultText = typeof firstKeyVal === 'object' ? JSON.stringify(firstKeyVal, null, 2) : String(firstKeyVal);
                }
            }

            // 过滤 标签
            if (typeof resultText === 'string') {
                resultText = resultText.replace(/<think>[\s\S]*?<\/think>(\\n|\s)*/gi, '').trim();
                resultText = resultText.replace(/\\n/g, '\n');
            }

            res.json({ success: true, data: resultText || '未获取到有效结果' });
        } catch (parseErr) {
            console.error('[核查报价A JSON解析失败]', parseErr.message);
            throw new Error(`无法解析 Dify 响应: ${parseErr.message}`);
        }
    } catch (e) {
        console.error('[核查报价A请求失败]', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// 2. 核查报价 - 文件上传核查（工作流B）
app.post('/api/quote-verify/upload', authenticateToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: '未找到文件数据' });
        }
        logAudit(req, { module: 'QUOTE_VERIFY', action: 'UPLOAD_FILE', target_data: req.file.originalname });

        const apiKey = process.env.DIFY_QUOTE_VERIFY_FILE_API_KEY;
        let apiUrl = process.env.DIFY_QUOTE_VERIFY_FILE_API_URL;
        if (apiUrl && !apiUrl.endsWith('/v1')) {
            apiUrl = `${apiUrl.replace(/\/$/, '')}/v1`;
        }
        if (!apiKey || !apiUrl) {
            return res.status(500).json({ success: false, message: '服务端未配置 DIFY_QUOTE_VERIFY_FILE_API_KEY' });
        }

        // 1. 上传文件到 Dify
        const formData = new FormData();
        const fileContent = fs.readFileSync(req.file.path);
        const { Blob: NodeBlob } = await import('buffer');
        const blob = new NodeBlob([fileContent], { type: req.file.mimetype });
        formData.append('file', blob, req.file.originalname);
        formData.append('user', req.user?.username || 'web_os_user');

        const difyUploadRes = await fetch(`${apiUrl}/files/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}` },
            body: formData
        });

        const uploadResText = await difyUploadRes.text();
        if (!difyUploadRes.ok) {
            console.error(`[Dify 核查报价文件上传失败] 状态码: ${difyUploadRes.status}, 响应: ${uploadResText}`);
            throw new Error(`Dify 文件上传失败 (${difyUploadRes.status}): ${uploadResText.substring(0, 200)}`);
        }

        const uploadData = JSON.parse(uploadResText);
        const fileId = uploadData.id;

        // 2. 调用工作流B
        const payload = {
            inputs: {
                quote_file: [{
                    type: 'document',
                    transfer_method: 'local_file',
                    upload_file_id: fileId
                }]
            },
            response_mode: 'blocking',
            user: req.user?.username || 'web_os_user'
        };

        const difyRes = await fetch(`${apiUrl}/workflows/run`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const chunks = [];
        if (difyRes.body) {
            for await (const chunk of difyRes.body) {
                chunks.push(Buffer.from(chunk));
            }
        }
        const resText = Buffer.concat(chunks).toString('utf-8');

        if (!difyRes.ok) {
            console.error(`[Dify 核查报价工作流B报错] 状态码: ${difyRes.status}, 响应: ${resText.substring(0, 500)}`);
            throw new Error(`Dify 工作流调用报错 (${difyRes.status}): ${resText.substring(0, 300)}`);
        }

        console.log(`[核查报价B] Dify 响应长度: ${resText.length} 字符`);

        try {
            const bodyData = JSON.parse(resText);
            let resultText = '';
            const rawOutputs = bodyData?.data?.outputs || bodyData?.data || bodyData;

            if (rawOutputs && typeof rawOutputs === 'object') {
                if (rawOutputs.text !== undefined) {
                    resultText = typeof rawOutputs.text === 'object' ? JSON.stringify(rawOutputs.text, null, 2) : String(rawOutputs.text);
                } else if (rawOutputs.result !== undefined) {
                    resultText = typeof rawOutputs.result === 'object' ? JSON.stringify(rawOutputs.result, null, 2) : String(rawOutputs.result);
                } else if (rawOutputs.output !== undefined) {
                    resultText = typeof rawOutputs.output === 'object' ? JSON.stringify(rawOutputs.output, null, 2) : String(rawOutputs.output);
                } else {
                    const firstKeyVal = Object.values(rawOutputs)[0];
                    resultText = typeof firstKeyVal === 'object' ? JSON.stringify(firstKeyVal, null, 2) : String(firstKeyVal);
                }
            }

            if (typeof resultText === 'string') {
                resultText = resultText.replace(/<think>[\s\S]*?<\/think>(\\n|\s)*/gi, '').trim();
                resultText = resultText.replace(/\\n/g, '\n');
            }

            res.json({ success: true, data: resultText || '文件处理完成，未返回详细信息' });
        } catch (parseErr) {
            console.error('[核查报价B JSON解析失败]', parseErr.message);
            throw new Error(`无法解析 Dify 响应: ${parseErr.message}`);
        }
    } catch (e) {
        console.error('[核查报价B请求失败]', e);
        res.status(500).json({ success: false, message: e.message });
    } finally {
        if (req.file?.path) { try { fs.unlinkSync(req.file.path); } catch (_) { /* 忽略 */ } }
    }
});

// ===================================
// ■ 业务看板 (Business Dashboard) API 代理
// ===================================
app.post('/api/business-dashboard/upload', upload.single('file'), async (req, res) => {
    try {
        const DIFY_API_KEY = process.env.DIFY_BUSINESS_DASHBOARD_API_KEY || process.env.DIFY_WORKFLOW_API_KEY;
        const DIFY_BASE_URL = (process.env.DIFY_BUSINESS_DASHBOARD_BASE_URL || process.env.DIFY_API_BASE_URL || 'http://39.108.221.22/v1').replace(/\/$/, '');

        if (!DIFY_API_KEY) {
            return res.status(503).json({ error: 'DIFY_BUSINESS_DASHBOARD_API_KEY 未配置，请在 .env 中填入业务看板应用的 API Key' });
        }
        if (!req.file) {
            return res.status(400).json({ error: '未收到上传的文件' });
        }

        console.log(`[业务看板代理] 上传文件: ${req.file.originalname} (${req.file.size} bytes)`);

        const fileContent = fs.readFileSync(req.file.path);
        const { Blob: NodeBlob } = await import('buffer');
        const formData = new FormData();
        const blob = new NodeBlob([fileContent], { type: req.file.mimetype });
        formData.append('file', blob, req.file.originalname);
        formData.append('user', req.user?.username || req.body.user || 'web-client-user');

        const difyRes = await fetch(`${DIFY_BASE_URL}/files/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${DIFY_API_KEY}` },
            body: formData
        });

        const data = await difyRes.json();
        if (!difyRes.ok) {
            console.error('[业务看板代理] 文件上传失败:', difyRes.status, data);
            return res.status(difyRes.status).json(data);
        }

        console.log(`[业务看板代理] 文件上传成功, File ID: ${data.id}`);
        res.json(data);
    } catch (error) {
        console.error('[业务看板代理] 文件上传错误:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (req.file?.path) { try { fs.unlinkSync(req.file.path); } catch (_) {} }
    }
});

app.post('/api/business-dashboard/chat', async (req, res) => {
    try {
        const DIFY_API_KEY = process.env.DIFY_BUSINESS_DASHBOARD_API_KEY || process.env.DIFY_WORKFLOW_API_KEY;
        const DIFY_URL = process.env.DIFY_BUSINESS_DASHBOARD_API_URL || 'http://39.108.221.22/v1/chat-messages';

        if (!DIFY_API_KEY) {
            return res.status(503).json({
                error: 'DIFY_BUSINESS_DASHBOARD_API_KEY 未配置',
                message: '请在根目录 .env 文件中添加 DIFY_BUSINESS_DASHBOARD_API_KEY=app-xxxxxx 并填入 Dify 业务看板机器人的有效 API Key。'
            });
        }

        console.log('[业务看板代理] 转发请求至 Dify:', DIFY_URL);

        const bodyData = {
            ...req.body,
            user: req.user?.username || req.body.user || 'web_client_user'
        };

        const difyRes = await fetch(DIFY_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${DIFY_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(bodyData)
        });

        if (!difyRes.ok) {
            const errText = await difyRes.text();
            console.error(`[业务看板代理] Dify 返回错误 (${difyRes.status}):`, errText);
            return res.status(difyRes.status).json({
                error: `Dify 接口调用失败 (HTTP ${difyRes.status})`,
                details: errText
            });
        }

        const contentType = difyRes.headers.get('content-type') || '';
        if (contentType.includes('text/event-stream')) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');

            const reader = difyRes.body.getReader();
            const decoder = new TextDecoder();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                res.write(decoder.decode(value, { stream: true }));
            }
            res.end();
        } else {
            const data = await difyRes.json();
            res.json(data);
        }
    } catch (error) {
        console.error('[业务看板代理] 转发异常:', error);
        res.status(500).json({ error: error.message });
    }
});

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

