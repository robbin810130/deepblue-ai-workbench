// ============================================================
// server/bidAssistantRoutes.js — 投标助手模块路由
// 功能：标书解析、草稿自动保存、固定内容模板、Dify章节生成、标书导出
// ============================================================
import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import pool from './db.js';
import { parseBidFile, buildChapterTree } from './utils/docParseUtils.js';
import { buildDocx } from './utils/docxBuilder.js';
import PizZip from 'pizzip';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// ─── 文件上传配置 ─────────────────────────────────────────────
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'tmp', 'uploads')),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `bid_${Date.now()}_${Math.floor(Math.random() * 1000)}${ext}`);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext === '.docx') {
            cb(null, true);
        } else {
            cb(new Error('仅支持 .docx 格式的标书文件'));
        }
    }
});

function validateId(id) {
    const num = Number(id);
    return Number.isInteger(num) && num > 0 ? num : null;
}

// ─── 智能内容替换（基于原始 XML 字符串操作，100% 保留格式） ─────────

/** 去除标题末尾的页码数字，统一空白字符 */
function normalizeTitle(title) {
    return (title || '').replace(/\s+/g, ' ').replace(/\s+\d{1,3}$/, '').trim();
}

/** 检查两个标题是否匹配（模糊匹配） */
function titleMatches(a, b) {
    const na = normalizeTitle(a);
    const nb = normalizeTitle(b);
    if (na === nb) return true;
    if (na.replace(/\s/g, '') === nb.replace(/\s/g, '')) return true;
    if (na.length > 2 && nb.length > 2) {
        if (na.includes(nb) || nb.includes(na)) return true;
    }
    return false;
}

// ─── 查找替换（在原始 .docx XML 中精确替换文本） ────────

/** 转义正则特殊字符 */
function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** XML 文本转义 */
function xmlEscape(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 仅查找：返回匹配数量及上下文摘要
 * 不修改 XML
 */
function findInXml(xml, findText) {
    if (!findText) return { count: 0, matches: [] };
    const escapedFind = xmlEscape(findText);
    let count = 0;
    const matches = [];
    const pRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
    let pMatch;
    while ((pMatch = pRe.exec(xml)) !== null) {
        const pXml = pMatch[0];
        // 提取段落内所有 <w:t> 文本
        const texts = [];
        const tRe = /<w:t[^>]*>([^<]*)<\/w:t>/g;
        let tMatch;
        while ((tMatch = tRe.exec(pXml)) !== null) {
            texts.push(tMatch[1]);
        }
        const combined = texts.join('');
        if (!combined) continue;
        let idx = 0;
        while (true) {
            const pos = combined.indexOf(escapedFind, idx);
            if (pos < 0) break;
            count++;
            const ctxStart = Math.max(0, pos - 15);
            const ctxEnd = Math.min(combined.length, pos + escapedFind.length + 15);
            let context = combined.substring(ctxStart, ctxEnd);
            // XML 反转义用于显示
            context = context.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
            matches.push({ index: count, context });
            idx = pos + escapedFind.length;
        }
    }
    return { count, matches };
}

/**
 * 在 document.xml 中查找并替换文本
 * 处理单个 <w:t> 内匹配和跨 <w:r> 匹配两种情况
 * replaceIndex: -1 表示全部替换，0-based 表示替换第 N 个
 */
function findAndReplaceInXml(xml, findText, replaceText, replaceIndex = -1) {
    if (!findText) return { newXml: xml, count: 0 };

    const escapedFind = xmlEscape(findText);
    const escapedReplace = xmlEscape(replaceText);

    let result = xml;
    let globalMatchCount = 0;  // 全局匹配计数
    let replacedCount = 0;     // 实际替换计数

    // 第一遍：单个 <w:t> 内的完整匹配
    const singleRe = new RegExp(`(<w:t[^>]*>)([^<]*?)${escapeRegExp(escapedFind)}([^<]*?)(<\\/w:t>)`, 'g');
    result = result.replace(singleRe, (match, openTag, before, after, closeTag) => {
        const myIndex = globalMatchCount++;
        if (replaceIndex === -1 || myIndex === replaceIndex) {
            replacedCount++;
            return `${openTag}${before}${escapedReplace}${after}${closeTag}`;
        }
        return match; // 不替换此匹配
    });

    // 第二遍：跨 <w:r> 的文本匹配（文本被拆分到多个 run）
    const pRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
    let pMatch;
    const crossRunReplacements = [];

    while ((pMatch = pRe.exec(result)) !== null) {
        const pXml = pMatch[0];
        const texts = [];
        const tRe = /<w:t[^>]*>([^<]*)<\/w:t>/g;
        let tMatch;
        while ((tMatch = tRe.exec(pXml)) !== null) {
            texts.push(tMatch[1]);
        }
        const combined = texts.join('');
        // 查找所有匹配（可能有多个）
        let searchFrom = 0;
        while (true) {
            const idx = combined.indexOf(escapedFind, searchFrom);
            if (idx < 0) break;
            const myIndex = globalMatchCount++;
            if (replaceIndex === -1 || myIndex === replaceIndex) {
                crossRunReplacements.push({
                    start: pMatch.index,
                    end: pMatch.index + pMatch[0].length,
                    oldXml: pMatch[0],
                    findStart: idx,
                    findLen: escapedFind.length
                });
            }
            searchFrom = idx + escapedFind.length;
        }
    }

    // 从后往前应用跨 run 替换
    for (let i = crossRunReplacements.length - 1; i >= 0; i--) {
        const r = crossRunReplacements[i];
        const newPXml = replaceInParagraphRuns(r.oldXml, r.findStart, r.findLen, escapedReplace);
        result = result.substring(0, r.start) + newPXml + result.substring(r.end);
        replacedCount++;
    }

    return { newXml: result, count: replacedCount, totalFound: globalMatchCount };
}

/**
 * 在段落的多个 <w:r> 中替换跨 run 的文本
 * 策略：将所有文本放入第一个 <w:r>，清空其余 <w:r> 的文本
 */
function replaceInParagraphRuns(pXml, findStart, findLen, replaceText) {
    const tRe = /<w:t[^>]*>([^<]*)<\/w:t>/g;
    const runs = [];
    let m;
    while ((m = tRe.exec(pXml)) !== null) {
        runs.push({ text: m[1], fullMatch: m[0], index: m.index });
    }
    if (runs.length === 0) return pXml;

    const combined = runs.map(r => r.text).join('');
    const newCombined = combined.substring(0, findStart) + replaceText + combined.substring(findStart + findLen);

    let result = pXml;
    // 从后往前替换，避免偏移
    for (let i = runs.length - 1; i >= 0; i--) {
        const newText = i === 0 ? newCombined : '';
        const newT = `<w:t xml:space="preserve">${newText}</w:t>`;
        result = result.substring(0, runs[i].index) + newT + result.substring(runs[i].index + runs[i].fullMatch.length);
    }
    return result;
}

// ============================================================
// ■ 标书文件解析
// ============================================================

// POST /parse — 上传标书文件并解析为章节列表，同时创建草稿
router.post('/parse', upload.single('file'), async (req, res) => {
    let tmpPath = null;
    try {
        if (!req.file) {
            return res.status(400).json({ code: 400, message: '未收到文件，请上传标书文件' });
        }
        tmpPath = req.file.path;
        const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
        console.log(`[投标助手] 解析文件: ${originalName} (${req.file.size} bytes), 用户: ${req.user?.username}`);

        const { chapters } = await parseBidFile(tmpPath, originalName);

        // 为每个章节保存原始内容，用于导出时比较是否编辑过
        chapters.forEach(ch => {
            ch.originalContentHtml = ch.contentHtml || '';
            ch.edited = false;
        });
        console.log(`[投标助手] 解析完成: ${chapters.length} 章节`);

        // 读取源文件为二进制，存入数据库
        const sourceData = fs.readFileSync(tmpPath);

        // 创建草稿（源文件存入 source_data BYTEA 列）
        const userId = req.user?.username || 'unknown';
        const projectName = originalName.replace(/\.(doc|docx)$/i, '');
        const result = await pool.query(
            `INSERT INTO bid_assistant_drafts (user_id, project_name, file_name, chapters, source_data)
             VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
            [userId, projectName, originalName, JSON.stringify(chapters), sourceData]
        );

        // 清理临时文件
        try { fs.unlinkSync(tmpPath); } catch (_) { /* ignore */ }

        res.json({
            code: 0,
            data: {
                draftId: result.rows[0].id,
                projectName,
                fileName: originalName,
                chapters: buildChapterTree(chapters)
            }
        });
    } catch (error) {
        console.error('[投标助手] 解析失败:', error.message);
        if (tmpPath) { try { fs.unlinkSync(tmpPath); } catch (_) { /* ignore */ } }
        res.status(500).json({ code: 500, message: error.message || '文件解析失败' });
    }
});

// ============================================================
// ■ 草稿管理（自动保存与恢复）
// ============================================================

// GET /drafts — 获取当前用户的草稿列表
router.get('/drafts', async (req, res) => {
    try {
        const userId = req.user?.username || 'unknown';
        const result = await pool.query(
            `SELECT id, project_name, file_name, status, created_at, updated_at,
                    jsonb_array_length(chapters) AS chapter_count
             FROM bid_assistant_drafts
             WHERE user_id = $1
             ORDER BY updated_at DESC`,
            [userId]
        );
        res.json({ code: 0, data: result.rows });
    } catch (error) {
        console.error('[投标助手] 查询草稿列表失败:', error.message);
        res.status(500).json({ code: 500, message: '查询草稿列表失败' });
    }
});

// GET /drafts/:id — 获取草稿详情（不含 source_data 大字段）
router.get('/drafts/:id', async (req, res) => {
    try {
        const id = validateId(req.params.id);
        if (!id) return res.status(400).json({ code: 400, message: '无效的草稿ID' });
        const userId = req.user?.username || 'unknown';
        const result = await pool.query(
            'SELECT id, user_id, project_name, file_name, chapters, status, created_at, updated_at FROM bid_assistant_drafts WHERE id = $1 AND user_id = $2',
            [id, userId]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ code: 404, message: '草稿不存在' });
        }
        res.json({ code: 0, data: result.rows[0] });
    } catch (error) {
        console.error('[投标助手] 查询草稿失败:', error.message);
        res.status(500).json({ code: 500, message: '查询草稿失败' });
    }
});

// PUT /drafts/:id — 保存草稿（编辑内容自动保存）
router.put('/drafts/:id', async (req, res) => {
    try {
        const id = validateId(req.params.id);
        if (!id) return res.status(400).json({ code: 400, message: '无效的草稿ID' });
        const userId = req.user?.username || 'unknown';
        const { chapters, project_name, status } = req.body;

        if (!Array.isArray(chapters)) {
            return res.status(400).json({ code: 400, message: 'chapters 必须为数组' });
        }

        const result = await pool.query(
            `UPDATE bid_assistant_drafts
             SET chapters = $1,
                 project_name = COALESCE($2, project_name),
                 status = COALESCE($3, status),
                 updated_at = NOW()
             WHERE id = $4 AND user_id = $5
             RETURNING id, updated_at`,
            [JSON.stringify(chapters), project_name ?? null, status ?? null, id, userId]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ code: 404, message: '草稿不存在' });
        }
        res.json({ code: 0, data: result.rows[0] });
    } catch (error) {
        console.error('[投标助手] 保存草稿失败:', error.message);
        res.status(500).json({ code: 500, message: '保存草稿失败' });
    }
});

// DELETE /drafts/:id — 删除草稿
router.delete('/drafts/:id', async (req, res) => {
    try {
        const id = validateId(req.params.id);
        if (!id) return res.status(400).json({ code: 400, message: '无效的草稿ID' });
        const userId = req.user?.username || 'unknown';

        const result = await pool.query(
            'DELETE FROM bid_assistant_drafts WHERE id = $1 AND user_id = $2',
            [id, userId]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ code: 404, message: '草稿不存在' });
        }

        res.json({ code: 0, message: '删除成功' });
    } catch (error) {
        console.error('[投标助手] 删除草稿失败:', error.message);
        res.status(500).json({ code: 500, message: '删除草稿失败' });
    }
});

// ============================================================
// ■ 固定内容模板 CRUD
// ============================================================

// GET /templates — 模板列表
router.get('/templates', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, name, content, sections, created_by, created_at, updated_at
             FROM bid_assistant_templates ORDER BY updated_at DESC`
        );
        res.json({ code: 0, data: result.rows });
    } catch (error) {
        console.error('[投标助手] 查询模板列表失败:', error.message);
        res.status(500).json({ code: 500, message: '查询模板列表失败' });
    }
});

// POST /templates — 新增模板
router.post('/templates', async (req, res) => {
    try {
        const { name, content, sections } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ code: 400, message: '模板名称不能为空' });
        }
        const createdBy = req.user?.username || 'unknown';
        const result = await pool.query(
            `INSERT INTO bid_assistant_templates (name, content, sections, created_by)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [name.trim(), content || '', JSON.stringify(sections || []), createdBy]
        );
        res.json({ code: 0, data: result.rows[0] });
    } catch (error) {
        console.error('[投标助手] 新增模板失败:', error.message);
        res.status(500).json({ code: 500, message: '新增模板失败' });
    }
});

// PUT /templates/:id — 更新模板
router.put('/templates/:id', async (req, res) => {
    try {
        const id = validateId(req.params.id);
        if (!id) return res.status(400).json({ code: 400, message: '无效的模板ID' });
        const { name, content, sections } = req.body;
        const result = await pool.query(
            `UPDATE bid_assistant_templates
             SET name = COALESCE($1, name),
                 content = COALESCE($2, content),
                 sections = COALESCE($3, sections),
                 updated_at = NOW()
             WHERE id = $4 RETURNING *`,
            [name ?? null, content ?? null, sections ? JSON.stringify(sections) : null, id]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ code: 404, message: '模板不存在' });
        }
        res.json({ code: 0, data: result.rows[0] });
    } catch (error) {
        console.error('[投标助手] 更新模板失败:', error.message);
        res.status(500).json({ code: 500, message: '更新模板失败' });
    }
});

// DELETE /templates/:id — 删除模板
router.delete('/templates/:id', async (req, res) => {
    try {
        const id = validateId(req.params.id);
        if (!id) return res.status(400).json({ code: 400, message: '无效的模板ID' });

        const result = await pool.query('DELETE FROM bid_assistant_templates WHERE id = $1', [id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ code: 404, message: '模板不存在' });
        }

        res.json({ code: 0, message: '删除成功' });
    } catch (error) {
        console.error('[投标助手] 删除模板失败:', error.message);
        res.status(500).json({ code: 500, message: '删除模板失败' });
    }
});

// ============================================================
// ■ 模板批量应用（按章节名匹配，自动追加内容到 Word 文档）
// ============================================================

/** 简易 HTML 转纯文本 */
function htmlToText(html) {
    return (html || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim();
}

/**
 * 将模板段落应用到 Word 文档 XML 中
 * 对每个 section，找到匹配的章节标题，在其后插入内容段落
 * @param {string} xml - document.xml 内容
 * @param {Array} sections - [{name, content}, ...]
 * @param {Array} draftChapters - 草稿中的章节列表（用于匹配标题）
 * @returns {{ newXml, applied: [{sectionName, chapterTitle}] }}
 */
function applyTemplateToDocx(xml, sections, draftChapters, selectedPositions = null) {
    const applied = [];
    let result = xml;
    // 收集所有需要插入的操作，按位置倒序插入以避免偏移
    const insertions = [];

    for (const section of sections) {
        if (!section.name || !section.content) continue;

        let sectionName = section.name.trim();
        const occurrenceMatch = sectionName.match(/\s*\((\d+)\)\s*$/);
        if (occurrenceMatch) {
            sectionName = sectionName.replace(/\s*\(\d+\)\s*$/, '').trim();
        }
        const searchText = extractCoreTitle(sectionName) || sectionName;
        console.log(`[投标助手] 模板段落: "${section.name}", 搜索正文: "${searchText}"`);

        // 搜索文档正文中所有包含该文本的段落
        const matchedParagraphs = [];
        const pRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
        let pMatch;
        while ((pMatch = pRe.exec(xml)) !== null) {
            const pXml = pMatch[0];
            const texts = [];
            const tRe = /<w:t[^>]*>([^<]*)<\/w:t>/g;
            let tMatch;
            while ((tMatch = tRe.exec(pXml)) !== null) {
                texts.push(tMatch[1]);
            }
            const paraText = texts.join('').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
            if (paraText.includes(searchText)) {
                const parentChapter = findParentChapterForPosition(pMatch.index, xml, draftChapters);
                matchedParagraphs.push({
                    position: pMatch.index,
                    endPosition: pMatch.index + pXml.length,
                    text: paraText.substring(0, 50),
                    parentChapter: parentChapter ? parentChapter.title : '未分类'
                });
            }
        }
        console.log(`[投标助手] 正文匹配到 ${matchedParagraphs.length} 个段落`);

        if (matchedParagraphs.length === 0) continue;

        // 确定要插入的位置
        let targetParagraphs = [];
        if (selectedPositions && selectedPositions.length > 0) {
            // 用户指定了位置
            targetParagraphs = matchedParagraphs.filter(p => selectedPositions.includes(p.position));
        } else {
            // 默认只插入第一个匹配
            targetParagraphs = [matchedParagraphs[0]];
        }

        // 将内容转换为 Word XML 段落
        const contentLines = section.content.split('\n').filter(l => l.trim());
        const newParagraphs = contentLines.map(line => {
            const escapedLine = xmlEscape(line.trim());
            return `<w:p><w:r><w:t xml:space="preserve">${escapedLine}</w:t></w:r></w:p>`;
        }).join('');

        for (const para of targetParagraphs) {
            insertions.push({
                position: para.endPosition,
                content: newParagraphs,
                sectionName: section.name,
                parentChapter: para.parentChapter,
                paraText: para.text
            });
        }
    }

    // 按位置倒序插入，避免偏移问题
    insertions.sort((a, b) => b.position - a.position);
    for (const ins of insertions) {
        result = result.substring(0, ins.position) + ins.content + result.substring(ins.position);
        applied.push({ sectionName: ins.sectionName, chapterTitle: ins.parentChapter });
        console.log(`[投标助手] 模板应用: "${ins.sectionName}" → "${ins.parentChapter}" 下方 (位置=${ins.position})`);
    }

    return { newXml: result, applied };
}

/** 去除标题前的编号前缀，提取核心标题（如 "（8）财务会计制度" → "财务会计制度"） */
function extractCoreTitle(title) {
    return (title || '')
        .replace(/^[\s\d\.\、\（\）\(\)【】\[\]]+/, '') // 去除开头的数字、编号符号
        .replace(/^[一二三四五六七八九十百千]+[、\.\s]*/, '') // 去除中文数字编号
        .replace(/^第[一二三四五六七八九十百千\d]+[章节部分篇][、\.\s]*/, '') // 去除"第X章"等
        .trim();
}

// POST /apply-template-preview — 预览模板匹配结果（搜索文档正文中所有匹配段落）
router.post('/apply-template-preview', async (req, res) => {
    try {
        const draftId = validateId(req.body.draftId);
        const templateId = validateId(req.body.templateId);
        if (!draftId || !templateId) {
            return res.status(400).json({ code: 400, message: '缺少草稿ID或模板ID' });
        }
        const userId = req.user?.username || 'unknown';

        // 读取模板
        const tplResult = await pool.query(
            'SELECT * FROM bid_assistant_templates WHERE id = $1',
            [templateId]
        );
        if (tplResult.rowCount === 0) {
            return res.status(404).json({ code: 404, message: '模板不存在' });
        }
        const template = tplResult.rows[0];
        let sections = template.sections || [];
        if (sections.length === 0) {
            return res.status(400).json({ code: 400, message: '模板内容为空' });
        }

        // 读取草稿
        const draftResult = await pool.query(
            'SELECT source_data, chapters FROM bid_assistant_drafts WHERE id = $1 AND user_id = $2',
            [draftId, userId]
        );
        if (draftResult.rowCount === 0) {
            return res.status(404).json({ code: 404, message: '草稿不存在' });
        }
        const draft = draftResult.rows[0];
        const draftChapters = Array.isArray(draft.chapters) ? draft.chapters : [];
        const sourceData = draft.source_data;
        if (!sourceData || sourceData.length === 0) {
            return res.status(400).json({ code: 400, message: '源文件数据为空' });
        }

        // 读取文档 XML
        const zip = new PizZip(Buffer.from(sourceData));
        const xml = zip.file('word/document.xml').asText();

        // 为每个 section 搜索文档正文中所有包含该文本的段落
        const matches = [];
        for (const section of sections) {
            if (!section.name || !section.content) continue;
            let sectionName = section.name.trim();
            const occurrenceMatch = sectionName.match(/\s*\((\d+)\)\s*$/);
            if (occurrenceMatch) {
                sectionName = sectionName.replace(/\s*\(\d+\)\s*$/, '').trim();
            }
            const searchText = extractCoreTitle(sectionName) || sectionName;
            console.log(`[投标助手预览] 段落 "${section.name}" → 搜索正文: "${searchText}"`);

            // 搜索所有包含该文本的段落
            const matchedParagraphs = [];
            const pRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
            let pMatch;
            let paraIndex = 0;
            while ((pMatch = pRe.exec(xml)) !== null) {
                const pXml = pMatch[0];
                // 提取段落文本
                const texts = [];
                const tRe = /<w:t[^>]*>([^<]*)<\/w:t>/g;
                let tMatch;
                while ((tMatch = tRe.exec(pXml)) !== null) {
                    texts.push(tMatch[1]);
                }
                const paraText = texts.join('').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
                if (paraText.includes(searchText)) {
                    // 找到该段落所属的章节
                    const parentChapter = findParentChapterForPosition(pMatch.index, xml, draftChapters);
                    matchedParagraphs.push({
                        index: paraIndex,
                        position: pMatch.index,
                        text: paraText.substring(0, 100), // 截取前100字符作为预览
                        parentChapter: parentChapter ? parentChapter.title : '未分类',
                        parentChapterId: parentChapter ? parentChapter.id : null
                    });
                }
                paraIndex++;
            }
            console.log(`[投标助手预览] 段落 "${section.name}" → 正文匹配到 ${matchedParagraphs.length} 个段落`);
            matches.push({
                sectionName: section.name,
                cleanName: sectionName,
                searchText: searchText,
                matchedParagraphs
            });
        }

        res.json({ code: 0, data: { matches } });
    } catch (error) {
        console.error('[投标助手] 模板预览失败:', error.message);
        res.status(500).json({ code: 500, message: error.message || '模板预览失败' });
    }
});

// 根据段落在 XML 中的位置，找到它所属的章节
function findParentChapterForPosition(position, xml, chapters) {
    // 找到该位置之前最近的章节标题段落
    let lastChapter = null;
    const pRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
    let pMatch;
    while ((pMatch = pRe.exec(xml)) !== null) {
        if (pMatch.index >= position) break;
        const pXml = pMatch[0];
        const texts = [];
        const tRe = /<w:t[^>]*>([^<]*)<\/w:t>/g;
        let tMatch;
        while ((tMatch = tRe.exec(pXml)) !== null) {
            texts.push(tMatch[1]);
        }
        const paraText = texts.join('').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        // 检查是否是某个章节标题
        for (const ch of chapters) {
            if (titleMatches(paraText, ch.title)) {
                lastChapter = ch;
                break;
            }
        }
    }
    return lastChapter;
}

// 构建章节的上下文路径（如 "第三章 > 3.2 技术方案 > （8）财务会计制度"）
function getChapterPath(chapter, allChapters) {
    const parts = [];
    // 找到当前章节前面的父级章节（level更小的）
    const sortedChapters = [...allChapters].sort((a, b) => (a.order || 0) - (b.order || 0));
    const currentIdx = sortedChapters.findIndex(c => c.id === chapter.id);
    if (currentIdx < 0) return chapter.title;
    
    // 向前查找父级章节
    const parentStack = [];
    for (let i = currentIdx - 1; i >= 0; i--) {
        const ch = sortedChapters[i];
        if (ch.level < chapter.level && !parentStack.some(p => p.level <= ch.level)) {
            parentStack.unshift(ch);
            if (ch.level === 1) break;
        }
    }
    
    for (const p of parentStack) {
        parts.push(p.title);
    }
    parts.push(chapter.title);
    return parts.join(' > ');
}

// POST /apply-template — 将模板内容批量追加到草稿的匹配章节中
router.post('/apply-template', async (req, res) => {
    try {
        const draftId = validateId(req.body.draftId);
        const templateId = validateId(req.body.templateId);
        if (!draftId || !templateId) {
            return res.status(400).json({ code: 400, message: '缺少草稿ID或模板ID' });
        }
        const userId = req.user?.username || 'unknown';

        // 读取模板
        const tplResult = await pool.query(
            'SELECT * FROM bid_assistant_templates WHERE id = $1',
            [templateId]
        );
        if (tplResult.rowCount === 0) {
            return res.status(404).json({ code: 404, message: '模板不存在' });
        }
        const template = tplResult.rows[0];
        let sections = template.sections || [];
        if (sections.length === 0) {
            return res.status(400).json({ code: 400, message: '模板内容为空' });
        }

        // 读取草稿
        const draftResult = await pool.query(
            'SELECT source_data, chapters FROM bid_assistant_drafts WHERE id = $1 AND user_id = $2',
            [draftId, userId]
        );
        if (draftResult.rowCount === 0) {
            return res.status(404).json({ code: 404, message: '草稿不存在' });
        }
        const draft = draftResult.rows[0];
        const sourceData = draft.source_data;
        if (!sourceData || sourceData.length === 0) {
            return res.status(400).json({ code: 400, message: '源文件数据为空' });
        }

        const draftChapters = Array.isArray(draft.chapters) ? draft.chapters : [];
        const zip = new PizZip(Buffer.from(sourceData));
        const xml = zip.file('word/document.xml').asText();

        // 获取用户选择的位置（可选）
        const selectedPositions = req.body.selectedPositions || null;
        console.log(`[投标助手] 应用模板, selectedPositions=${JSON.stringify(selectedPositions)}`);

        // 应用模板
        const { newXml, applied } = applyTemplateToDocx(xml, sections, draftChapters, selectedPositions);

        console.log(`[投标助手] 模板应用调试: 原始XML长=${xml.length}, 新XML长=${newXml.length}, 应用数量=${applied.length}`);
        if (applied.length > 0) {
            console.log(`[投标助手] 模板应用详情:`, JSON.stringify(applied));
            // 检查新插入的内容是否存在
            const testContent = sections[0]?.content?.split('\n')[0]?.trim().substring(0, 30) || '';
            const hasNewContent = newXml.includes(testContent);
            console.log(`[投标助手] 新内容验证: ${hasNewContent ? '成功' : '失败'}, 测试内容="${testContent}"`);
        }

        if (applied.length === 0) {
            return res.json({ code: 0, data: { applied: [], message: '未找到匹配的章节' } });
        }

        // 更新文档
        zip.file('word/document.xml', newXml);
        const newBuffer = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
        console.log(`[投标助手] 生成新文档: buffer大小=${newBuffer.length}字节, draftId=${draftId}, userId=${userId}`);
        
        // 同时更新 chapters JSONB，将模板内容追加到匹配章节的 contentHtml
        const updatedChapters = [...draftChapters];
        for (const app of applied) {
            const chapterIdx = updatedChapters.findIndex(ch => ch.title === app.chapterTitle);
            if (chapterIdx >= 0) {
                const section = sections.find(s => s.name === app.sectionName);
                if (section && section.content) {
                    // 将模板内容转换为 HTML 段落
                    const htmlContent = section.content.split('\n')
                        .filter(l => l.trim())
                        .map(l => `<p>${l.trim()}</p>`)
                        .join('');
                    // 追加到现有内容
                    updatedChapters[chapterIdx] = {
                        ...updatedChapters[chapterIdx],
                        contentHtml: (updatedChapters[chapterIdx].contentHtml || '') + htmlContent,
                        edited: true
                    };
                    console.log(`[投标助手] 更新章节 ${app.chapterTitle} 的 contentHtml`);
                }
            }
        }
        
        const updateResult = await pool.query(
            'UPDATE bid_assistant_drafts SET source_data = $1, chapters = $2, updated_at = NOW() WHERE id = $3 AND user_id = $4',
            [newBuffer, JSON.stringify(updatedChapters), draftId, userId]
        );
        console.log(`[投标助手] 数据库更新结果: rowCount=${updateResult.rowCount}`);
        
        if (updateResult.rowCount === 0) {
            console.error(`[投标助手] 警告: 未更新任何记录! draftId=${draftId}, userId=${userId}`);
            return res.status(404).json({ code: 404, message: '草稿不存在或无权修改' });
        }
        
        console.log(`[投标助手] 数据库更新成功（source_data + chapters）`);

        const msg = `已将 ${applied.length} 个模板段落追加到对应章节`;
        console.log(`[投标助手] 模板应用完成: ${msg}`);
        res.json({ code: 0, data: { applied, message: msg } });
    } catch (error) {
        console.error('[投标助手] 模板应用失败:', error.message);
        res.status(500).json({ code: 500, message: error.message || '模板应用失败' });
    }
});

// ============================================================
// ■ 查找替换（直接在原始 XML 中替换文本，100% 保留格式）
// ============================================================

// POST /find-replace — 查找替换（支持三种模式）
// - replaceAll=true: 替换全部匹配
// - replaceIndex=N: 替换第 N 个匹配（0-based）
// - 其他: 仅查找，返回匹配数和上下文
router.post('/find-replace', async (req, res) => {
    try {
        const id = validateId(req.body.draftId);
        if (!id) return res.status(400).json({ code: 400, message: '无效的草稿ID' });
        const userId = req.user?.username || 'unknown';
        const { findText, replaceText, replaceAll, replaceIndex } = req.body;

        if (!findText) {
            return res.status(400).json({ code: 400, message: '请输入查找文本' });
        }

        const result = await pool.query(
            'SELECT source_data FROM bid_assistant_drafts WHERE id = $1 AND user_id = $2',
            [id, userId]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ code: 404, message: '草稿不存在' });
        }

        const sourceData = result.rows[0].source_data;
        if (!sourceData || sourceData.length === 0) {
            return res.status(400).json({ code: 400, message: '源文件数据为空' });
        }

        const zip = new PizZip(Buffer.from(sourceData));
        const xml = zip.file('word/document.xml').asText();

        // 模式 1：仅查找（不替换）
        const doFindOnly = !replaceAll && replaceIndex == null;
        if (doFindOnly) {
            const { count, matches } = findInXml(xml, findText);
            console.log(`[投标助手] 查找: "${findText}" 匹配 ${count} 处`);
            return res.json({ code: 0, data: { count, matches, mode: 'find' } });
        }

        // 模式 2：替换全部 或 替换第 N 个
        const isReplaceAll = replaceAll === true;
        const targetIndex = isReplaceAll ? -1 : (parseInt(replaceIndex) || 0);
        const { newXml, count, totalFound } = findAndReplaceInXml(xml, findText, replaceText || '', targetIndex);

        if (count === 0) {
            return res.json({ code: 0, data: { count: 0, message: '未找到匹配文本', mode: 'replace' } });
        }

        // 更新 XML 并重新打包
        zip.file('word/document.xml', newXml);
        const newBuffer = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });

        // 更新数据库中的 source_data（含 user_id 鉴权）
        await pool.query(
            'UPDATE bid_assistant_drafts SET source_data = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3',
            [newBuffer, id, userId]
        );

        const mode = isReplaceAll ? 'replaceAll' : 'replaceOne';
        const msg = isReplaceAll
            ? `已替换全部 ${count} 处`
            : `已替换第 ${(targetIndex || 0) + 1} 处`;
        console.log(`[投标助手] 查找替换: "${findText}" → "${replaceText || ''}" ${msg} (总匹配 ${totalFound})`);
        res.json({ code: 0, data: { count, totalFound, message: msg, mode } });
    } catch (error) {
        console.error('[投标助手] 查找替换失败:', error.message);
        res.status(500).json({ code: 500, message: error.message || '查找替换失败' });
    }
});

// ============================================================
// ■ 标书预览与导出
// ============================================================

/** 获取源文件 buffer（从 BYTEA 读取） */
function getSourceBuffer(draft) {
    if (draft.source_data && draft.source_data.length > 0) {
        return Buffer.from(draft.source_data);
    }
    return null;
}

// GET /preview/:id — 预览标书（直接返回 source_data，查找替换已直接修改了 source_data）
router.get('/preview/:id', async (req, res) => {
    try {
        const id = validateId(req.params.id);
        if (!id) return res.status(400).json({ code: 400, message: '无效的草稿ID' });
        const userId = req.user?.username || 'unknown';

        const result = await pool.query(
            'SELECT * FROM bid_assistant_drafts WHERE id = $1 AND user_id = $2',
            [id, userId]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ code: 404, message: '草稿不存在' });
        }

        const draft = result.rows[0];
        const safeName = (draft.project_name || '投标文件').replace(/[\\/:*?"<>|]/g, '_');
        const sourceBuf = getSourceBuffer(draft);

        if (sourceBuf) {
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
            res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(safeName + '.docx')}`);
            res.send(sourceBuf);
            return;
        }

        return res.status(404).json({ code: 404, message: '源文件不存在' });
    } catch (error) {
        console.error('[投标助手] 预览失败:', error.message);
        return res.status(500).json({ code: 500, message: '预览失败: ' + error.message });
    }
});

// ============================================================
// ■ 标书生成下载
// ============================================================

// GET /export/:id — 导出标书文件（.docx）下载
router.get('/export/:id', async (req, res) => {
    try {
        const id = validateId(req.params.id);
        if (!id) return res.status(400).json({ code: 400, message: '无效的草稿ID' });
        const userId = req.user?.username || 'unknown';

        const result = await pool.query(
            'SELECT * FROM bid_assistant_drafts WHERE id = $1 AND user_id = $2',
            [id, userId]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ code: 404, message: '草稿不存在' });
        }

        const draft = result.rows[0];
        const safeName = (draft.project_name || '投标文件').replace(/[\\/:*?"<>|]/g, '_');

        // 直接返回 source_data（查找替换已直接修改了 source_data）
        const sourceBuf = getSourceBuffer(draft);
        if (sourceBuf) {
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
            res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeName + '.docx')}`);
            res.send(sourceBuf);
            return;
        }

        // 降级方案：使用 docxBuilder 构建 DOCX（适用于源文件缺失时）
        const chapters = Array.isArray(draft.chapters) ? draft.chapters : [];
        if (chapters.length === 0) {
            return res.status(404).json({ code: 404, message: '源文件不存在且无章节数据' });
        }
        const sorted = [...chapters].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        const buf = buildDocx(sorted, draft.project_name || '投标文件');

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeName + '.docx')}`);
        res.send(buf);
    } catch (error) {
        console.error('[投标助手] 生成标书失败:', error.message);
        if (!res.headersSent) {
            res.status(500).json({ code: 500, message: '生成标书失败: ' + error.message });
        }
    }
});

export default router;
