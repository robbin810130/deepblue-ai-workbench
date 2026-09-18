// ============================================================
// server/reviewPartnerRoutes.js — 复盘搭子模块路由
// ============================================================
import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import pool from './db.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// 工具函数
const round2 = (n) => Math.round(n * 100) / 100;
const round4 = (n) => Math.round(n * 10000) / 10000;

// 文件上传配置
const uploadDir = path.join(__dirname, '../tmp/uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'review-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 400 * 1024 * 1024 }
});

// 临时文件清理工具函数
const cleanupReviewPartnerFiles = (files) => {
    if (!files) return;
    for (const field of ['index_json', 'ad_json', 'zone_json']) {
        const file = files[field]?.[0];
        if (file?.path) {
            try { fs.unlinkSync(file.path); } catch (_) { console.warn('[复盘搭子] 清理临时文件失败:', file.path); }
        }
    }
};

// ============================================================
// 1. 查询广告专区数据
// ============================================================
router.get('/ad-zone', async (req, res) => {
    try {
        const { start_date, end_date, limit } = req.query;

        // 日期格式校验（YYYY-MM-DD）
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (start_date && !dateRegex.test(start_date)) {
            return res.status(400).json({ success: false, message: 'start_date 格式无效，应为 YYYY-MM-DD' });
        }
        if (end_date && !dateRegex.test(end_date)) {
            return res.status(400).json({ success: false, message: 'end_date 格式无效，应为 YYYY-MM-DD' });
        }

        let whereClause = '';
        const params = [];

        if (start_date && end_date) {
            whereClause = 'WHERE stat_date BETWEEN $1 AND $2';
            params.push(start_date, end_date);
        } else if (start_date) {
            whereClause = 'WHERE stat_date >= $1';
            params.push(start_date);
        } else if (end_date) {
            whereClause = 'WHERE stat_date <= $1';
            params.push(end_date);
        }

        // 结果行数上限保护，防止无界查询
        const LIMIT = Math.min(parseInt(limit) || 5000, 10000);
        params.push(LIMIT);

        const result = await pool.query(
            `SELECT id, ad_id, business_type, promotion_name, ad_name, to_char(stat_date, 'YYYY-MM-DD') AS stat_date, impressions, impression_users, clicks, click_users,
                    zone_id, zone_name, zone_content, pv, uv_openid, uv_channel, zone_clicks,
                    zone_click_users, avg_stay_seconds, material_name, we_date, we_visitors, we_visits
             FROM sys_review_ad_zone ${whereClause}
             ORDER BY stat_date DESC, ad_id DESC
             LIMIT $${params.length}`,
            params
        );

        console.log(`[复盘搭子] 查询广告专区: ${whereClause || '无条件'}, 返回 ${result.rows.length} 行`);
        res.json({ success: true, data: result.rows });
    } catch (e) {
        console.error('[复盘搭子] 查询广告专区数据失败:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ============================================================
// 2. 上传 3 个 Excel 文件并触发 DIFY 工作流
// ============================================================
router.post('/upload', (req, res, next) => {
    upload.fields([
        { name: 'index_json', maxCount: 1 },
        { name: 'ad_json', maxCount: 1 },
        { name: 'zone_json', maxCount: 1 },
        { name: 'material_files', maxCount: 50 }
    ])(req, res, (err) => {
        if (err) {
            cleanupReviewPartnerFiles(req.files);
            return res.status(400).json({ success: false, message: err.message });
        }
        next();
    });
}, async (req, res) => {
    const logAudit = req.app.get('logAudit') || (() => {});
    
    try {
        const summaryFile = req.files?.index_json?.[0];
        const adFile = req.files?.ad_json?.[0];
        const zoneFile = req.files?.zone_json?.[0];

        if (!summaryFile || !adFile || !zoneFile) {
            return res.status(400).json({ success: false, message: '必须上传 3 个文件: index_json, ad_json, zone_json' });
        }

        // 服务端文件类型校验
        const allowedExts = ['.xls', '.xlsx'];
        for (const f of [summaryFile, adFile, zoneFile]) {
            const ext = path.extname(f.originalname).toLowerCase();
            if (!allowedExts.includes(ext)) {
                return res.status(400).json({ success: false, message: `不支持的文件格式: ${f.originalname}，仅支持 .xls/.xlsx` });
            }
        }

        logAudit(req, { module: 'REVIEW_PARTNER', action: 'UPLOAD_FILES', details: {
            index: summaryFile.originalname,
            ad: adFile.originalname,
            zone: zoneFile.originalname
        }});

        const apiKey = process.env.DIFY_REVIEW_PARTNER_API_KEY;
        let apiUrl = process.env.DIFY_REVIEW_PARTNER_API_URL;
        if (apiUrl && !apiUrl.endsWith('/v1')) {
            apiUrl = `${apiUrl.replace(/\/$/, '')}/v1`;
        }

        if (!apiKey || !apiUrl) {
            return res.status(500).json({ success: false, message: '服务端未配置 DIFY_REVIEW_PARTNER_API_KEY' });
        }

        // 字段映射表：中文列名 -> 英文字段名（概述表只提取 8 个字段）
        const SUMMARY_FIELD_MAP = {
            '业务类型': 'business_type', '广告ID': 'ad_id', '广告名称': 'ad_name',
            '专区ID': 'zone_id', '专区内容': 'zone_content',
            'cmsPagesId': 'cms_id', '素材名称': 'material_name'
        };
        
        const AD_FIELD_MAP = {
            '广告ID': 'ad_id', '广告类型': 'ad_type', '广告名称': 'ad_name', '日期': 'date',
            '曝光量': 'impressions', '曝光人数(渠道用户ID)': 'impression_users',
            '点击量': 'clicks', '点击人数(渠道用户ID)': 'click_users'
        };
        
        const ZONE_FIELD_MAP = {
            '专区ID': 'zone_id', '专区名称': 'zone_name', '专区内容': 'zone_content',
            '日期': 'date', 'PV': 'pv', 'UV(OpenId)': 'uv_openid',
            'UV(渠道)': 'uv_channel', 'UV(渠道用户ID)': 'uv_channel',
            '专区页内点击量': 'inner_clicks', '专区点击量': 'inner_clicks',
            '专区点击人数': 'inner_click_users', '点击人数(渠道用户ID)': 'inner_click_users',
            '次均停留时长(秒)': 'avg_stay_time', '次均停留(秒)': 'avg_stay_time'
        };
        
        // 异步解析 Excel：使用 fs.promises.readFile + XLSX.read 避免同步阻塞
        const parseExcelToJson = async (filePath, fieldMap) => {
            const buffer = await fs.promises.readFile(filePath);
            const workbook = XLSX.read(buffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            // 使用 defval 确保空单元格也被包含（设为 null）
            const rawData = XLSX.utils.sheet_to_json(worksheet, { defval: null });
            
            if (rawData.length > 0) {
                console.log('[复盘搭子] 原始列名:', Object.keys(rawData[0]));
            }
            
            // 转换字段名（trim 处理列名）
            return rawData.map(row => {
                const newRow = {};
                for (const [cnKey, value] of Object.entries(row)) {
                    const trimmedKey = cnKey.trim();
                    const enKey = fieldMap[trimmedKey] || trimmedKey;
                    newRow[enKey] = value;
                }
                return newRow;
            });
        };

        const [summaryData, adData, zoneRaw] = await Promise.all([
            parseExcelToJson(summaryFile.path, SUMMARY_FIELD_MAP),
            parseExcelToJson(adFile.path, AD_FIELD_MAP),
            parseExcelToJson(zoneFile.path, ZONE_FIELD_MAP)
        ]);

        // 从概述表文件的 "we素材名称cms" sheet 匹配推广名称（素材名称 + cmsPagesId 双键匹配）
        {
            const buf = await fs.promises.readFile(summaryFile.path);
            const wb = XLSX.read(buf, { type: 'buffer' });
            const promoSheet = wb.Sheets['we素材名称cms'];
            if (promoSheet) {
                const promoRows = XLSX.utils.sheet_to_json(promoSheet, { defval: null });
                const promoMap = new Map();
                for (const r of promoRows) {
                    const name = r['素材名称'] != null ? String(r['素材名称']).trim() : '';
                    const cms = r['cmsPagesId'] != null ? String(r['cmsPagesId']).trim() : '';
                    const promo = r['推广名称=buh专区类型'];
                    if (name && cms) promoMap.set(`${name}|${cms}`, promo);
                }
                let matchCount = 0;
                for (const row of summaryData) {
                    const key = `${row.material_name != null ? String(row.material_name).trim() : ''}|${row.cms_id != null ? String(row.cms_id).trim() : ''}`;
                    if (promoMap.has(key)) {
                        row.promotion_name = promoMap.get(key);
                        matchCount++;
                    }
                }
                console.log(`[复盘搭子] 概述表推广名称匹配: ${matchCount}/${summaryData.length} 行 (来自 we素材名称cms sheet)`);
            } else {
                console.warn('[复盘搭子] 概述表文件无 "we素材名称cms" sheet，跳过推广名称匹配');
            }
        }

        // 概述表只保留指定的 8 个字段，过滤掉其他列
        const INDEX_KEEP_FIELDS = ['business_type', 'ad_id', 'ad_name', 'zone_id', 'zone_content', 'cms_id', 'material_name', 'promotion_name'];
        for (let i = 0; i < summaryData.length; i++) {
            const row = summaryData[i];
            const filtered = {};
            for (const key of INDEX_KEEP_FIELDS) {
                filtered[key] = row[key] ?? null;
            }
            summaryData[i] = filtered;
        }

        // 校验 Excel 结构：确保解析后存在有效数据
        if (summaryData.length === 0 && adData.length === 0 && zoneRaw.length === 0) {
            return res.status(400).json({ success: false, message: '所有文件解析后无有效数据，请检查 Excel 格式' });
        }
        // 校验必要字段是否存在
        const adExpectedKeys = ['ad_id', 'date'];
        if (adData.length > 0) {
            const firstRow = adData[0];
            const missingKeys = adExpectedKeys.filter(k => !(k in firstRow));
            if (missingKeys.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: `广告位数据缺少必要字段: ${missingKeys.join(', ')}，请检查表头是否正确`
                });
            }
        }

        // 专区页数据过滤：跳过 zone_id 等于"统计周期"的行
        const zoneData = zoneRaw.filter(row => {
            return row.zone_id !== '统计周期';
        });
        console.log(`[复盘搭子] 专区页数据过滤: 原始${zoneRaw.length}行 → 有效${zoneData.length}行 (已跳过统计周期行)`);

        console.log(`[复盘搭子] Excel 解析成功: summary=${summaryData.length}行, ad=${adData.length}行, zone=${zoneData.length}行`);
        if (summaryData.length > 0) console.log('[复盘搭子] Summary 字段示例:', Object.keys(summaryData[0]));
        if (adData.length > 0) console.log('[复盘搭子] Ad 字段示例:', Object.keys(adData[0]));
        if (zoneData.length > 0) console.log('[复盘搭子] Zone 字段示例:', Object.keys(zoneData[0]));

        // ── 解析批量素材文件（推广明细表格格式） ──
        const materialFiles = req.files?.material_files || [];
        let materialData = [];
        if (materialFiles.length > 0) {
            const MATERIAL_FIELD_MAP = {
                '访问人数': 'visitors', '访问次数': 'visits',
                '素材名称': 'material_name', '日期': 'date'
            };
            for (const mf of materialFiles) {
                try {
                    const buf = await fs.promises.readFile(mf.path);
                    const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
                    for (const sn of wb.SheetNames) {
                        const ws = wb.Sheets[sn];
                        const allRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
                        if (allRows.length < 3) continue;

                        // 找到列头行（包含"日期"的行）
                        let headerIdx = -1;
                        let headers = [];
                        for (let i = 0; i < Math.min(allRows.length, 15); i++) {
                            const row = allRows[i];
                            if (row && row.some(c => c != null && String(c).trim() === '日期')) {
                                headerIdx = i;
                                headers = row.map(c => c != null ? String(c).trim() : '');
                                break;
                            }
                        }
                        if (headerIdx < 0) continue;

                        // 检查是否有"素材名称"列，没有则跳过该文件
                        const hasMaterialCol = headers.includes('素材名称');
                        if (!hasMaterialCol) {
                            console.log(`[复盘搭子] 素材文件 ${mf.originalname} 无素材名称列，跳过`);
                            continue;
                        }

                        // 解析数据行
                        for (let r = headerIdx + 1; r < allRows.length; r++) {
                            const row = allRows[r];
                            if (!row || row.length === 0) continue;
                            const mapped = {};
                            for (let ci = 0; ci < headers.length; ci++) {
                                const h = headers[ci];
                                if (!h) continue;
                                const enKey = MATERIAL_FIELD_MAP[h] || h;
                                mapped[enKey] = row[ci];
                            }
                            // 只保留有日期且有素材名称的行
                            if (mapped.date && mapped.material_name) {
                                // 格式化日期
                                const d = mapped.date;
                                if (d instanceof Date) {
                                    const y = d.getFullYear();
                                    const m = String(d.getMonth() + 1).padStart(2, '0');
                                    const day = String(d.getDate()).padStart(2, '0');
                                    mapped.date = `${y}/${m}/${day}`;
                                } else if (typeof d === 'string') {
                                    mapped.date = d.replace(/-/g, '/');
                                }
                                materialData.push(mapped);
                            }
                        }
                    }
                    console.log(`[复盘搭子] 素材文件 ${mf.originalname} 解析完成`);
                } catch (e) {
                    console.warn(`[复盘搭子] 素材文件 ${mf.originalname} 解析失败:`, e.message);
                }
            }
            console.log(`[复盘搭子] 素材数据合计: ${materialData.length} 行 (来自 ${materialFiles.length} 个文件)`);
        }

        // 校验数据行数上限，防止 payload 过大
        const MAX_ROWS = 5000;
        if (summaryData.length > MAX_ROWS || adData.length > MAX_ROWS || zoneData.length > MAX_ROWS) {
            return res.status(400).json({
                success: false,
                message: `单个文件数据行数不得超过 ${MAX_ROWS} 行，请缩减 Excel 后重试`
            });
        }

        // 触发 DIFY 工作流（传 JSON 字符串）
        const payload = {
            inputs: {
                index_json: JSON.stringify(summaryData),
                ad_json: JSON.stringify(adData),
                zone_json: JSON.stringify(zoneData),
                we_json: JSON.stringify(materialData)
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

        if (!difyRes.ok) {
            const errText = await difyRes.text();
            console.error(`[复盘搭子] Dify 工作流调用失败: ${difyRes.status} - ${errText}`);
            return res.status(difyRes.status).json({
                success: false,
                message: `工作流调用失败: ${difyRes.status}`,
                details: errText.substring(0, 300)
            });
        }

        const resultData = await difyRes.json();
        console.log('[复盘搭子] 工作流执行成功');

        // ■ 解析 DIFY 返回的 result_json 并存入数据库
        const outputs = resultData?.data?.outputs || resultData?.data || resultData;
        let insertedCount = 0;
        if (outputs?.result_json) {
            try {
                const difyRows = JSON.parse(outputs.result_json);
                console.log(`[复盘搭子] DIFY 返回 ${difyRows.length} 行数据`);

                // DIFY 返回的中文字段 → 数据库英文字段映射（按 DIFY 实际返回 key 匹配）
                const DIFY_RESULT_MAP = {
                    '广告ID': 'ad_id', '业务类型': 'business_type', '广告名称': 'ad_name', '日期': 'stat_date',
                    '曝光量': 'impressions', '曝光人数(渠道用户ID)': 'impression_users',
                    '点击量': 'clicks', '点击人数(渠道用户ID)': 'click_users',
                    '专区id': 'zone_id', '专区名称': 'zone_name', '专区内容': 'zone_content',
                    'PV': 'pv', 'UV(OpenId)': 'uv_openid', 'UV(渠道用户ID)': 'uv_channel',
                    '专区页内点击量': 'zone_clicks', '专区页内点击人数(渠道用户ID)': 'zone_click_users',
                    '次均停留时长(秒)': 'avg_stay_seconds',
                    '推广名称=buh专区类型': 'promotion_name',
                    'we素材名称': 'material_name',
                    'we访问人数': 'we_visitors', 'we访问次数': 'we_visits'
                };

                // 转换字段名
                const mappedRows = difyRows.map(row => {
                    const newRow = {};
                    for (const [cnKey, value] of Object.entries(row)) {
                        const enKey = DIFY_RESULT_MAP[cnKey] || cnKey;
                        // 空字符串转为 null
                        newRow[enKey] = (value === '' || value === 'null') ? null : value;
                    }
                    return newRow;
                });

                // 过滤无效行：ad_id 和 stat_date 为 NOT NULL 字段
                const validRows = mappedRows.filter(row => row.ad_id != null && row.stat_date != null);
                if (validRows.length < mappedRows.length) {
                    console.warn(`[复盘搭子] 跳过 ${mappedRows.length - validRows.length} 行无效数据 (缺少 ad_id 或 stat_date)`);
                }

                // 按 (ad_id, stat_date, zone_id) 去重，保留最后一条
                const dedupedMap = new Map();
                for (const row of validRows) {
                    const key = `${row.ad_id ?? 0}|${row.stat_date}|${row.zone_id ?? 0}`;
                    dedupedMap.set(key, row);
                }
                const dedupedRows = [...dedupedMap.values()];
                if (dedupedRows.length < validRows.length) {
                    console.warn(`[复盘搭子] 去重: ${validRows.length} → ${dedupedRows.length} 行 (移除 ${validRows.length - dedupedRows.length} 条重复数据)`);
                }

                // 批量 upsert（ON CONFLICT 更新）
                const cols = ['ad_id','business_type','promotion_name','ad_name','stat_date','impressions','impression_users','clicks','click_users',
                    'zone_id','zone_name','zone_content','pv','uv_openid','uv_channel','zone_clicks','zone_click_users','avg_stay_seconds',
                    'material_name','we_date','we_visitors','we_visits'];

                if (dedupedRows.length > 0) {
                    const allValues = [];
                    const allPlaceholders = [];
                    let paramIdx = 1;

                    for (const row of dedupedRows) {
                        const vals = cols.map((c) => {
                            const v = row[c];
                            if (v === null || v === undefined) return null;
                            if (c === 'stat_date') return v;
                            if (c === 'avg_stay_seconds') return parseFloat(v) || 0;
                            if (c === 'ad_id' || c === 'zone_id' || c === 'pv' || c === 'uv_openid' || c === 'uv_channel' ||
                                c === 'impressions' || c === 'impression_users' || c === 'clicks' || c === 'click_users' ||
                                c === 'zone_clicks' || c === 'zone_click_users' || c === 'we_visitors' || c === 'we_visits') {
                                const n = parseInt(v, 10);
                                return isNaN(n) ? null : n;
                            }
                            return String(v);
                        });

                        allValues.push(...vals);
                        const ph = cols.map((_, i) => `$${paramIdx + i}`).join(',');
                        allPlaceholders.push(`(${ph})`);
                        paramIdx += cols.length;
                    }

                    const updateCols = cols.filter(c => c !== 'ad_id' && c !== 'stat_date');
                    const updateSet = updateCols.map(c => `${c} = EXCLUDED.${c}`).join(',');

                    await pool.query(
                        `INSERT INTO sys_review_ad_zone (${cols.join(',')})
                         VALUES ${allPlaceholders.join(',')}
                         ON CONFLICT (COALESCE(ad_id, 0), stat_date, COALESCE(zone_id, 0))
                         DO UPDATE SET ${updateSet}`,
                        allValues
                    );
                    insertedCount = dedupedRows.length;
                }
                console.log(`[复盘搭子] 数据已存入数据库: ${insertedCount} 行`);
            } catch (parseErr) {
                console.error('[复盘搭子] 解析 DIFY 返回数据失败:', parseErr.message);
                return res.status(200).json({
                    success: false,
                    message: `数据解析失败: ${parseErr.message}`,
                    data: outputs
                });
            }
        }

        res.json({
            success: true,
            message: `数据整理完成，已存入 ${insertedCount} 条记录`,
            data: outputs
        });

    } catch (e) {
        console.error('[复盘搭子] 上传失败', e);
        res.status(500).json({ success: false, message: e.message });
    } finally {
        // 清理临时文件
        cleanupReviewPartnerFiles(req.files);
    }
});

// ============================================================
// 3. 小程序访问情况 - 查询数据
// ============================================================
router.get('/mini-program', async (req, res) => {
    try {
        const { start_date, end_date } = req.query;

        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (start_date && !dateRegex.test(start_date)) {
            return res.status(400).json({ success: false, message: 'start_date 格式无效，应为 YYYY-MM-DD' });
        }
        if (end_date && !dateRegex.test(end_date)) {
            return res.status(400).json({ success: false, message: 'end_date 格式无效，应为 YYYY-MM-DD' });
        }

        let whereClause = '';
        const params = [];

        if (start_date && end_date) {
            whereClause = 'WHERE stat_date BETWEEN $1 AND $2';
            params.push(start_date, end_date);
        } else if (start_date) {
            whereClause = 'WHERE stat_date >= $1';
            params.push(start_date);
        } else if (end_date) {
            whereClause = 'WHERE stat_date <= $1';
            params.push(end_date);
        }

        const result = await pool.query(
            `SELECT id, to_char(stat_date, 'YYYY-MM-DD') AS stat_date, scan_users, scan_views, partner_visits, yz_users, yz_views, dau, display_rate, transaction_users, remark
             FROM sys_review_mini_program ${whereClause}
             ORDER BY stat_date DESC`,
            params
        );

        console.log(`[复盘搭子] 查询小程序访问情况: ${whereClause || '无条件'}, 返回 ${result.rows.length} 行`);
        res.json({ success: true, data: result.rows });
    } catch (e) {
        console.error('[复盘搭子] 查询小程序访问情况失败:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ============================================================
// 3.0 小程序访问情况 - 查询5个月日均数据（独立接口）
// ============================================================
router.get('/mini-program/avg', async (req, res) => {
    try {
        const year = new Date().getFullYear();
        const startDate = `${year}-03-01`;
        const result = await pool.query(
            `SELECT to_char(stat_date, 'YYYY-MM-DD') AS stat_date, scan_users, scan_views, partner_visits, yz_users, yz_views, dau, display_rate, transaction_users
             FROM sys_review_mini_program
             WHERE stat_date >= $1
             ORDER BY stat_date ASC`,
            [startDate]
        );
        console.log(`[复盘搭子] 查询小程序5个月日均数据: 从 ${startDate}, 返回 ${result.rows.length} 行`);
        res.json({ success: true, data: result.rows });
    } catch (e) {
        console.error('[复盘搭子] 查询小程序日均数据失败:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ============================================================
// 3.1 小程序访问情况 - 更新备注
// ============================================================
router.patch('/mini-program/:id/remark', async (req, res) => {
    try {
        const { id } = req.params;
        const { remark } = req.body;
        if (remark === undefined) {
            return res.status(400).json({ success: false, message: '缺少 remark 字段' });
        }
        await pool.query('UPDATE sys_review_mini_program SET remark = $1 WHERE id = $2', [remark || null, id]);
        res.json({ success: true });
    } catch (e) {
        console.error('[复盘搭子] 更新备注失败:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ============================================================
// 4. 小程序访问情况 - 上传 3 个 Excel 并触发 DIFY 工作流
// ============================================================
const cleanupMiniProgramFiles = (files) => {
    if (!files) return;
    for (const field of ['uv_pv', 'core_metrics', 'click_json']) {
        const file = files[field]?.[0];
        if (file?.path) {
            try { fs.unlinkSync(file.path); } catch (_) { console.warn('[复盘搭子] 清理临时文件失败:', file.path); }
        }
    }
};

router.post('/mini-program/upload', (req, res, next) => {
    upload.fields([
        { name: 'uv_pv', maxCount: 1 },
        { name: 'core_metrics', maxCount: 1 },
        { name: 'click_json', maxCount: 1 }
    ])(req, res, (err) => {
        if (err) {
            cleanupMiniProgramFiles(req.files);
            return res.status(400).json({ success: false, message: err.message });
        }
        next();
    });
}, async (req, res) => {
    try {
        const uvPvFile = req.files?.uv_pv?.[0];
        const coreMetricsFile = req.files?.core_metrics?.[0];
        const clickJsonFile = req.files?.click_json?.[0];

        if (!uvPvFile || !coreMetricsFile || !clickJsonFile) {
            return res.status(400).json({ success: false, message: '必须上传 3 个文件: uv_pv (UV-PV数据), core_metrics (核心指标数据), click_json (点击数据)' });
        }

        // 服务端文件类型校验
        const allowedExts = ['.xls', '.xlsx'];
        for (const f of [uvPvFile, coreMetricsFile, clickJsonFile]) {
            const ext = path.extname(f.originalname).toLowerCase();
            if (!allowedExts.includes(ext)) {
                return res.status(400).json({ success: false, message: `不支持的文件格式: ${f.originalname}，仅支持 .xls/.xlsx` });
            }
        }

        const logAudit = req.app.get('logAudit') || (() => {});
        logAudit(req, { module: 'REVIEW_PARTNER', action: 'UPLOAD_MINI_PROGRAM', details: {
            uv_pv: uvPvFile.originalname,
            core_metrics: coreMetricsFile.originalname,
            click_json: clickJsonFile.originalname
        }});

        // ── UV-PV 解析：提取 日期(YYYYMMDD), 总的UV, 总的PV ──
        const convertUvPv = async (filePath) => {
            const buffer = await fs.promises.readFile(filePath);
            const workbook = XLSX.read(buffer, { type: 'buffer' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            // 以数组模式读取，保留原始行列结构
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

            // 定位表头行：找到包含"日期"的行
            let headerIdx = -1;
            let headerRow = null;
            for (let i = 0; i < Math.min(rows.length, 10); i++) {
                const row = rows[i] || [];
                if (row.some(cell => String(cell || '').trim() === '日期')) {
                    headerIdx = i;
                    headerRow = row;
                    break;
                }
            }
            if (headerIdx === -1 || !headerRow) {
                console.warn('[复盘搭子-UV-PV] 未找到表头行');
                return [];
            }

            // 根据表头确定列索引
            const colIndex = {};
            for (let c = 0; c < headerRow.length; c++) {
                const name = String(headerRow[c] || '').trim();
                if (name) colIndex[name] = c;
            }
            const dateCol = colIndex['日期'];
            const uvCol = colIndex['总的UV'];
            const pvCol = colIndex['总的PV'];
            const transitUvCol = colIndex['公交+地铁总UV'];   // 可选（已废弃，改用公交UV数+地铁UV数）
            const busUvCol = colIndex['公交UV数'];              // 可选
            const metroUvCol = colIndex['地铁UV数'];            // 可选
            const busOrderCol = colIndex['公交订单数'];          // 可选
            const metroOrderCol = colIndex['地铁订单数'];        // 可选
            console.log(`[复盘搭子-UV-PV] 表头行${headerIdx}, 列映射: 日期=${dateCol}, 总的UV=${uvCol}, 总的PV=${pvCol}, 公交+地铁总UV=${transitUvCol}, 公交订单数=${busOrderCol}, 地铁订单数=${metroOrderCol}`);

            if (dateCol === undefined || uvCol === undefined || pvCol === undefined) {
                throw new Error('UV-PV 表缺少必要列（日期/总的UV/总的PV）');
            }

            const records = [];
            for (let i = headerIdx + 1; i < rows.length; i++) {
                const row = rows[i] || [];
                const rawDate = row[dateCol];

                // 处理多种日期格式：文本 YYYYMMDD、Date 对象、数字 YYYYMMDD、Excel 序列号
                let dateVal = '';
                if (rawDate instanceof Date) {
                    const y = rawDate.getFullYear();
                    const m = String(rawDate.getMonth() + 1).padStart(2, '0');
                    const d = String(rawDate.getDate()).padStart(2, '0');
                    dateVal = `${y}${m}${d}`;
                } else if (typeof rawDate === 'number') {
                    const numStr = String(rawDate);
                    if (numStr.length === 8 && /^\d{8}$/.test(numStr) && numStr.startsWith('20')) {
                        // 已经是 YYYYMMDD 格式的数字（如 20260911）
                        dateVal = numStr;
                    } else if (rawDate > 40000 && rawDate < 100000) {
                        // Excel 序列号（1900 日期系统，范围约 40000-60000）
                        const excelEpoch = new Date(1899, 11, 30);
                        const jsDate = new Date(excelEpoch.getTime() + rawDate * 86400000);
                        const y = jsDate.getFullYear();
                        const m = String(jsDate.getMonth() + 1).padStart(2, '0');
                        const d = String(jsDate.getDate()).padStart(2, '0');
                        dateVal = `${y}${m}${d}`;
                    } else {
                        dateVal = numStr;
                    }
                } else {
                    dateVal = String(rawDate ?? '').trim();
                }

                if (dateVal.length === 8 && /^\d{8}$/.test(dateVal)) {
                    // transit_uv: 公交UV数 + 地铁UV数
                    let transitUv = 0;
                    if (busUvCol !== undefined) {
                        transitUv += parseInt(parseFloat(row[busUvCol] || 0), 10) || 0;
                    }
                    if (metroUvCol !== undefined) {
                        transitUv += parseInt(parseFloat(row[metroUvCol] || 0), 10) || 0;
                    }
                    // transit_pv: 公交订单数 + 地铁订单数
                    let transitPv = 0;
                    if (busOrderCol !== undefined) {
                        transitPv += parseInt(parseFloat(row[busOrderCol] || 0), 10) || 0;
                    }
                    if (metroOrderCol !== undefined) {
                        transitPv += parseInt(parseFloat(row[metroOrderCol] || 0), 10) || 0;
                    }
                    records.push({
                        date: dateVal,
                        total_uv: parseInt(parseFloat(row[uvCol] || 0), 10) || 0,
                        total_pv: parseInt(parseFloat(row[pvCol] || 0), 10) || 0,
                        transit_uv: transitUv,
                        transit_pv: transitPv,
                    });
                }
            }
            return records;
        };

        // ── 核心指标解析：提取 日期(YYYYMMDD), 日访问人数 ──
        // 数据特征：前几行为元数据，表头行含"日期"和"日访问人数"，数据行日期格式为 YYYY/MM/DD
        const convertCoreMetrics = async (filePath) => {
            const buffer = await fs.promises.readFile(filePath);
            const workbook = XLSX.read(buffer, { type: 'buffer' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

            // 定位表头行：找到同时含"日期"和"日访问人数"的行
            let headerIdx = -1;
            let dateCol = -1;
            let visitorsCol = -1;
            for (let i = 0; i < Math.min(rows.length, 15); i++) {
                const row = rows[i] || [];
                const names = row.map(c => String(c || '').trim());
                const dIdx = names.indexOf('日期');
                const vIdx = names.indexOf('日访问人数');
                if (dIdx !== -1 && vIdx !== -1) {
                    headerIdx = i;
                    dateCol = dIdx;
                    visitorsCol = vIdx;
                    break;
                }
            }
            console.log(`[复盘搭子-核心指标] 表头行${headerIdx}, 列映射: 日期=${dateCol}, 日访问人数=${visitorsCol}`);

            if (headerIdx === -1) {
                throw new Error('核心指标表缺少表头行（日期/日访问人数）');
            }

            const records = [];
            for (let i = headerIdx + 1; i < rows.length; i++) {
                const row = rows[i] || [];
                const rawDate = String(row[dateCol] ?? '').trim();
                // 日期格式: YYYY/MM/DD → YYYYMMDD
                const dateClean = rawDate.replace(/\//g, '');
                if (dateClean.length === 8 && /^\d{8}$/.test(dateClean)) {
                    const visitors = row[visitorsCol];
                    records.push({
                        date: dateClean,
                        daily_visitors: (visitors != null && !isNaN(visitors)) ? parseInt(parseFloat(visitors), 10) || 0 : 0,
                    });
                }
            }
            return records;
        };

        // ── click_json 点击数据解析：提取 日期(YYYYMMDD), 总点击人数 ──
        const convertClickJson = async (filePath) => {
            const buffer = await fs.promises.readFile(filePath);
            const workbook = XLSX.read(buffer, { type: 'buffer' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

            // 定位表头行：找到包含"日期"的行
            let headerIdx = -1;
            let dateCol = -1;
            let clicksCol = -1;
            for (let i = 0; i < Math.min(rows.length, 15); i++) {
                const row = rows[i] || [];
                const names = row.map(c => String(c || '').trim());
                const dIdx = names.indexOf('日期');
                const cIdx = names.indexOf('总点击人数');
                if (dIdx !== -1 && cIdx !== -1) {
                    headerIdx = i;
                    dateCol = dIdx;
                    clicksCol = cIdx;
                    break;
                }
            }
            console.log(`[复盘搭子-click_json] 表头行${headerIdx}, 列映射: 日期=${dateCol}, 总点击人数=${clicksCol}`);

            if (headerIdx === -1) {
                throw new Error('click_json 表缺少表头行（日期/总点击人数）');
            }

            // 调试：打印前3行原始数据
            for (let i = headerIdx + 1; i < Math.min(headerIdx + 4, rows.length); i++) {
                const row = rows[i] || [];
                console.log(`[复盘搭子-click_json] 原始行${i}: 日期列=${JSON.stringify(row[dateCol])}, 点击列=${JSON.stringify(row[clicksCol])}`);
            }

            const records = [];
            for (let i = headerIdx + 1; i < rows.length; i++) {
                const row = rows[i] || [];
                let rawDate = row[dateCol];
                let dateClean = '';
                if (rawDate instanceof Date) {
                    // Excel 原生日期对象
                    const y = rawDate.getFullYear();
                    const m = String(rawDate.getMonth() + 1).padStart(2, '0');
                    const d = String(rawDate.getDate()).padStart(2, '0');
                    dateClean = `${y}${m}${d}`;
                } else {
                    rawDate = String(rawDate ?? '').trim();
                    // 支持 YYYYMMDD / YYYY/MM/DD / YYYY-MM-DD
                    dateClean = rawDate.replace(/[\/\-]/g, '');
                }
                if (dateClean.length === 8 && /^\d{8}$/.test(dateClean)) {
                    const clicks = row[clicksCol];
                    records.push({
                        date: dateClean,
                        total_clicks: (clicks != null && !isNaN(clicks)) ? parseInt(parseFloat(clicks), 10) || 0 : 0,
                    });
                }
            }
            return records;
        };

        const [uvPvData, coreMetricsData, clickJsonData] = await Promise.all([
            convertUvPv(uvPvFile.path),
            convertCoreMetrics(coreMetricsFile.path),
            convertClickJson(clickJsonFile.path)
        ]);

        console.log(`[复盘搭子] 小程序 Excel 解析: uv_pv=${uvPvData.length}行, core_metrics=${coreMetricsData.length}行, click_json=${clickJsonData.length}行`);

        if (uvPvData.length === 0 && coreMetricsData.length === 0 && clickJsonData.length === 0) {
            return res.status(400).json({ success: false, message: '三个文件解析后均无有效数据，请检查 Excel 格式' });
        }

        // 校验数据行数上限
        const MAX_ROWS = 5000;
        if (uvPvData.length > MAX_ROWS || coreMetricsData.length > MAX_ROWS || clickJsonData.length > MAX_ROWS) {
            return res.status(400).json({
                success: false,
                message: `单个文件数据行数不得超过 ${MAX_ROWS} 行，请缩减 Excel 后重试`
            });
        }

        // 调用 DIFY 工作流
        const apiKey = process.env.DIFY_MINI_PROGRAM_API_KEY;
        let apiUrl = process.env.DIFY_MINI_PROGRAM_API_URL;
        if (apiUrl && !apiUrl.endsWith('/v1')) {
            apiUrl = `${apiUrl.replace(/\/$/, '')}/v1`;
        }

        if (!apiKey || !apiUrl) {
            return res.status(500).json({ success: false, message: '服务端未配置 DIFY_MINI_PROGRAM_API_KEY / DIFY_MINI_PROGRAM_API_URL' });
        }

        // 从表单获取用户填写的日期范围
        const beginDate = req.body?.begin_date || '';
        const endDate = req.body?.end_date || '';
        if (!beginDate || !endDate || !/^\d{8}$/.test(beginDate) || !/^\d{8}$/.test(endDate)) {
            return res.status(400).json({ success: false, message: 'begin_date 和 end_date 必须为 YYYYMMDD 格式' });
        }
        console.log(`[复盘搭子] 小程序数据日期范围: ${beginDate} ~ ${endDate}`);

        const payload = {
            inputs: {
                uv_pv_json: JSON.stringify(uvPvData),
                core_metrics_json: JSON.stringify(coreMetricsData),
                click_json: JSON.stringify(clickJsonData),
                begin_date: beginDate,
                end_date: endDate
            },
            response_mode: 'blocking',
            user: req.user?.username || 'web_os_user'
        };

        console.log('[复盘搭子] 调用 DIFY 小程序工作流...');
        const difyRes = await fetch(`${apiUrl}/workflows/run`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!difyRes.ok) {
            const errText = await difyRes.text();
            console.error(`[复盘搭子] DIFY 小程序工作流调用失败: ${difyRes.status} - ${errText}`);
            return res.status(difyRes.status).json({
                success: false,
                message: `工作流调用失败: ${difyRes.status}`,
                details: errText.substring(0, 300)
            });
        }

        const resultData = await difyRes.json();
        console.log('[复盘搭子] 小程序工作流执行成功');

        // 解析 DIFY 返回的 result_json 并存入数据库
        const outputs = resultData?.data?.outputs || resultData?.data || resultData;
        let insertedCount = 0;
        if (outputs?.result_json) {
            try {
                const difyRows = JSON.parse(outputs.result_json);
                console.log(`[复盘搭子] DIFY 返回 ${difyRows.length} 行数据`);

                // DIFY 返回字段 → 数据库字段映射
                const DIFY_RESULT_MAP = {
                    'date': 'stat_date', 'scan_users': 'scan_users',
                    'scan_impressions': 'scan_views', 'visit_count': 'partner_visits',
                    'yct_users': 'yz_users', 'yct_impressions': 'yz_views',
                    'dau': 'dau', 'display_rate': 'display_rate'
                };

                const mappedRows = difyRows.map(row => {
                    const newRow = {};
                    for (const [cnKey, value] of Object.entries(row)) {
                        const enKey = DIFY_RESULT_MAP[cnKey] || cnKey;
                        newRow[enKey] = (value === '' || value === 'null') ? null : value;
                    }
                    // 新字段默认值：DIFY 未返回时补 0
                    if (newRow.yz_users == null) newRow.yz_users = 0;
                    if (newRow.yz_views == null) newRow.yz_views = 0;
                    if (newRow.dau == null) newRow.dau = 0;
                    if (newRow.display_rate == null) newRow.display_rate = 0;
                    return newRow;
                });

                // 过滤无效行：stat_date 为 NOT NULL
                const validRows = mappedRows.filter(row => row.stat_date != null);
                if (validRows.length < mappedRows.length) {
                    console.warn(`[复盘搭子] 跳过 ${mappedRows.length - validRows.length} 行无效数据 (缺少 stat_date)`);
                }

                // 按 stat_date 去重，保留最后一条（DIFY 返回重复日期时只保留最新）
                const dedupedMap = new Map();
                for (const row of validRows) {
                    dedupedMap.set(String(row.stat_date), row);
                }
                const dedupedRows = [...dedupedMap.values()];
                if (dedupedRows.length < validRows.length) {
                    console.warn(`[复盘搭子] 去重: ${validRows.length} → ${dedupedRows.length} 行 (移除 ${validRows.length - dedupedRows.length} 条重复日期)`);
                }

                // 批量 upsert
                const cols = ['stat_date', 'scan_users', 'scan_views', 'partner_visits', 'yz_users', 'yz_views', 'dau', 'display_rate'];
                if (dedupedRows.length > 0) {
                    const allValues = [];
                    const allPlaceholders = [];
                    let paramIdx = 1;

                    for (const row of dedupedRows) {
                        const vals = cols.map(c => {
                            const v = row[c];
                            if (v === null || v === undefined || v === '') return null;
                            if (c === 'stat_date') return v;
                            if (c === 'scan_users' || c === 'scan_views' || c === 'partner_visits' || c === 'yz_users' || c === 'yz_views' || c === 'dau') {
                                const n = parseInt(v, 10);
                                return isNaN(n) ? 0 : n;
                            }
                            if (c === 'display_rate') {
                                const n = parseFloat(v);
                                return isNaN(n) ? 0 : n;
                            }
                            return String(v);
                        });
                        allValues.push(...vals);
                        const ph = cols.map((_, i) => `$${paramIdx + i}`).join(',');
                        allPlaceholders.push(`(${ph})`);
                        paramIdx += cols.length;
                    }

                    const updateSet = cols.filter(c => c !== 'stat_date').map(c => `${c} = EXCLUDED.${c}`).join(',');

                    await pool.query(
                        `INSERT INTO sys_review_mini_program (${cols.join(',')})
                         VALUES ${allPlaceholders.join(',')}
                         ON CONFLICT (stat_date)
                         DO UPDATE SET ${updateSet}`,
                        allValues
                    );
                    insertedCount = dedupedRows.length;
                }
                console.log(`[复盘搭子] 小程序数据已存入数据库: ${insertedCount} 行`);
            } catch (parseErr) {
                console.error('[复盘搭子] 解析 DIFY 返回数据失败:', parseErr.message);
                return res.status(200).json({
                    success: false,
                    message: `数据解析失败: ${parseErr.message}`,
                    data: outputs
                });
            }
        }

        res.json({
            success: true,
            message: `数据整理完成，已存入 ${insertedCount} 条记录`,
            data: outputs
        });

    } catch (e) {
        console.error('[复盘搭子] 小程序上传失败', e);
        res.status(500).json({ success: false, message: e.message });
    } finally {
        cleanupMiniProgramFiles(req.files);
    }
});

// ============================================================
// 4. 点餐聚合页情况 - 查询数据
// ============================================================
router.get('/order-page', async (req, res) => {
    try {
        const { start_date, end_date } = req.query;
        let sql = `SELECT id, to_char(stat_date, 'YYYY-MM-DD') AS stat_date,
                   nayuki, heytea, starbucks, jasmine, tasiting, cudi, mcdonalds, luckin, kfc
                   FROM sys_review_order_page`;
        const params = [];
        const conditions = [];
        if (start_date) { params.push(start_date); conditions.push(`stat_date >= $${params.length}`); }
        if (end_date) { params.push(end_date); conditions.push(`stat_date <= $${params.length}`); }
        if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
        sql += ' ORDER BY stat_date ASC';
        const result = await pool.query(sql, params);
        const whereLog = params.length > 0 ? `WHERE stat_date BETWEEN $1 AND $2` : '无条件';
        console.log(`[复盘搭子] 查询点餐聚合页情况: ${whereLog}, 返回 ${result.rows.length} 行`);
        res.json({ success: true, data: result.rows });
    } catch (e) {
        console.error('[复盘搭子-点餐聚合页] 查询失败:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ============================================================
// 5. 点餐聚合页情况 - 上传 Excel 并解析入库
// ============================================================
const cleanupOrderPageFiles = (files) => {
    if (!files) return;
    const file = files.order_page?.[0];
    if (file?.path) {
        try { fs.unlinkSync(file.path); } catch (_) { console.warn('[复盘搭子] 清理临时文件失败:', file.path); }
    }
};

router.post('/order-page/upload', (req, res, next) => {
    upload.fields([{ name: 'order_page', maxCount: 1 }])(req, res, (err) => {
        if (err) {
            cleanupOrderPageFiles(req.files);
            return res.status(400).json({ success: false, message: err.message });
        }
        next();
    });
}, async (req, res) => {
    try {
        const file = req.files?.order_page?.[0];
        if (!file) {
            return res.status(400).json({ success: false, message: '请上传 Excel 文件' });
        }

        const ext = path.extname(file.originalname).toLowerCase();
        if (!['.xls', '.xlsx'].includes(ext)) {
            cleanupOrderPageFiles(req.files);
            return res.status(400).json({ success: false, message: `不支持的文件格式: ${file.originalname}，仅支持 .xls/.xlsx` });
        }

        const logAudit = req.app.get('logAudit') || (() => {});
        logAudit(req, { module: 'REVIEW_PARTNER', action: 'UPLOAD_ORDER_PAGE', details: { file: file.originalname } });

        // ── 解析推广明细表格（参考 Python convert_promotion 逻辑）──
        const buffer = await fs.promises.readFile(file.path);
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

        // 定位表头行：找到同时包含"日期"和"素材名称"的行
        let headerIdx = -1;
        let headerColMap = {};
        for (let i = 0; i < Math.min(rawRows.length, 15); i++) {
            const row = rawRows[i] || [];
            const colMap = {};
            for (let c = 0; c < row.length; c++) {
                const name = String(row[c] || '').trim();
                if (name) colMap[name] = c;
            }
            if (colMap['日期'] !== undefined && colMap['素材名称'] !== undefined) {
                headerIdx = i;
                headerColMap = colMap;
                break;
            }
        }
        if (headerIdx === -1) {
            cleanupOrderPageFiles(req.files);
            return res.status(400).json({ success: false, message: '未找到表头行（缺少"日期"或"素材名称"列）' });
        }

        const dateCol = headerColMap['日期'];
        const brandCol = headerColMap['素材名称'];
        const visitorsCol = headerColMap['访问人数'];
        const visitsCol = headerColMap['访问次数'];
        const newUsersCol = headerColMap['新增用户数'];
        const txUsersCol = headerColMap['交易人数'];
        const txAmountCol = headerColMap['交易金额'];
        const txCountCol = headerColMap['交易笔数'];
        const txRateCol = headerColMap['交易转化率'];

        // 解析数据行
        const parsedRows = [];
        for (let i = headerIdx + 1; i < rawRows.length; i++) {
            const row = rawRows[i] || [];
            const dateVal = String(row[dateCol] ?? '').trim();
            const brandVal = String(row[brandCol] ?? '').trim();
            if (!dateVal || !brandVal) continue;

            parsedRows.push({
                date: dateVal,
                brand: brandVal,
                visitors: parseInt(parseFloat(row[visitorsCol] || 0), 10) || 0,
                visits: parseInt(parseFloat(row[visitsCol] || 0), 10) || 0,
                new_users: parseInt(parseFloat(row[newUsersCol] || 0), 10) || 0,
                transaction_users: parseInt(parseFloat(row[txUsersCol] || 0), 10) || 0,
                transaction_amount: round2(parseFloat(row[txAmountCol] || 0)),
                transaction_count: parseInt(parseFloat(row[txCountCol] || 0), 10) || 0,
                conversion_rate: round4(parseFloat(row[txRateCol] || 0)),
            });
        }

        if (parsedRows.length === 0) {
            cleanupOrderPageFiles(req.files);
            return res.status(400).json({ success: false, message: '未解析到有效数据行' });
        }

        console.log(`[复盘搭子-点餐聚合页] 解析到 ${parsedRows.length} 行数据，准备调用 DIFY 工作流`);

        // 调用 DIFY 工作流
        const apiKey = process.env.DIFY_ORDER_PAGE_API_KEY;
        let apiUrl = process.env.DIFY_ORDER_PAGE_API_URL;
        if (apiUrl && !apiUrl.endsWith('/v1')) {
            apiUrl = `${apiUrl.replace(/\/$/, '')}/v1`;
        }

        if (!apiKey || !apiUrl) {
            return res.status(500).json({ success: false, message: '服务端未配置 DIFY_ORDER_PAGE_API_KEY / DIFY_ORDER_PAGE_API_URL' });
        }

        const beginDate = req.body?.begin_date || '';
        const endDate = req.body?.end_date || '';
        if (!beginDate || !endDate || !/^\d{8}$/.test(beginDate) || !/^\d{8}$/.test(endDate)) {
            cleanupOrderPageFiles(req.files);
            return res.status(400).json({ success: false, message: 'begin_date 和 end_date 必须为 YYYYMMDD 格式' });
        }
        // 转换为 YYYY/MM/DD 格式传给 DIFY
        const difyBeginDate = `${beginDate.slice(0, 4)}/${beginDate.slice(4, 6)}/${beginDate.slice(6, 8)}`;
        const difyEndDate = `${endDate.slice(0, 4)}/${endDate.slice(4, 6)}/${endDate.slice(6, 8)}`;
        console.log(`[复盘搭子-点餐聚合页] 日期范围: ${difyBeginDate} ~ ${difyEndDate}`);

        const payload = {
            inputs: {
                promotion_data_json: JSON.stringify(parsedRows),
                begin_date: difyBeginDate,
                end_date: difyEndDate
            },
            response_mode: 'blocking',
            user: req.user?.username || 'web_os_user'
        };

        console.log('[复盘搭子-点餐聚合页] 调用 DIFY 工作流...');
        const difyRes = await fetch(`${apiUrl}/workflows/run`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!difyRes.ok) {
            const errText = await difyRes.text();
            console.error(`[复盘搭子-点餐聚合页] DIFY 工作流调用失败: ${difyRes.status} - ${errText}`);
            cleanupOrderPageFiles(req.files);
            return res.status(difyRes.status).json({
                success: false,
                message: `工作流调用失败: ${difyRes.status}`,
                details: errText.substring(0, 300)
            });
        }

        const resultData = await difyRes.json();
        console.log('[复盘搭子-点餐聚合页] DIFY 工作流执行成功');

        // 解析 DIFY 返回的 result_json 并存入数据库
        // DIFY 返回格式: { brands: [...], data: [{日期, 奈雪, 喜茶, ...}, ...], total_dates: N }
        const outputs = resultData?.data?.outputs || resultData?.data || resultData;
        let insertedCount = 0;
        if (outputs?.result_json) {
            try {
                const difyResult = JSON.parse(outputs.result_json);
                const difyData = difyResult.data || difyResult;
                console.log(`[复盘搭子-点餐聚合页] DIFY 返回 ${difyData.length} 行数据`);

                // 品牌名 → 数据库列名映射
                const BRAND_MAP = {
                    '奈雪': 'nayuki', '喜茶': 'heytea', '星爸爸': 'starbucks',
                    '茉莉奶白': 'jasmine', '塔斯汀': 'tasiting', '库迪': 'cudi',
                    '麦当当': 'mcdonalds', '瑞幸咖啡': 'luckin', '肯德基': 'kfc'
                };

                // 转换 DIFY 数据为数据库行
                const dbRows = difyData.map(row => {
                    const dbRow = { stat_date: null };
                    for (const [key, value] of Object.entries(row)) {
                        if (key === '日期' || key === 'date') {
                            let d = String(value).trim();
                            if (/^\d{8}$/.test(d)) d = `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;
                            else if (/^\d{4}\/\d{2}\/\d{2}$/.test(d)) d = d.replace(/\//g, '-');
                            dbRow.stat_date = d;
                        } else if (BRAND_MAP[key]) {
                            dbRow[BRAND_MAP[key]] = parseInt(value, 10) || 0;
                        }
                    }
                    return dbRow;
                }).filter(r => r.stat_date != null);

                if (dbRows.length === 0) {
                    cleanupOrderPageFiles(req.files);
                    return res.status(400).json({ success: false, message: 'DIFY 返回数据中无有效日期' });
                }

                // 批量 upsert
                const cols = ['stat_date', 'nayuki', 'heytea', 'starbucks', 'jasmine', 'tasiting', 'cudi', 'mcdonalds', 'luckin', 'kfc'];
                const allValues = [];
                const allPlaceholders = [];
                let paramIdx = 1;

                for (const row of dbRows) {
                    const vals = cols.map(c => row[c] ?? 0);
                    allValues.push(...vals);
                    const ph = cols.map((_, i) => `$${paramIdx + i}`).join(',');
                    allPlaceholders.push(`(${ph})`);
                    paramIdx += cols.length;
                }

                const brandCols = cols.slice(1);
                const updateSet = brandCols.map(c => `${c} = EXCLUDED.${c}`).join(',');

                await pool.query(
                    `INSERT INTO sys_review_order_page (${cols.join(',')})
                     VALUES ${allPlaceholders.join(',')}
                     ON CONFLICT (stat_date)
                     DO UPDATE SET ${updateSet}`,
                    allValues
                );
                insertedCount = dbRows.length;
                console.log(`[复盘搭子-点餐聚合页] 数据已存入数据库: ${insertedCount} 行`);
            } catch (parseErr) {
                console.error('[复盘搭子-点餐聚合页] 解析 DIFY 返回数据失败:', parseErr.message);
                cleanupOrderPageFiles(req.files);
                return res.status(200).json({
                    success: false,
                    message: `数据解析失败: ${parseErr.message}`,
                    data: outputs
                });
            }
        }

        cleanupOrderPageFiles(req.files);
        res.json({
            success: true,
            message: `数据整理完成，已存入 ${insertedCount} 条记录`,
            data: outputs
        });

    } catch (e) {
        console.error('[复盘搭子-点餐聚合页] 上传失败', e);
        cleanupOrderPageFiles(req.files);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ============================================================
// 交易情况 — 查询
// ============================================================
router.get('/transaction', async (req, res) => {
    try {
        const { start_date, end_date } = req.query;
        let sql = `SELECT id, to_char(stat_date, 'YYYY-MM-DD') AS stat_date,
                   online_goods, virtual_card, cash_coupon, phone_recharge, dining, movie_ticket,
                   transaction_users, transaction_count
                   FROM sys_review_transaction`;
        const params = [];
        const conditions = [];
        if (start_date) { conditions.push('stat_date >= $' + (params.length + 1)); params.push(start_date); }
        if (end_date) { conditions.push('stat_date <= $' + (params.length + 1)); params.push(end_date); }
        if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
        sql += ' ORDER BY stat_date DESC';
        const result = await pool.query(sql, params);
        const whereLog = params.length > 0 ? `WHERE stat_date BETWEEN $1 AND $2` : '无条件';
        console.log(`[复盘搭子] 查询交易情况: ${whereLog}, 返回 ${result.rows.length} 行`);
        res.json({ success: true, data: result.rows });
    } catch (e) {
        console.error('[复盘搭子-交易情况] 查询失败', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ============================================================
// 交易情况 — 上传 Excel 并解析
// ============================================================
const cleanupTransactionFiles = (files) => {
    if (!files) return;
    ['order_list', 'local_life'].forEach(name => {
        const file = files[name]?.[0];
        if (file?.path) {
            try { fs.unlinkSync(file.path); } catch (_) { console.warn('[复盘搭子] 清理临时文件失败:', file.path); }
        }
    });
};

router.post('/transaction/upload', (req, res, next) => {
    upload.fields([{ name: 'order_list', maxCount: 1 }, { name: 'local_life', maxCount: 1 }])(req, res, (err) => {
        if (err) {
            cleanupTransactionFiles(req.files);
            return res.status(400).json({ success: false, message: err.message });
        }
        next();
    });
}, async (req, res) => {
    try {
        const orderListFile = req.files?.['order_list']?.[0];
        const localLifeFile = req.files?.['local_life']?.[0];
        if (!orderListFile || !localLifeFile) {
            cleanupTransactionFiles(req.files);
            return res.status(400).json({ success: false, message: '请上传全部 2 个 Excel 文件' });
        }

        const logAudit = req.app.get('logAudit') || (() => {});
        logAudit(req, { module: 'REVIEW_PARTNER', action: 'UPLOAD_TRANSACTION', details: { files: [orderListFile.originalname, localLifeFile.originalname] } });

        // ── Excel 日期序列号 → YYYY/MM/DD ──
        const formatExcelDate = (val) => {
            if (val == null || val === '') return '';
            // 已经是 Date 对象
            if (val instanceof Date) {
                const y = val.getFullYear();
                const m = String(val.getMonth() + 1).padStart(2, '0');
                const d = String(val.getDate()).padStart(2, '0');
                return `${y}/${m}/${d}`;
            }
            const str = String(val).trim();
            // 已经是日期字符串（含 - 或 /）直接返回
            if (str.includes('-') || str.includes('/')) {
                return str.replace(/-/g, '/');
            }
            const num = parseFloat(str);
            if (isNaN(num)) return str;
            // Excel 序列号转日期（1900 日期系统）
            const date = new Date(Math.round((num - 25569) * 86400 * 1000));
            const y = date.getUTCFullYear();
            const m = String(date.getUTCMonth() + 1).padStart(2, '0');
            const d = String(date.getUTCDate()).padStart(2, '0');
            return `${y}/${m}/${d}`;
        };

        // ── 解析订单列表（读取所有 Sheet）──
        const parseOrderList = (filePath) => {
            const buffer = fs.readFileSync(filePath);
            const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
            const records = [];
            for (const sheetName of workbook.SheetNames) {
                const sheet = workbook.Sheets[sheetName];
                const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
                for (const row of rows) {
                    const phone = row['下单账号'];
                    records.push({
                        '支付状态': String(row['支付状态'] || '').trim(),
                        '发货方式': String(row['发货方式'] || '').trim(),
                        '下单时间': formatExcelDate(row['下单时间']),
                        '下单账号': phone != null ? String(Math.round(Number(phone))) : '',
                        '实付款': row['实付款'] != null ? Math.round(parseFloat(row['实付款']) * 100) / 100 : 0,
                    });
                }
            }
            return records;
        };

        // ── 解析本地生活订单 ──
        const parseLocalLife = (filePath) => {
            const buffer = fs.readFileSync(filePath);
            const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
            const records = [];
            for (const row of rows) {
                const phone = row['买家手机号'];
                records.push({
                    '支付状态': String(row['支付状态'] || '').trim(),
                    '业务类型': String(row['业务类型'] || '').trim(),
                    '下单时间': formatExcelDate(row['下单时间']),
                    '付款金额': row['付款金额'] != null ? Math.round(parseFloat(row['付款金额']) * 100) / 100 : 0,
                    '买家手机号': phone != null ? String(Math.round(Number(phone))) : '',
                });
            }
            return records;
        };

        const orderListJson = parseOrderList(orderListFile.path);
        const localLifeJson = parseLocalLife(localLifeFile.path);

        console.log(`[复盘搭子-交易情况] 解析完成：订单列表 ${orderListJson.length} 行，本地生活 ${localLifeJson.length} 行`);

        if (orderListJson.length === 0 && localLifeJson.length === 0) {
            cleanupTransactionFiles(req.files);
            return res.status(400).json({ success: false, message: '两个文件均无数据' });
        }

        // ── 调用 DIFY 工作流 ──
        const apiKey = process.env.DIFY_TRANSACTION_API_KEY;
        let apiUrl = process.env.DIFY_TRANSACTION_API_URL;
        if (apiUrl && !apiUrl.endsWith('/v1')) {
            apiUrl = `${apiUrl.replace(/\/$/, '')}/v1`;
        }
        if (!apiKey || !apiUrl) {
            return res.status(500).json({ success: false, message: '服务端未配置 DIFY_TRANSACTION_API_KEY / DIFY_TRANSACTION_API_URL' });
        }

        const payload = {
            inputs: {
                order_list_json: JSON.stringify(orderListJson),
                local_life_json: JSON.stringify(localLifeJson),
            },
            response_mode: 'blocking',
            user: req.user?.username || 'web_os_user'
        };

        console.log('[复盘搭子-交易情况] 调用 DIFY 工作流...');
        const difyRes = await fetch(`${apiUrl}/workflows/run`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!difyRes.ok) {
            const errText = await difyRes.text();
            console.error(`[复盘搭子-交易情况] DIFY 工作流调用失败: ${difyRes.status} - ${errText}`);
            cleanupTransactionFiles(req.files);
            return res.status(difyRes.status).json({
                success: false,
                message: `工作流调用失败: ${difyRes.status}`,
                details: errText.substring(0, 300)
            });
        }

        const resultData = await difyRes.json();
        console.log('[复盘搭子-交易情况] DIFY 工作流执行成功');

        // ── 解析 DIFY 返回结果 ──
        const outputs = resultData?.data?.outputs || resultData?.data || resultData;
        let rawResult = outputs?.result || outputs?.result_json || '[]';
        if (typeof rawResult === 'string') rawResult = JSON.parse(rawResult);

        // DIFY 返回: [{下单时间, 电话号码, 付款金额, 业务类型}, ...]
        // 业务类型映射 → 数据库字段
        const BIZ_TYPE_MAP = {
            '线上货物': 'online_goods',
            '虚拟卡券': 'virtual_card',
            '立减金': 'cash_coupon',
            '话费充值': 'phone_recharge',
            '大牌点餐': 'dining',
            '电影票购买': 'movie_ticket',
        };

        // 日期格式化: "2026/08/16" → "2026-08-16"
        const normalizeDate = (d) => String(d || '').trim().replace(/\//g, '-');

        // 按日期聚合
        const dateMap = new Map(); // date → { amounts: {}, users: Set, counts: {} }
        for (const item of rawResult) {
            const date = normalizeDate(item['下单时间']);
            const phone = String(item['电话号码'] || '').trim();
            const amount = parseFloat(item['付款金额']) || 0;
            const bizType = String(item['业务类型'] || '').trim();
            const dbCol = BIZ_TYPE_MAP[bizType];
            if (!date || !dbCol) continue;

            if (!dateMap.has(date)) {
                dateMap.set(date, { amounts: {}, users: new Set(), counts: {} });
            }
            const day = dateMap.get(date);

            // 金额累加
            day.amounts[dbCol] = (day.amounts[dbCol] || 0) + amount;

            // 交易人数：按日期+电话号码+业务类型 去重
            const userKey = `${phone}_${bizType}`;
            if (!day.users.has(userKey)) {
                day.users.add(userKey);
                day.counts[dbCol] = (day.counts[dbCol] || 0) + 1;
            }
        }

        // ── 写入数据库 ──
        let insertedCount = 0;
        for (const [date, day] of dateMap) {
            const online = day.amounts['online_goods'] || 0;
            const virtual = day.amounts['virtual_card'] || 0;
            const cash = day.amounts['cash_coupon'] || 0;
            const dining = day.amounts['dining'] || 0;
            const movie = day.amounts['movie_ticket'] || 0;
            const totalUsers = day.users.size;
            const totalCount = Object.values(day.counts).reduce((s, v) => s + v, 0);

            await pool.query(
                `INSERT INTO sys_review_transaction
                   (stat_date, online_goods, virtual_card, cash_coupon, dining, movie_ticket,
                    transaction_users, transaction_count)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                 ON CONFLICT (stat_date) DO UPDATE SET
                   online_goods=EXCLUDED.online_goods, virtual_card=EXCLUDED.virtual_card,
                   dining=EXCLUDED.dining`,
                [date, online, virtual, cash, dining, movie,
                 totalUsers, totalCount]
            );
            // 同步交易人数到小程序访问情况（日期不存在则新增，存在则更新）
            await pool.query(
                `INSERT INTO sys_review_mini_program (stat_date, transaction_users)
                 VALUES ($1, $2)
                 ON CONFLICT (stat_date) DO UPDATE SET transaction_users = EXCLUDED.transaction_users`,
                [date, totalUsers]
            );
            insertedCount++;
        }

        cleanupTransactionFiles(req.files);
        res.json({
            success: true,
            message: `交易数据整理完成，共 ${insertedCount} 天记录`,
        });

    } catch (e) {
        console.error('[复盘搭子-交易情况] 上传失败', e);
        cleanupTransactionFiles(req.files);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ── POST /transaction/add  手动新增一条按天记录 ──
router.post('/transaction/add', async (req, res) => {
    try {
        const { stat_date, online_goods, virtual_card, cash_coupon, phone_recharge, dining, movie_ticket, transaction_users, transaction_count } = req.body;
        if (!stat_date) return res.status(400).json({ success: false, message: '日期不能为空' });

        // 检查日期是否已存在
        const exist = await pool.query('SELECT 1 FROM sys_review_transaction WHERE stat_date=$1', [stat_date]);
        if (exist.rowCount > 0) {
            return res.status(409).json({ success: false, message: `日期 ${stat_date} 已存在，不可重复新增` });
        }

        await pool.query(
            `INSERT INTO sys_review_transaction
               (stat_date, online_goods, virtual_card, cash_coupon, phone_recharge, dining, movie_ticket,
                transaction_users, transaction_count)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
                stat_date,
                parseFloat(online_goods) || 0,
                parseFloat(virtual_card) || 0,
                parseFloat(cash_coupon) || 0,
                parseFloat(phone_recharge) || 0,
                parseFloat(dining) || 0,
                parseFloat(movie_ticket) || 0,
                parseInt(transaction_users) || 0,
                parseInt(transaction_count) || 0
            ]
        );
        // 同步交易人数到小程序访问情况（日期不存在则新增，存在则更新）
        await pool.query(
            `INSERT INTO sys_review_mini_program (stat_date, transaction_users)
             VALUES ($1, $2)
             ON CONFLICT (stat_date) DO UPDATE SET transaction_users = EXCLUDED.transaction_users`,
            [stat_date, parseInt(transaction_users) || 0]
        );
        console.log(`[复盘搭子-交易情况] 手动新增 ${stat_date}`);
        res.json({ success: true, message: '新增成功' });
    } catch (e) {
        console.error('[复盘搭子] 新增交易记录失败:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ── PATCH /transaction/:date  手动编辑指定字段 ──
router.patch('/transaction/:date', async (req, res) => {
    try {
        const { date } = req.params;
        const allowedFields = ['phone_recharge', 'cash_coupon', 'movie_ticket', 'transaction_users', 'transaction_count'];
        const updates = {};
        for (const f of allowedFields) {
            if (req.body[f] !== undefined) {
                updates[f] = parseFloat(req.body[f]) || 0;
            }
        }
        const keys = Object.keys(updates);
        if (keys.length === 0) return res.status(400).json({ success: false, message: '无可更新字段' });
        const setClauses = keys.map((k, i) => `${k}=$${i + 1}`);
        const values = keys.map(k => updates[k]);
        values.push(date);
        const sql = `UPDATE sys_review_transaction SET ${setClauses.join(', ')} WHERE stat_date=$${keys.length + 1}`;
        const result = await pool.query(sql, values);
        if (result.rowCount === 0) return res.status(404).json({ success: false, message: '未找到该日期记录' });
        // 如果更新了交易人数，同步到小程序访问情况（日期不存在则新增，存在则更新）
        if (updates.transaction_users !== undefined) {
            await pool.query(
                `INSERT INTO sys_review_mini_program (stat_date, transaction_users)
                 VALUES ($1, $2)
                 ON CONFLICT (stat_date) DO UPDATE SET transaction_users = EXCLUDED.transaction_users`,
                [date, updates.transaction_users]
            );
        }
        console.log(`[复盘搭子-交易情况] 手动更新 ${date}: ${JSON.stringify(updates)}`);
        res.json({ success: true, message: '更新成功' });
    } catch (e) {
        console.error('[复盘搭子-交易情况] 手动更新失败', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

export default router;
