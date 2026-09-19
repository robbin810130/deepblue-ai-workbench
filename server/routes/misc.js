/**
 * misc 域路由（XO-01 server.js 拆解 · codemod 迁出）
 * 依赖经 __ctx 注入（getter 惰性取值）；segment 保持原注册位置，express 顺序零变化。
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { logger } from '../infra/logger.js';
import { authenticateToken } from '../infra/auth.js';
import { logAudit } from '../infra/audit.js';
import pool from '../db.js';
import * as legacyBridge from '../modules/tasks/legacyBridge.js';
import { maskName, maskAmount, maskPhone, maskBrandBrands, maskProductNamesByBrandDict } from '../utils/maskingUtils.js';
import { extractBrandsFromProducts } from '../utils/aiUtils.js';

export function segMisc1(app, __ctx) {
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
        const filePath = path.join(__ctx.__dirname, '../public', 'sales_analysis_matrix.json');
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
        const filePath = path.join(__ctx.__dirname, '../public', 'monthly_forecast_baseline.json');
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
})
}

export function segMisc2(app, __ctx) {
app.post('/api/update-data', async (req, res) => {
    try {
        console.log('[API请求] 收到手动更新请求');
        logAudit(req, { module: 'PREDICTION', action: 'UPDATE_DATA' });
        const result = await __ctx.runPythonScript();
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
        lastUpdate: __ctx.lastUpdateStatus.lastUpdate,
        status: __ctx.lastUpdateStatus.status,
        message: __ctx.lastUpdateStatus.message,
        isRunning: __ctx.lastUpdateStatus.isRunning,
        nextUpdate: nextUpdate.toISOString()
    });
});

// 健康检查
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
})
}

export function segMisc3(app, __ctx) {
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
})
}

export function segMisc4(app, __ctx) {
app.post('/api/dify/upload', __ctx.upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: '未找到文件数据' });
        }
        logAudit(req, { module: 'LAYOUT_COMPARE', action: 'UPLOAD_FILE', target_data: __ctx.fixUploadedFileName(req.file.originalname) });

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

        // ── D4 试点迁移（TASK_CENTER_PILOT 含 layout_compare 时启用）──────────
        // 新前端传平台暂存 file_ids；旧 file_id（Dify id）继续走旧直连路径。
        // ⚠️ 风险：旧 Dify 工作流可能从 inputs.image_a/b 取图而非 sys.files，启用前需真环境确认。
        if (legacyBridge.isPilotSkill('layout_compare') && Array.isArray(req.body?.file_ids)) {
            try {
                const r = await legacyBridge.runThroughTaskCenter({
                    skillKey: 'layout_compare',
                    title: `版式对比（${req.body.file_ids.length} 张图）`,
                    user: req.user?.id ? req.user : { id: 0, username: 'layout_anonymous', role: 'user' },
                    inputs: { is_single_image: !!isSingle },
                    files: req.body.file_ids.map(String),
                });
                if (!r.ok) {
                    console.error(`[版式对比-任务中心] ${r.taskNo} 失败 ${r.errorCode}: ${r.message}`);
                    return res.status(500).json({ success: false, message: `任务执行失败（${r.taskNo}）：${r.message}` });
                }
                return res.json({ success: true, data: legacyBridge.stripThinkTags(legacyBridge.extractAnswerText(r.outputs ?? {})) });
            } catch (e) {
                console.error('[版式对比-任务中心] 异常:', e.message);
                return res.status(500).json({ success: false, message: e.message });
            }
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
})
}

export function segMisc5(app, __ctx) {
app.post('/api/generate-monthly-forecast', async (req, res) => {
    try {
        console.log('[API] 收到手动触发月度预测请求');
        logAudit(req, { module: 'PREDICTION', action: 'GENERATE_BASELINE' });
        await __ctx.generateMonthlyBaseline();
        const baselinePath = path.join(__ctx.__dirname, '../public', 'monthly_forecast_baseline.json');
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
})
}

export function segMisc6(app, __ctx) {
app.post('/api/track-deviation', async (req, res) => {
    try {
        logAudit(req, { module: 'PREDICTION', action: 'TRACK_DEVIATION' });
        res.json({ status: 'started', message: '偏差跟踪已启动' });
        // 异步执行，不阻塞响应
        __ctx.trackSalesDeviation();
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API端点：获取偏差告警
app.get('/api/deviation-alerts', (req, res) => {
    try {
        const trackingPath = path.join(__ctx.__dirname, '../public', 'forecast_tracking.json');
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
})
}

export function segMisc7(app, __ctx) {
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
            const features = await __ctx.extractCustomerFeaturesJIT(customer.id, customer.name, req.user?.username || 'api_user');

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
})
}

export function segMisc8(app, __ctx) {
app.post('/api/update-customer-analysis', async (req, res) => {
    if (__ctx.customerAnalysisStatus.isRunning) {
        return res.status(429).json({ error: '客户分析任务正在执行中，请稍后再试' });
    }
    logAudit(req, { module: 'CUSTOMER_ANALYSIS', action: 'UPDATE_DATA' });
    __ctx.customerAnalysisStatus.isRunning = true;
    __ctx.customerAnalysisStatus.status = 'running';
    __ctx.customerAnalysisStatus.message = '正在执行Python脚本...';

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
        __ctx.customerAnalysisStatus.isRunning = false;

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

                const destPath = path.join(__ctx.__dirname, '../public', 'customer_analysis.json');
                fs.writeFileSync(destPath, JSON.stringify(analysisData, null, 2));

                __ctx.customerAnalysisStatus.lastUpdate = new Date().toISOString();
                __ctx.customerAnalysisStatus.status = 'success';
                __ctx.customerAnalysisStatus.message = '客户分析数据更新成功';

                console.log('[客户分析] 数据已保存到 ' + destPath);
                res.json({
                    success: true,
                    message: '客户分析数据更新成功',
                    timestamp: __ctx.customerAnalysisStatus.lastUpdate,
                    overview: analysisData.analysis_overview
                });
            } catch (parseError) {
                console.error('[客户分析] JSON解析失败:', parseError.message);
                __ctx.customerAnalysisStatus.status = 'error';
                __ctx.customerAnalysisStatus.message = `JSON解析失败: ${parseError.message}`;
                res.status(500).json({ error: `JSON解析失败: ${parseError.message}` });
            }
        } else {
            console.error(`[客户分析] Python脚本执行失败，退出码: ${code}`);
            __ctx.customerAnalysisStatus.status = 'error';
            __ctx.customerAnalysisStatus.message = `Python脚本执行失败 (退出码: ${code})`;
            res.status(500).json({ error: `Python脚本执行失败: ${errorOutput || '未知错误'}` });
        }
    });

    python.on('error', (error) => {
        __ctx.customerAnalysisStatus.isRunning = false;
        __ctx.customerAnalysisStatus.status = 'error';
        __ctx.customerAnalysisStatus.message = `无法启动Python: ${error.message}`;
        console.error('[客户分析] Python启动错误:', error);
        res.status(500).json({ error: `无法启动Python: ${error.message}` });
    });
});

// API端点：获取客户分析数据（读取 JSON 文件）
app.get('/api/customer-analysis', (req, res) => {
    try {
        const dataPath = path.join(__ctx.__dirname, '../public', 'customer_analysis.json');
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
})
}

export function segMisc9(app, __ctx) {
app.post('/api/generate-image', __ctx.uploadMemory.array('images', 5), async (req, res) => {
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
})
}

export function segMisc10(app, __ctx) {
app.post('/api/smart-match', __ctx.upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: '请上传图片' });
        }
        logAudit(req, { module: 'BEAUTY_RND', action: 'SMART_MATCH', target_data: req.file.originalname });

        // 读取 Demo 数据库
        const dbPath = path.join(__ctx.__dirname, '../public', 'cosmetic_db.json');
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
// 海外营销（try 入口即拦截：避免未配置 key 时 500 先于试点分支）
        // ── D4 试点迁移（TASK_CENTER_PILOT 含 sea_marketing 时启用）──────────
        const sm = req.body || {};
        if (legacyBridge.isPilotSkill('sea_marketing')) {
            try {
                const r = await legacyBridge.runThroughTaskCenter({
                    skillKey: 'sea_marketing',
                    title: `出海营销文案：${String(sm.product_name || '').slice(0, 24)}`,
                    user: req.user?.id ? req.user : { id: 0, username: 'sea_anonymous', role: 'user' },
                    inputs: {
                        query: `Target Platform: ${sm.target_platform}`,
                        product_name: sm.product_name, product_info: sm.product_info, ingredient: sm.ingredient,
                        target_language: sm.target_language, target_platform: sm.target_platform, marketing_style: sm.marketing_style,
                    },
                });
                if (!r.ok) {
                    console.error(`[出海营销-任务中心] ${r.taskNo} 失败 ${r.errorCode}: ${r.message}`);
                    return res.status(500).json({ error: `任务执行失败（${r.taskNo}）：${r.message}` });
                }
                return res.json({ success: true, data: { answer: legacyBridge.stripThinkTags(legacyBridge.extractAnswer(r.outputs)) } });
            } catch (err) {
                logger.error('[sea-marketing-任务中心] 出错: ' + err.message);
                return res.status(500).json({ error: '营销内容生成失败：' + err.message });
            }
        }

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
})
}

export function segMisc11(app, __ctx) {
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
})
}
