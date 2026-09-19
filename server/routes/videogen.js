/**
 * server/routes/videogen.js — 视频生成路由（XO-01 拆解：自 server.js 原样迁出，首个示范模块）
 *
 * 抽取模式（后续 146 条路由按此模板逐组迁移）：
 *   export function register(app, { authenticateToken, logger }) { ...路由原样... }
 * 依赖显式注入，不引用 server.js 任何闭包变量。
 */
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import * as legacyBridge from '../modules/tasks/legacyBridge.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function register(app, { authenticateToken, logger }) {
    app.post('/api/videogen/generate', authenticateToken, async (req, res) => {
        const { query } = req.body;
        if (!query || !query.trim()) {
            return res.status(400).json({ success: false, message: '请提供视频生成需求描述' });
        }

        const apiKey = process.env.DIFY_VIDEOGEN_API_KEY;
        const apiUrl = process.env.DIFY_VIDEOGEN_API_URL;

        if ((!apiKey || apiKey === 'app-xxxxxxxxxxxxxxxxxxxxxxxx') && !legacyBridge.isPilotSkill('video_gen')) {
            return res.status(500).json({ success: false, message: '请先在 .env 中配置 DIFY_VIDEOGEN_API_KEY' });
        }

        const rpaScriptPath = path.join(__dirname, '../../RPA/bilibili_search_drission.py');
        const resultsJsonPath = path.join(__dirname, '../../RPA/bilibili_detailed_results.json');

        // ── 步骤 1：执行 bilibili_search_drission.py ──
        logger.info(`[VideoGen] 开始执行 RPA 脚本，关键词：${query}`);
        try {
            await new Promise((resolve, reject) => {
                const pythonProcess = spawn('python', [rpaScriptPath], {
                    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
                    cwd: path.join(__dirname, '../../RPA')
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
        // ── D4 试点迁移（TASK_CENTER_PILOT 含 video_gen 时启用）──────────
        // RPA 采集（步骤1-2）留在路由内（属输入采集）；仅 Dify 分镜生成走任务中心闭环。
        if (legacyBridge.isPilotSkill('video_gen')) {
            try {
                const r = await legacyBridge.runThroughTaskCenter({
                    skillKey: 'video_gen',
                    title: `视频分镜：${String(query).slice(0, 24)}`,
                    user: req.user,
                    inputs: { query: difyQuery },
                });
                if (!r.ok) {
                    logger.error(`[VideoGen-任务中心] ${r.taskNo} 失败 ${r.errorCode}: ${r.message}`);
                    return res.status(500).json({ success: false, message: `AI 分镜生成失败: 任务执行失败（${r.taskNo}）：${r.message}` });
                }
                rawAnswer = legacyBridge.stripThinkTags(legacyBridge.extractAnswer(r.outputs)) || '';
            } catch (e) {
                logger.error('[VideoGen-任务中心] 异常: ' + e.message);
                return res.status(500).json({ success: false, message: `AI 分镜生成失败: ${e.message}` });
            }
        } else {
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
}
