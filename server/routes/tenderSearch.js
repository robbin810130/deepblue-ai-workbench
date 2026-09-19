/**
 * tenderSearch 域路由（XO-01 server.js 拆解 · codemod 迁出）
 * 依赖经 __ctx 注入（getter 惰性取值）；segment 保持原注册位置，express 顺序零变化。
 */
import fs from 'fs';
import { authenticateToken } from '../infra/auth.js';
import { logAudit } from '../infra/audit.js';
import pool from '../db.js';
import * as legacyBridge from '../modules/tasks/legacyBridge.js';
import { ingestTenderOutputs } from '../modules/tender/tenderIngest.js';
import { difyKnowledgeService } from '../services/difyKnowledgeService.js';

export function segTenderSearch1(app, __ctx) {
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

        const result = await __ctx.runTenderSearchDify({
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
        const result = await __ctx.syncTenderStarredDetail({
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
app.post('/api/tender-search/upload-to-knowledge', authenticateToken, __ctx.upload.single('file'), async (req, res) => {
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
})
}
