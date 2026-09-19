/**
 * marketingAnalysis 域路由（XO-01 server.js 拆解 · codemod 迁出）
 * 依赖经 __ctx 注入（getter 惰性取值）；segment 保持原注册位置，express 顺序零变化。
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { logger } from '../infra/logger.js';
import { authenticateToken } from '../infra/auth.js';
import { logAudit } from '../infra/audit.js';
import * as legacyBridge from '../modules/tasks/legacyBridge.js';

export function segMarketingAnalysis1(app, __ctx) {
app.get('/api/marketing-analysis/status', authenticateToken, (req, res) => {
    res.json(__ctx.marketingAnalysisStatus);
});

app.post('/api/marketing-analysis/update-data', authenticateToken, async (req, res) => {
    if (__ctx.marketingAnalysisStatus.isRunning) {
        return res.status(429).json({ error: '营销数据分析任务正在执行中，请稍后再试' });
    }
    logAudit(req, { module: 'MARKETING_ANALYSIS', action: 'UPDATE_DATA' });
    __ctx.marketingAnalysisStatus.isRunning = true;
    __ctx.marketingAnalysisStatus.status = 'running';
    __ctx.marketingAnalysisStatus.message = '正在执行SQL数据提取与分析脚本...';

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
        __ctx.marketingAnalysisStatus.isRunning = false;

        if (code === 0) {
            try {
                // 执行成功后，把 marketing_analysis_data.json 复制到 public 目录
                const srcPath = path.join(__ctx.__dirname, '../marketing_analysis_data.json');
                const destPath = path.join(__ctx.__dirname, '../public', 'marketing_analysis_data.json');
                
                if (fs.existsSync(srcPath)) {
                    fs.copyFileSync(srcPath, destPath);
                    console.log(`[营销分析] 数据文件已同步复制到 ${destPath}`);
                } else {
                    console.warn(`[营销分析] 未在根目录找到生成的 marketing_analysis_data.json`);
                }

                __ctx.marketingAnalysisStatus.lastUpdate = new Date().toISOString();
                __ctx.marketingAnalysisStatus.status = 'success';
                __ctx.marketingAnalysisStatus.message = '营销数据更新并分析成功';

                res.json({
                    success: true,
                    message: '营销数据更新与分析计算完成！',
                    timestamp: __ctx.marketingAnalysisStatus.lastUpdate
                });
            } catch (err) {
                console.error('[营销分析] 同步复制或处理文件失败:', err.message);
                __ctx.marketingAnalysisStatus.status = 'error';
                __ctx.marketingAnalysisStatus.message = `同步文件失败: ${err.message}`;
                res.status(500).json({ error: `处理同步文件异常: ${err.message}` });
            }
        } else {
            console.error(`[营销分析] Python脚本执行失败，退出码: ${code}`);
            __ctx.marketingAnalysisStatus.status = 'error';
            __ctx.marketingAnalysisStatus.message = `数据分析脚本执行失败 (退出码: ${code})`;
            res.status(500).json({ error: `数据分析脚本执行失败: ${errorOutput || '未知错误'}` });
        }
    });

    python.on('error', (error) => {
        __ctx.marketingAnalysisStatus.isRunning = false;
        __ctx.marketingAnalysisStatus.status = 'error';
        __ctx.marketingAnalysisStatus.message = `无法启动分析环境: ${error.message}`;
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
})
}
