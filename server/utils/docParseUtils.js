// ============================================================
// server/utils/docParseUtils.js — 标书文件解析工具
// 支持 .docx（mammoth），
// 按多层级章节标题拆分，自动识别并剔除目录部分，保留表格结构
// ============================================================
import path from 'path';
import mammoth from 'mammoth';
import { parse as parseHtml } from 'node-html-parser';

// ─── 章节标题识别 ─────────────────────────────────────────────
// 常见标题模式及其层级：
//  第X章/第X部分 → level 1
//  第X节          → level 2
//  X. / X、       → level 2
//  X.X / X.X.X    → level 3 / level 4
//  一、二、（中文序号）→ level 2
// 注：（1）（2）等括号序号为列表项，不作为章节标题
const CHAPTER_PATTERNS = [
    { regex: /^第[一二三四五六七八九十百0-9]+[章部分卷].*$/, level: 1 },
    { regex: /^第[一二三四五六七八九十百0-9]+节.*$/, level: 2 },
    { regex: /^[一二三四五六七八九十]+、.*$/, level: 2 },
    { regex: /^\d+\.\d+\.\d+.*$/, level: 4 },
    { regex: /^\d+\.\d+.*$/, level: 3 },
    { regex: /^\d+[\.、]\s*\D.*$/, level: 2 },
    // 标书常见固定标题（无序号）
    { regex: /^(投标人须知前附表|投标人须知|评标办法前附表|评标办法|资格审查表|开标记录|合同条款|工程量清单|投标报价表|技术规范|投标保证金|开标一览表|报价清单|施工组织设计|项目管理机构|业绩证明).{0,20}$/, level: 2 },
];

// 句尾标点：以此结尾的行通常是正文句子而非标题
const SENTENCE_END_RE = /[。，、；：！？…,.]$/;

/** 根据文本内容判断章节层级（不依赖 HTML 标签） */
function getTextLevel(text) {
    const trimmed = (text || '').trim();
    if (!trimmed) return null;
    for (const { regex, level } of CHAPTER_PATTERNS) {
        if (regex.test(trimmed)) return level;
    }
    return null;
}

/** 判断一行文本是否为章节标题，返回 { title, level } 或 null */
export function detectHeading(text) {
    const trimmed = (text || '').trim();
    if (!trimmed || trimmed.length > 30) return null; // 标题不会太长
    if (SENTENCE_END_RE.test(trimmed)) return null;   // 以句尾标点结尾的是正文
    // 如果末尾带页码数字（如"第一章 招标公告 3"），这是目录条目，不是真正的标题
    if (hasTrailingPageNumber(trimmed)) return null;
    for (const { regex, level } of CHAPTER_PATTERNS) {
        if (regex.test(trimmed)) {
            return { title: trimmed, level };
        }
    }
    return null;
}

/** 判断文本是否为目录行特征（末尾带页码数字） */
function hasTrailingPageNumber(text) {
    // "标题 ... 12" / "标题\t12" / "标题  12" — 末尾是 1~3 位页码
    return /[\s\t]\d{1,3}\s*$/.test(text.trim());
}

/** 判断文本是否为目录行（含 PAGEREF / 内部超链接 + 页码 等特征） */
function isTocLine(text) {
    if (!text) return false;
    if (/PAGEREF|HYPERLINK\s+\\l|TOC\s+\\o/.test(text)) return true;
    // "标题 ...... 12" 或 "标题\t12" 或 "标题  12" 形式
    if (/[.…·\t]\s*\d{1,3}\s*$/.test(text) && text.length < 80) return true;
    // 目录条目特征：章节标题模式 + 末尾页码（如"第一章 招标公告 3"）
    if (hasTrailingPageNumber(text) && text.length < 80) {
        const withoutPageNum = text.replace(/\s+\d{1,3}\s*$/, '').trim();
        // 匹配已知章节模式
        for (const { regex } of CHAPTER_PATTERNS) {
            if (regex.test(withoutPageNum)) return true;
        }
        // 匹配 "X.X 标题 页码" 或 "一、标题 页码" 等
        if (/^[\d一二三四五六七八九十]+[\.、]/.test(withoutPageNum)) return true;
        // 在目录区域内，任何短的、非句子形式的文本+页码都视为目录条目
        if (withoutPageNum.length < 30 && !/[。，、；：！？…]$/.test(withoutPageNum)) {
            return true;
        }
    }
    return false;
}

/** 将 HTML 字符串按块级元素拆分为 [{ type: 'heading'|'paragraph'|'table'|'list', level?, html, text }]
 *  使用 node-html-parser 进行 DOM 解析，正确处理嵌套块级元素 */
function splitHtmlBlocks(html) {
    const blocks = [];
    const BLOCK_TAGS = new Set(['h1','h2','h3','h4','h5','h6','p','table','ul','ol','blockquote','div','pre']);

    const root = parseHtml(html, { blockTextElements: { script: false, style: false } });

    function extractBlocks(node) {
        const children = node.childNodes || [];
        let hasBlockChild = false;
        for (const child of children) {
            if (child.nodeType !== 1) continue;
            const tag = (child.tagName || '').toLowerCase();
            if (BLOCK_TAGS.has(tag)) {
                hasBlockChild = true;
                const innerHtml = child.outerHTML;
                const text = child.textContent.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
                if (tag.startsWith('h')) {
                    blocks.push({ type: 'heading', level: parseInt(tag[1], 10), html: innerHtml, text });
                } else if (tag === 'table') {
                    blocks.push({ type: 'table', html: innerHtml, text });
                } else {
                    blocks.push({ type: 'paragraph', html: innerHtml, text });
                }
            }
        }
        // 如果没有块级子元素，将整个节点内容作为一个段落
        if (!hasBlockChild && children.length > 0) {
            const text = node.textContent.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
            if (text) {
                blocks.push({ type: 'paragraph', html: node.innerHTML || node.outerHTML || '', text });
            }
        }
    }

    extractBlocks(root);

    // 兜底：若没有匹配到任何块（如纯文本），整体作为段落
    if (blocks.length === 0 && html.trim()) {
        blocks.push({ type: 'paragraph', html: `<p>${html}</p>`, text: html.replace(/<[^>]+>/g, '').trim() });
    }
    return blocks;
}

/** 将目录条目文本格式化为 HTML（标题左侧 + 页码右侧） */
function formatTocEntry(text) {
    const trimmed = text.trim();
    const match = trimmed.match(/^(.+?)\s+(\d{1,3})\s*$/);
    let title = trimmed;
    let page = '';
    if (match) { title = match[1]; page = match[2]; }
    // 根据标题模式判断缩进层级
    let indent = 1;
    if (/^第[一二三四五六七八九十]+[章部分卷]/.test(title)) indent = 0;
    else if (/^[一二三四五六七八九十]+、/.test(title)) indent = 1;
    else if (/^第[一二三四五六七八九十]+节/.test(title)) indent = 1;
    else if (/^\d+\.\d+\.\d+/.test(title)) indent = 3;
    else if (/^\d+\.\d+/.test(title)) indent = 2;
    else if (/^\d+[\.、]/.test(title)) indent = 1;
    else if (/^第[一二三四五六七八九十]+部分/.test(title)) indent = 0;

    const paddingLeft = 12 + indent * 18;
    if (page) {
        return `<div style="display:flex;align-items:baseline;padding-left:${paddingLeft}px;margin:1px 0;line-height:1.8"><span style="flex:1">${escapeHtml(title)}</span><span style="flex-shrink:0;margin-left:12px;color:#64748b;font-size:12px">${page}</span></div>`;
    }
    return `<div style="padding-left:${paddingLeft}px;margin:1px 0;line-height:1.8">${escapeHtml(title)}</div>`;
}

/**
 * 将块序列拆分为多层级章节列表（扁平数组，含 level/order）
 * 自动跳过文档目录部分
 */
export function blocksToChapters(blocks) {
    // 预处理：拆分包含“目 录”标题的混合块
    const processedBlocks = [];
    for (const block of blocks) {
        // 匹配“目”后跟任意不可见字符（含空格、NBSP、零宽字符等）再跟“录”
        const tocIdx = block.text.search(/目[\s\u00A0\u200B\u200C\u200D\uFEFF]*录/);
        if (tocIdx > 0) {
            // “目 录”前有前置内容 — 拆分
            const beforeText = block.text.substring(0, tocIdx).trim();
            const afterMatch = block.text.substring(tocIdx).match(/目[\s\u00A0\u200B\u200C\u200D\uFEFF]*录(.*)$/);
            const afterText = afterMatch && afterMatch[1] ? afterMatch[1].trim() : '';
            // 从 HTML 中移除“目 录”及其周围的锚点/加粗标签
            const cleanHtml = block.html.replace(/<a[^>]*id="_Toc\d+"[^>]*><\/a>/gi, '')
                .replace(/<strong>\s*目[\s\u00A0\u200B\u200C\u200D\uFEFF]*录\s*<\/strong>/gi, '')
                .replace(/目[\s\u00A0\u200B\u200C\u200D\uFEFF]*录/gi, '');
            if (beforeText) {
                processedBlocks.push({ type: block.type, html: cleanHtml, text: beforeText });
            }
            processedBlocks.push({ type: 'paragraph', html: '<p>目 录</p>', text: '目 录' });
            if (afterText) {
                processedBlocks.push({ type: block.type, html: '', text: afterText });
            }
        } else {
            processedBlocks.push(block);
        }
    }

    const chapters = [];
    let current = null;      // 当前章节节点
    let order = 0;
    let inTocZone = false;   // 是否处于目录区域
    let preambleHtml = [];   // 首个章节之前的内容（封面等）
    let tocCreated = false;  // 是否已创建目录章节
    let tocChapterRef = null; // 目录章节引用
    let tocBuf = [];         // 目录条目缓冲区（用于无“目 录”标题时延迟创建）

    const pushContent = (html) => {
        if (!html || !html.trim()) return;
        if (current) {
            current.contentHtml += html;
        } else {
            preambleHtml.push(html);
        }
    };

    // 将缓冲区中的目录条目一次性写入目录章节
    const flushTocBuf = () => {
        if (tocBuf.length === 0) return;
        for (const entry of tocBuf) {
            tocChapterRef.contentHtml += formatTocEntry(entry);
        }
        tocBuf = [];
    };

    for (const block of processedBlocks) {
        const trimmedText = block.text.trim();
        // 目录标题检测：匹配“目 录”“目   录”“目录”等变体
        const isTocHeader = /^目[\s\u00A0\u200B\u200C\u200D\uFEFF]*录$/.test(trimmedText) || trimmedText === '目录';

        if (isTocHeader && !tocCreated) {
            // “目 录” 标题 — 创建唯一的目录章节
            inTocZone = true;
            tocCreated = true;
            order++;
            tocChapterRef = {
                id: `ch_${order}`,
                title: '目录',
                level: 1,
                order,
                contentHtml: ''
            };
            chapters.push(tocChapterRef);
            flushTocBuf();
            continue;
        }

        if (inTocZone) {
            // 在目录区域内：判断当前行是否仍是目录条目
            if (isTocLine(block.text)) {
                tocChapterRef.contentHtml += formatTocEntry(block.text);
                continue;
            }
            // 目录区域结束
            inTocZone = false;
        }

        // 未找到“目 录”标题时，通过连续目录条目自动检测
        if (!tocCreated && isTocLine(block.text)) {
            tocBuf.push(block.text);
            if (tocBuf.length >= 2) {
                // 连续 2 条以上目录条目 — 自动创建目录章节
                tocCreated = true;
                inTocZone = true;
                order++;
                tocChapterRef = {
                    id: `ch_${order}`,
                    title: '目录',
                    level: 1,
                    order,
                    contentHtml: ''
                };
                chapters.push(tocChapterRef);
                flushTocBuf();
            }
            continue;
        }

        // 如果缓冲区有内容但不是目录条目，清空缓冲区
        if (tocBuf.length > 0) {
            // 把缓冲区内容当作前言内容
            for (const entry of tocBuf) {
                preambleHtml.push(`<p>${entry}</p>`);
            }
            tocBuf = [];
        }

        // 判断是否为新章节标题
        let heading = null;
        if (block.type === 'heading') {
            if (hasTrailingPageNumber(block.text)) {
                // 带页码的 heading 是目录条目，不是真正的标题 — 直接跳过
                continue;
            }
            // 根据标题文本内容判断实际层级（不依赖 HTML 标签层级）
            const textLevel = getTextLevel(block.text);
            // 不匹配任何模式时，作为当前章节的子级
            const level = textLevel || (current ? Math.min(current.level + 1, 4) : block.level);
            heading = { title: block.text, level };
        } else if (block.type === 'paragraph') {
            heading = detectHeading(block.text);
        }

        if (heading) {
            order++;
            current = {
                id: `ch_${order}`,
                title: heading.title,
                level: heading.level,
                order,
                contentHtml: ''
            };
            chapters.push(current);
        } else {
            if (block.type === 'table') {
                pushContent(block.html);
            } else if (block.text) {
                pushContent(block.html);
            }
        }
    }

    // 若首个章节之前存在封面/前言内容，作为"前言"章节插入
    if (preambleHtml.length > 0) {
        const preambleText = preambleHtml.join('');
        if (preambleText.replace(/<[^>]+>/g, '').trim()) {
            chapters.unshift({
                id: 'ch_0',
                title: '封面与前言',
                level: 1,
                order: 0,
                contentHtml: preambleText
            });
            chapters.forEach((c, i) => { c.order = i; });
        }
    }

    return chapters;
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 将扁平章节列表构建为多层级嵌套树（children 数组） */
export function buildChapterTree(flat) {
    const roots = [];
    const stack = [];
    for (const node of flat) {
        const item = { ...node, children: [] };
        while (stack.length && stack[stack.length - 1].level >= item.level) stack.pop();
        if (stack.length) stack[stack.length - 1].children.push(item);
        else roots.push(item);
        stack.push(item);
    }
    return roots;
}

/** 解析 .docx 文件，返回章节列表 */
export async function parseDocx(filePath) {
    const result = await mammoth.convertToHtml({ path: filePath });
    const blocks = splitHtmlBlocks(result.value);
    return blocksToChapters(blocks);
}

/**
 * 统一入口：按扩展名解析标书文件（当前仅支持 .docx）
 * @returns {Promise<{ chapters: Array, fileName: string }>}
 */
export async function parseBidFile(filePath, originalName) {
    const ext = path.extname(originalName || filePath).toLowerCase();
    let chapters;
    if (ext === '.docx') {
        chapters = await parseDocx(filePath);
    } else {
        throw new Error(`暂不支持的文件格式：${ext}，当前仅支持 .docx`);
    }
    if (!chapters || chapters.length === 0) {
        throw new Error('未能从文件中解析出任何章节，请检查文件内容是否包含章节标题');
    }
    return { chapters, fileName: originalName };
}
