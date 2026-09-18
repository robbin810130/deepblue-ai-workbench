/**
 * hazardDetectionRoutes.js
 * 隐患检测模块 - 百度人体检测与属性识别 API 路由
 *
 * 调用链：
 * 1. 前端上传图片 (Base64) → POST /api/hazard-detection/detect
 * 2. 后端用 API Key + Secret Key 换取 Access Token（带内存缓存，30天有效）
 * 3. 携带 Token + Base64 图片 → 调用百度 body_attr 接口
 * 4. 解析返回结果，按 detectionType 过滤并返回给前端
 */

import express from 'express';

const router = express.Router();

// ─── Access Token 内存缓存 ────────────────────────────────────────────────────
let cachedToken = null;
let tokenExpireAt = 0;

/**
 * 获取百度 Access Token（自动缓存，过期前5分钟提前刷新）
 */
async function getBaiduAccessToken() {
    const now = Date.now();
    // 提前 5 分钟刷新，避免临界过期
    if (cachedToken && now < tokenExpireAt - 5 * 60 * 1000) {
        return cachedToken;
    }

    const apiKey = process.env.BAIDU_BODY_API_KEY;
    const secretKey = process.env.BAIDU_BODY_SECRET_KEY;
    const tokenUrl = process.env.BAIDU_BODY_TOKEN_URL || 'https://aip.baidubce.com/oauth/2.0/token';

    if (!apiKey || !secretKey) {
        throw new Error('未配置百度 API Key 或 Secret Key，请检查 .env 文件');
    }

    const url = `${tokenUrl}?grant_type=client_credentials&client_id=${apiKey}&client_secret=${secretKey}`;

    const response = await fetch(url, { method: 'POST' });
    if (!response.ok) {
        throw new Error(`百度 Token 接口请求失败: HTTP ${response.status}`);
    }

    const data = await response.json();

    if (data.error) {
        throw new Error(`百度 Token 获取失败: ${data.error_description || data.error}`);
    }

    cachedToken = data.access_token;
    // expires_in 单位为秒，百度默认 30 天（2592000s）
    tokenExpireAt = now + (data.expires_in || 2592000) * 1000;

    console.log(`[HazardDetection] Access Token 已刷新，有效期至: ${new Date(tokenExpireAt).toLocaleString()}`);
    return cachedToken;
}

// ─── 属性字段到检测类型的映射 ─────────────────────────────────────────────────
// 注：百度 headwear 返回值为 "安全帽" / "普通帽" / "无帽"
//     face_mask 返回值为 "戴口罩" / "无口罩"
//     cellphone 返回值为 "未使用手机" / "使用手机中"
const DETECTION_FIELDS = {
    helmet: {
        field: 'headwear',
        safe: ['安全帽'],
        warning: ['普通帽'], // 将普通帽作为“疑似违规/边缘情况”，放入警告状态
        danger: ['无帽'],
        safeLabel: '已佩戴安全帽',
        warningLabel: '疑似普通帽(需复核)',
        dangerLabel: '未佩戴安全帽',
    },
    mask: {
        field: 'face_mask',
        safe: ['戴口罩'],
        warning: [],
        danger: ['无口罩'],
        safeLabel: '已佩戴口罩',
        dangerLabel: '未佩戴口罩',
    },
    phone: {
        field: 'cellphone',
        safe: ['未使用手机'],
        warning: [],
        danger: ['使用手机中'],
        safeLabel: '未使用手机',
        dangerLabel: '正在使用手机',
    },
};

// ─── 主检测接口 ───────────────────────────────────────────────────────────────
/**
 * POST /api/hazard-detection/detect
 *
 * Request Body (JSON):
 * {
 *   image: string,        // Base64 编码的图片（不含 data:image/...;base64, 前缀）
 *   detectionType: string // "helmet" | "mask" | "phone"
 *   threshold?: number    // 置信度阈值，默认 0.5
 * }
 *
 * Response:
 * {
 *   success: boolean,
 *   person_num: number,
 *   results: Array<{
 *     id: number,
 *     location: { left, top, width, height },
 *     status: "safe" | "danger" | "unknown",
 *     label: string,
 *     confidence: number,
 *     attrs: object    // 原始全量属性
 *   }>,
 *   stats: { total, safe, danger }
 * }
 */
router.post('/detect', async (req, res) => {
    try {
        const { image, detectionType = 'helmet', threshold = 0.5 } = req.body;

        // 参数校验
        if (!image) {
            return res.status(400).json({ success: false, message: '缺少图片数据 (image)' });
        }
        if (!DETECTION_FIELDS[detectionType]) {
            return res.status(400).json({ success: false, message: `不支持的检测类型: ${detectionType}` });
        }

        const apiUrl = process.env.BAIDU_BODY_API_URL || 'https://aip.baidubce.com/rest/2.0/image-classify/v1/body_attr';

        // 1. 获取 Access Token
        const token = await getBaiduAccessToken();

        // 2. 准备请求体
        // 百度要求：Base64 图片需要 URLEncode，通过 x-www-form-urlencoded 发送
        const imageBase64 = image.replace(/^data:image\/\w+;base64,/, ''); // 去除前缀（如有）
        const body = new URLSearchParams({
            image: imageBase64,
            // 只请求我们需要的属性，减少响应体积
            type: `${DETECTION_FIELDS[detectionType].field},is_human,occlusion`,
        });

        // 3. 调用百度 API
        console.log(`[HazardDetection] 发起检测请求，类型: ${detectionType}, 阈值: ${threshold}`);
        const apiResponse = await fetch(`${apiUrl}?access_token=${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });

        if (!apiResponse.ok) {
            const errText = await apiResponse.text();
            throw new Error(`百度 API 请求失败: HTTP ${apiResponse.status} - ${errText}`);
        }

        const baiduData = await apiResponse.json();

        // 处理百度 API 错误码
        if (baiduData.error_code) {
            throw new Error(`百度 API 返回错误: [${baiduData.error_code}] ${baiduData.error_msg}`);
        }

        // 4. 解析并格式化结果
        const config = DETECTION_FIELDS[detectionType];
        const personNum = baiduData.person_num || 0;
        const personList = baiduData.person_info || [];

        const results = personList
            .filter(person => {
                // 人体框的置信度基础过滤（防止把树木等背景识别成人，设置一个较低的底线）
                return (person.location?.score || 0) >= 0.3;
            })
            .map((person, index) => {
                const attrs = person.attributes || {};
                const targetAttr = attrs[config.field];
                let attrName = targetAttr?.name || '未知';
                const attrScore = targetAttr?.score || 0;

                let status = 'unknown';
                
                if (attrScore >= threshold) {
                    if (config.safe?.some(s => attrName.includes(s))) {
                        status = 'safe';
                    } else if (config.warning?.some(w => attrName.includes(w))) {
                        status = 'warning';
                    } else if (config.danger?.some(d => attrName.includes(d))) {
                        status = 'danger';
                    }
                }

                console.log(`[HazardDetection Debug] 目标 ${index + 1}: ${config.field} = ${attrName} (置信度: ${attrScore}), 判定状态 = ${status}`);

                let label = '';
                if (status === 'safe') {
                    label = config.safeLabel;
                } else if (status === 'warning') {
                    label = config.warningLabel || attrName;
                } else if (status === 'danger') {
                    label = config.dangerLabel;
                } else {
                    label = `${attrName} (低于阈值)`;
                }

                return {
                    id: index + 1,
                    location: person.location,
                    status,
                    label,
                    confidence: Math.round(attrScore * 100) / 100,
                    attrs, // 保留全量属性供前端扩展展示
                };
            });

        // 5. 汇总统计
        const stats = {
            total: results.length,
            safe: results.filter(r => r.status === 'safe').length,
            danger: results.filter(r => r.status === 'danger').length,
        };

        console.log(`[HazardDetection] 检测完成: 共 ${personNum} 人, 过滤后 ${results.length} 人, 危险 ${stats.danger} 人`);

        res.json({
            success: true,
            person_num: personNum,
            results,
            stats,
            log_id: baiduData.log_id,
        });

    } catch (err) {
        console.error('[HazardDetection] 检测失败:', err.message);
        res.status(500).json({
            success: false,
            message: err.message || '检测服务异常，请稍后重试',
        });
    }
});

// ─── 综合 AI 隐患检测 (Dify 对接) ────────────────────────────────────────────────
/**
 * POST /api/hazard-detection/dify-detect
 *
 * 接收 Base64 图像，目前返回 MOCK 的 JSON 数据（测试用）。
 * 后续可无缝接入 Dify /chat-messages 接口。
 */
router.post('/dify-detect', async (req, res) => {
    try {
        const { images } = req.body;
        if (!images || !Array.isArray(images) || images.length === 0) {
            return res.status(400).json({ success: false, message: '缺少图片数据(images 数组)' });
        }

        const apiKey = process.env.DIFY_API_KEY_HAZARD;
        const apiUrl = process.env.DIFY_API_URL; // e.g. http://39.108.221.22/v1/chat-messages

        if (!apiKey || !apiUrl) {
            console.error('服务端未配置 Dify 综合隐患检测 API_KEY 或 API_URL');
            return res.status(500).json({ success: false, message: '系统未配置 AI 综合研判服务端点，请联系管理员。' });
        }

        const fileUploadUrl = apiUrl.replace(/\/chat-messages$/, '/files/upload');

        // 1 & 2. 并行将 Base64 转换为 Blob 并上传到 Dify
        const uploadPromises = images.map(async (imgBase64, index) => {
            const base64Data = imgBase64.replace(/^data:image\/\w+;base64,/, '');
            const imageBuffer = Buffer.from(base64Data, 'base64');
            const { Blob: NodeBlob } = await import('buffer');
            const blob = new NodeBlob([imageBuffer], { type: 'image/jpeg' });
            
            const formData = new FormData();
            formData.append('file', blob, `hazard_image_${index}.jpg`);
            formData.append('user', req.user?.username || 'hazard_user');

            const uploadRes = await fetch(fileUploadUrl, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${apiKey}` },
                body: formData
            });

            if (!uploadRes.ok) {
                const errText = await uploadRes.text();
                throw new Error(`Dify 文件上传失败 (${uploadRes.status}): ${errText}`);
            }

            const uploadData = await uploadRes.json();
            return uploadData.id;
        });

        const fileIds = await Promise.all(uploadPromises);

        // 3. 构建 files 参数，调用 Chatflow 进行隐患分析
        const filesPayload = fileIds.map(id => ({
            type: "image",
            transfer_method: "local_file",
            upload_file_id: id
        }));

        const chatRes = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: {},
                query: "请对这些图片进行全面的综合隐患检测，并严格按照约定好的JSON格式返回分析报告。不要返回除了JSON以外的任何内容。",
                response_mode: "blocking",
                user: req.user?.username || 'hazard_user',
                files: filesPayload
            })
        });

        if (!chatRes.ok) {
            const errText = await chatRes.text();
            throw new Error(`Dify Chatflow 调用失败 (${chatRes.status}): ${errText}`);
        }

        const chatData = await chatRes.json();
        let answerText = chatData.answer || '';

        // 4. 解析 Dify 的迭代输出结果（可能包含多个 JSON 块）
        let jsonBlocks = [];
        try {
            // 尝试直接解析（万一模型直接返回了一个标准 JSON 数组）
            let cleanStr = answerText.replace(/```(?:json)?\s*([\s\S]*?)\s*```/g, '$1').trim();
            let parsed = JSON.parse(cleanStr);
            if (Array.isArray(parsed)) {
                jsonBlocks = parsed;
            } else {
                jsonBlocks = [parsed];
            }
        } catch(e) {
            // 解析失败说明大模型输出了带有 `- ` 或 Markdown 分隔的多个独立 JSON 对象
            const blocks = answerText.split(/(?:^-|\n-)\s*/).filter(b => b.trim());
            for (let block of blocks) {
                let jsonStr = block.trim();
                // 剔除可能的 ```json 包装
                const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
                if (jsonMatch) {
                    jsonStr = jsonMatch[1];
                }
                try {
                    const firstBrace = jsonStr.indexOf('{');
                    const lastBrace = jsonStr.lastIndexOf('}');
                    if (firstBrace !== -1 && lastBrace !== -1) {
                        jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
                        const parsed = JSON.parse(jsonStr);
                        jsonBlocks.push(parsed);
                    }
                } catch(e2) {
                    console.error("单个 JSON 块解析失败:", jsonStr);
                }
            }
        }

        if (jsonBlocks.length === 0) {
            console.error('JSON 提取完全失败，原始文本:', answerText);
            throw new Error('AI 返回的数据格式无法解析为 JSON');
        }

        // 补齐缺失的结果以匹配上传图片的数量，防止前端越界报错
        const finalResults = images.map((_, idx) => {
            return jsonBlocks[idx] || { 
                total_hazards_detected: 0, 
                overall_risk_level: 'Unknown', 
                environment_context: '未成功获取到该图片的分析报告',
                findings: [] 
            };
        });

        res.json({
            success: true,
            data: finalResults
        });

    } catch (err) {
        console.error('[HazardDetection] Dify 检测失败:', err.message);
        res.status(500).json({
            success: false,
            message: `AI 诊断异常: ${err.message}`,
        });
    }
});

export default router;
