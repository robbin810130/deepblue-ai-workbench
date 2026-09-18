import express from 'express';
import multer from 'multer';
import XLSX from 'xlsx';
import pool from './db.js';

const router = express.Router();

// ─── 读取全部配置（任何登录用户可读） ─────────────────────────────────────────
router.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT config_key, config_val, remark FROM sys_logistics_config ORDER BY id');
        const config = {};
        for (const row of result.rows) {
            config[row.config_key] = Number(row.config_val);
        }
        res.json({ success: true, data: config });
    } catch (err) {
        console.error('[LogisticsConfig] GET error:', err.message);
        res.status(500).json({ success: false, message: '读取配置失败：' + err.message });
    }
});

// ─── 读取全部耗材（任何登录用户可读） ─────────────────────────────────────────
router.get('/packaging', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, name, attribute, category, spec, dim_l, dim_w, dim_h, volume, price, weight, sort_order
             FROM sys_logistics_packaging
             WHERE is_active = TRUE
             ORDER BY category, sort_order`
        );
        const list = result.rows.map(r => ({
            id: r.id,
            name: r.name,
            attribute: r.attribute,
            category: r.category,
            spec: r.spec,
            l: Number(r.dim_l),
            w: Number(r.dim_w),
            h: Number(r.dim_h),
            volume: Number(r.volume),
            price: Number(r.price),
            weight: Number(r.weight),
        }));
        res.json({ success: true, data: list });
    } catch (err) {
        console.error('[LogisticsConfig] GET packaging error:', err.message);
        res.status(500).json({ success: false, message: '读取耗材数据失败：' + err.message });
    }
});

// ─── 耗材表格导入：解析xlsx"耗材价格表" → 清空表 → 批量插入 ─────────────────
const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/** 从规格描述中提取长*宽*高(cm)，如 "外径：21*11*14cm（3层k纸加硬）" */
function parseDimsFromSpec(spec) {
    const m = String(spec || '').match(/(\d+(?:\.\d+)?)\s*[*×xX]\s*(\d+(?:\.\d+)?)\s*[*×xX]\s*(\d+(?:\.\d+)?)/);
    if (!m) return { l: 0, w: 0, h: 0 };
    return { l: parseFloat(m[1]), w: parseFloat(m[2]), h: parseFloat(m[3]) };
}

/** 属性文本 → 耗材类别 */
function attrToCategory(attr) {
    const a = String(attr || '');
    if (a.includes('5层')) return 'carton_5';
    if (a.includes('3层')) return 'carton_3';
    if (a.includes('快递袋')) return 'express_bag';
    if (a.includes('套头')) return 'sleeve';
    return '';
}

function toNum(v, def = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
}

router.post('/packaging/import', importUpload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: '未找到上传文件' });
        }

        const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheetName = wb.SheetNames.find(n => n.includes('耗材')) || wb.SheetNames[0];
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });

        // 定位表头行（包含"名称"列）
        const headerIdx = rows.findIndex(r => r.some(c => String(c).trim() === '名称'));
        if (headerIdx === -1) {
            return res.status(400).json({ success: false, message: '未找到表头行（需包含"名称"列）' });
        }
        const header = rows[headerIdx].map(c => String(c).trim());
        const colIdx = (name) => header.findIndex(h => h === name || h.includes(name));
        const colName = colIdx('名称');
        const colAttr = colIdx('属性');
        const colSpec = colIdx('规格');
        const colPrice = colIdx('最低价');
        const colWeight = colIdx('重量');

        const items = [];
        for (const row of rows.slice(headerIdx + 1)) {
            const name = String(row[colName] || '').trim();
            if (!name) continue; // 跳过空行
            const attribute = colAttr === -1 ? '' : String(row[colAttr] ?? '').trim();
            const spec = colSpec === -1 ? '' : String(row[colSpec] ?? '').trim();
            const { l, w, h } = parseDimsFromSpec(spec);
            items.push({
                name,
                attribute,
                category: attrToCategory(attribute),
                spec,
                dim_l: l,
                dim_w: w,
                dim_h: h,
                volume: +(l * w * h).toFixed(2),
                price: colPrice === -1 ? 0 : toNum(row[colPrice]),
                weight: colWeight === -1 ? 0 : toNum(row[colWeight]),
            });
        }

        if (items.length === 0) {
            return res.status(400).json({ success: false, message: '表格中没有可导入的耗材数据' });
        }

        // 事务：先清空全表再导入
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query('DELETE FROM sys_logistics_packaging');
            for (let i = 0; i < items.length; i++) {
                const it = items[i];
                await client.query(
                    `INSERT INTO sys_logistics_packaging
                        (name, attribute, category, spec, dim_l, dim_w, dim_h, volume, price, weight, sort_order)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
                    [it.name, it.attribute, it.category, it.spec, it.dim_l, it.dim_w, it.dim_h, it.volume, it.price, it.weight, i + 1]
                );
            }
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }

        res.json({ success: true, count: items.length });
    } catch (err) {
        console.error('[LogisticsConfig] packaging import error:', err.message);
        res.status(500).json({ success: false, message: '耗材导入失败：' + err.message });
    }
});

// ─── 查询打包方案（统一接口，type=single|multi，支持关键词搜索） ─────────────────
router.get('/packaging-plans', async (req, res) => {
    try {
        const { type = 'single', keyword, page = 1, pageSize = 20 } = req.query;
        const planType = type === 'multi' ? 'multi' : 'single';
        const offset = (Number(page) - 1) * Number(pageSize);

        const conditions = [`plan_type = $1`];
        const params = [planType];

        if (keyword && keyword.trim()) {
            const searchField = planType === 'multi' ? 'product_codes' : 'product_code';
            conditions.push(`(${searchField} ILIKE $2 OR product_name ILIKE $2 OR packaging_material ILIKE $2)`);
            params.push(`%${keyword.trim()}%`);
        }

        const whereClause = `WHERE ${conditions.join(' AND ')}`;

        const countResult = await pool.query(
            `SELECT COUNT(*) FROM sys_logistics_packaging_plan ${whereClause}`,
            params
        );
        const total = Number(countResult.rows[0].count);

        const dataParams = [...params];
        const dataSql = `
            SELECT id, plan_type, seq, product_code, product_codes, code_qty, product_name,
                   weight, volume, packaging_plan, packaging_material, attribute,
                   material_code, sleeve, wrap_film, express_cost,
                   material_cost_box, material_cost_sleeve, material_cost_wrap,
                   extra_packing_fee, loading_fee, total_cost, remark
            FROM sys_logistics_packaging_plan
            ${whereClause}
            ORDER BY plan_type, ${planType === 'single' ? 'seq' : 'id'}
            LIMIT $${dataParams.length + 1} OFFSET $${dataParams.length + 2}
        `;
        dataParams.push(Number(pageSize), offset);
        const dataResult = await pool.query(dataSql, dataParams);

        res.json({
            success: true,
            data: dataResult.rows,
            pagination: {
                page: Number(page),
                pageSize: Number(pageSize),
                total,
                totalPages: Math.ceil(total / Number(pageSize))
            }
        });
    } catch (err) {
        console.error('[LogisticsConfig] GET packaging-plans error:', err.message);
        res.status(500).json({ success: false, message: '查询打包方案失败：' + err.message });
    }
});

// ─── 模型自动识别：图片+文字 → Dify 工作流 → 商品尺寸重量 ─────────────────────
const RECOGNIZE_MAX_IMAGES = 5;
const recognizeUpload = multer({
    storage: multer.memoryStorage(),
    limits: { files: RECOGNIZE_MAX_IMAGES, fileSize: 10 * 1024 * 1024 },
});

/** 从 Dify 输出文本中提取 JSON（兼容 markdown 代码围栏与前后缀杂文本） */
function extractDifyJson(raw) {
    if (raw === undefined || raw === null) return null;
    let text = typeof raw === 'object' ? JSON.stringify(raw) : String(raw).trim();
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) text = fence[1].trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) text = text.slice(start, end + 1);
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

router.post('/recognize', recognizeUpload.array('images', RECOGNIZE_MAX_IMAGES), async (req, res) => {
    try {
        const files = req.files || [];
        const text = (req.body.text || '').trim();
        if (files.length === 0 && !text) {
            return res.status(400).json({ success: false, message: '请至少上传1张图片或输入文字说明' });
        }

        const apiKey = process.env.DIFY_LOGISTICS_RECOGNIZE_API_KEY;
        let apiUrl = process.env.DIFY_LOGISTICS_RECOGNIZE_API_URL;
        if (!apiKey || !apiUrl) {
            return res.status(500).json({ success: false, message: '服务端未配置 DIFY_LOGISTICS_RECOGNIZE_API_KEY' });
        }
        if (!apiUrl.endsWith('/v1')) {
            apiUrl = `${apiUrl.replace(/\/$/, '')}/v1`;
        }

        const user = req.user?.username || 'web_os_user';
        const { Blob: NodeBlob } = await import('buffer');

        // 1. 逐张转发至 Dify files/upload，换取 upload_file_id
        const fileRefs = [];
        for (const file of files) {
            const formData = new FormData();
            const blob = new NodeBlob([file.buffer], { type: file.mimetype });
            const fileName = Buffer.from(file.originalname, 'latin1').toString('utf8');
            formData.append('file', blob, fileName);
            formData.append('user', user);

            const upRes = await fetch(`${apiUrl}/files/upload`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${apiKey}` },
                body: formData,
            });
            const upText = await upRes.text();
            if (!upRes.ok) {
                throw new Error(`Dify 图片上传失败 (${upRes.status}): ${upText.substring(0, 200)}`);
            }
            const upData = JSON.parse(upText);
            fileRefs.push({ type: 'image', transfer_method: 'local_file', upload_file_id: upData.id });
        }

        // 2. 调用工作流（文件字段必须为文件对象数组，不能包裹 {value: [...]}；图片与文字二选一，只传存在项）
        const inputs = {};
        if (fileRefs.length > 0) inputs.image_files = fileRefs;
        if (text) inputs.text = text;
        const payload = {
            inputs,
            response_mode: 'blocking',
            user,
        };
        const runRes = await fetch(`${apiUrl}/workflows/run`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });
        const runText = await runRes.text();
        if (!runRes.ok) {
            throw new Error(`Dify 工作流调用报错 (${runRes.status}): ${runText.substring(0, 300)}`);
        }

        // 3. 解析工作流输出 → {count, items:[{name,quantity,length_cm,width_cm,height_cm,weight_kg}]}
        const bodyData = JSON.parse(runText);
        const outputs = bodyData?.data?.outputs || {};

        // ① outputs 直接就是 {count, items} 结构化对象
        let parsed = null;
        if (outputs && Array.isArray(outputs.items)) {
            parsed = outputs;
        } else {
            // ② 输出落在 text/result/output 等字段中（可能为 JSON 字符串或 markdown 围栏包裹）
            let raw = outputs.text ?? outputs.result ?? outputs.output;
            if (raw === undefined) raw = outputs; // ③ 兜底：整体提取 JSON
            parsed = extractDifyJson(raw);
        }

        if (!parsed || !Array.isArray(parsed.items) || parsed.items.length === 0) {
            return res.json({ success: false, message: '模型未识别到商品信息，请调整图片后重试' });
        }
        res.json({ success: true, data: parsed });
    } catch (err) {
        console.error('[LogisticsConfig] recognize error:', err.message);
        res.status(500).json({ success: false, message: '模型识别失败：' + err.message });
    }
});

export default router;
