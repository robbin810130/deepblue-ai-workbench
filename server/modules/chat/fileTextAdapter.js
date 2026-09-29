/**
 * 「附件 → 文本槽」抽取适配（对话式改造 P1-4，2026-09-20）
 *
 * 背景：
 *   有些 Dify workflow 应用的 start 变量是**纯文本**，但业务上用户手上是 Excel/CSV。
 *   典型：`批量产品名提取品牌自动入库` 只要一个 `goods_name_list`（一行一个商品名）——
 *   它的消费代码对格式很宽容（先试 json.loads，失败则按 \n 分割），所以完全不需要拼 JSON，
 *   服务端把表格里的品名列抽出来、用 \n 拼成文本即可。
 *
 * 声明方式（技能 manifest）：
 *   file_to_text: { slot: 'goods_name_list', column: 'auto' }
 *   - slot   目标槽位 key（必须等于 Dify start 变量名）
 *   - column 'auto'（按表头猜）| 0/1/2...（列序号）| '列名'（精确表头）
 *
 * 设计原则：
 *   1. **宁可少抽不可乱抽** —— 猜不出品名列时显式返回原因，由调用方转成向用户的追问，
 *      绝不静默塞一列无关数据进工作流（错填业务数据的代价远大于多问一句）。
 *   2. **损坏/改后缀的文件要明确报错** —— 不能退化成「把整段二进制当品名」。
 *   3. **有上限** —— 超长列表会撑爆 Dify 的 paragraph（且业务上没意义），默认截断并标注。
 */

import * as XLSX from 'xlsx';

/** 表头里可能是「品名」的列特征 */
const NAME_HEADER_RE = /(商品|产品|品名|货品|名称|款式|型号|name|title|item|product)/i;
/** 一个文件最多抽多少条（防止撑爆 Dify 变量 / 业务上没意义） */
const DEFAULT_MAX_ITEMS = 500;
/** 头几行里找表头 */
const HEADER_SCAN_ROWS = 3;

/** 常见表格扩展名 */
export const SPREADSHEET_EXT = new Set(['xlsx', 'xls', 'csv', 'tsv']);

function extOf(name = '') {
    const i = String(name).lastIndexOf('.');
    return i >= 0 ? String(name).slice(i + 1).toLowerCase() : '';
}

const cell = (v) => (v === undefined || v === null ? '' : String(v).trim());
const isNumericCell = (s) => s !== '' && /^-?\d+(\.\d+)?$/.test(s);

/** xlsx = ZIP（PK\x03\x04）；xls = OLE2 复合文档 */
const looksLikeZip = (b) => b && b.length > 4 && b[0] === 0x50 && b[1] === 0x4b;
const looksLikeOle = (b) =>
    b && b.length > 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;

/**
 * 文本类附件解码。
 * ⚠️ 中文业务场景的坑：Windows 版 Excel 另存的 CSV 默认是 **GBK**，不是 UTF-8。
 *    先按 UTF-8 解，出现替换字符（\uFFFD）说明不是 UTF-8，再退回 GBK。
 */
export function decodeTextBuffer(buffer) {
    if (!Buffer.isBuffer(buffer)) return String(buffer || '').replace(/^\uFEFF/, '');
    const utf8 = buffer.toString('utf8');
    if (!utf8.includes('\uFFFD')) return utf8.replace(/^\uFEFF/, '');
    try {
        const gbk = new TextDecoder('gbk').decode(buffer);
        if (!gbk.includes('\uFFFD')) return gbk.replace(/^\uFEFF/, '');
    } catch {
        /* 运行时没带 gbk 解码器 → 保持 UTF-8 结果 */
    }
    return utf8.replace(/^\uFEFF/, '');
}

/**
 * 判断哪一行是表头。返回 -1 表示「没有表头，全是数据」。
 *
 * 三条规则（从上到下，先命中先用）：
 *   1. 某个单元格命中品名特征词 → 最强信号（也覆盖「无表头但首行像表头」）
 *   2. 用户显式给了列名 → 在头几行里找这个名字所在行
 *   3. 多列 + 首行全是非数字文本 → 视为表头（多列表格几乎都有表头）
 *
 * ⚠️ 规则 3 对「无表头的多列纯文本表」会误判，但那种情况 pickColumn 会因认不出品名列而
 *    **安全失败**（转成追问），不会写错数据。
 */
function detectHeaderRow(rows, column, width) {
    const scan = Math.min(HEADER_SCAN_ROWS, rows.length);

    for (let i = 0; i < scan; i++) {
        if ((rows[i] || []).some((c) => NAME_HEADER_RE.test(cell(c)))) return i;
    }
    if (typeof column === 'string' && column !== 'auto') {
        for (let i = 0; i < scan; i++) {
            if ((rows[i] || []).some((c) => cell(c) === column)) return i;
        }
    }
    if (width >= 2 && rows.length > 1 && (rows[0] || []).every((c) => !isNumericCell(cell(c)))) return 0;
    return -1;
}

/**
 * 从二维数组里挑出品名列。
 * @returns {{ index: number, reason: string }|null} null = 猜不出（调用方须转为追问）
 */
function pickColumn(rows, column, headerRowIdx) {
    if (rows.length === 0) return null;
    const width = Math.max(...rows.map((r) => r.length));

    // 显式给列序号
    if (typeof column === 'number' && Number.isInteger(column) && column >= 0 && column < width) {
        return { index: column, reason: `按指定列序号 ${column}` };
    }
    // 显式给列名 → 找表头匹配（精确优先，再模糊）
    if (typeof column === 'string' && column !== 'auto' && headerRowIdx >= 0) {
        const header = rows[headerRowIdx] || [];
        const idx = header.findIndex((h) => cell(h) === column);
        if (idx >= 0) return { index: idx, reason: `按指定列名「${column}」` };
        const fuzzy = header.findIndex((h) => cell(h).includes(column));
        if (fuzzy >= 0) return { index: fuzzy, reason: `按列名模糊匹配「${column}」` };
        return null;
    }

    // auto：表头里猜
    if (headerRowIdx >= 0) {
        const header = rows[headerRowIdx] || [];
        const idx = header.findIndex((h) => NAME_HEADER_RE.test(cell(h)));
        if (idx >= 0) return { index: idx, reason: `按表头「${cell(header[idx])}」识别` };
    }
    // 兜底：只有一列时用它
    if (width === 1) return { index: 0, reason: '表格只有一列，直接取该列' };
    return null;
}

/**
 * 解析表格 buffer → 品名列表。
 * @param {Buffer} buffer
 * @param {{ column?: 'auto'|number|string, maxItems?: number, binary?: boolean|null }} [opts]
 *        binary=true 时先校验文件头（xlsx/xls 必须真的是 ZIP/OLE，防损坏或改后缀）
 * @returns {{ ok: true, values: string[], truncated: boolean, reason: string }
 *          |{ ok: false, error: string }}
 */
export function extractNamesFromSpreadsheet(buffer, { column = 'auto', maxItems = DEFAULT_MAX_ITEMS, binary = null } = {}) {
    if (binary === true && !looksLikeZip(buffer) && !looksLikeOle(buffer)) {
        return { ok: false, error: '这个文件不是有效的 Excel（可能已损坏，或只是把后缀改成了 .xlsx），请重新导出后上传。' };
    }

    let rows;
    try {
        // csv/tsv 是纯文本：必须当字符串读，否则中文会被 SheetJS 按二进制解成乱码。
        // xlsx/xls（binary !== false）是二进制，按 buffer 读。
        const wb =
            binary === false
                ? XLSX.read(decodeTextBuffer(buffer), { type: 'string' })
                : XLSX.read(buffer, { type: 'buffer' });
        const sheetName = wb.SheetNames[0];
        if (!sheetName) return { ok: false, error: '文件里没有可读的工作表' };
        rows = XLSX.utils
            .sheet_to_json(wb.Sheets[sheetName], { header: 1, blankrows: false, defval: '' })
            .map((r) => (Array.isArray(r) ? r : [r]));
    } catch (e) {
        return { ok: false, error: `表格解析失败：${e?.message || e}` };
    }
    if (rows.length === 0) return { ok: false, error: '表格是空的' };

    const width = Math.max(...rows.map((r) => r.length));
    const headerRowIdx = detectHeaderRow(rows, column, width);
    const picked = pickColumn(rows, column, headerRowIdx);
    if (!picked) {
        const headers =
            headerRowIdx >= 0 ? (rows[headerRowIdx] || []).map(cell).filter(Boolean).join(' | ') : '(没认出表头)';
        return {
            ok: false,
            error: `没能在表格里认出「商品名」列（表头：${headers}）。请把品名单独放一列，或直接在对话里一行一个商品名发我。`,
        };
    }

    const dataRows = headerRowIdx >= 0 ? rows.slice(headerRowIdx + 1) : rows;
    const values = [];
    let total = 0;
    for (const r of dataRows) {
        const v = cell(r[picked.index]);
        if (!v) continue;
        total++;
        if (values.length < maxItems) values.push(v);
    }
    if (values.length === 0) return { ok: false, error: '认出了列，但该列没有数据' };
    return { ok: true, values, truncated: total > values.length, reason: picked.reason };
}

/** 纯文本文件（.txt/.md）→ 按行拆 */
export function extractNamesFromPlainText(buffer, { maxItems = DEFAULT_MAX_ITEMS } = {}) {
    const text = decodeTextBuffer(buffer);
    const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
    if (lines.length === 0) return { ok: false, error: '文本文件里没有内容' };
    const values = lines.slice(0, maxItems);
    return { ok: true, values, truncated: lines.length > values.length, reason: '按文本行拆' };
}

/**
 * 统一入口：按扩展名选解析器。
 * @param {{ buffer: Buffer, name?: string, mimeType?: string }} file
 * @param {{ column?: 'auto'|number|string, maxItems?: number }} [opts]
 */
export function extractNamesFromFile(file, opts = {}) {
    const ext = extOf(file?.name || '');
    if (ext === 'xlsx' || ext === 'xls') return extractNamesFromSpreadsheet(file.buffer, { ...opts, binary: true });
    if (ext === 'csv' || ext === 'tsv') return extractNamesFromSpreadsheet(file.buffer, { ...opts, binary: false });
    if (ext === 'txt' || ext === 'md') return extractNamesFromPlainText(file.buffer, opts);
    return {
        ok: false,
        error: `不支持从 .${ext || '未知'} 文件抽取文本，请上传 Excel/CSV，或直接在对话里把内容发我。`,
    };
}

/**
 * 把抽取结果转成要写进槽位的多行文本。
 * @returns {{ text: string, notice: string }}
 */
export function namesToSlotText(values, { truncated = false, reason = '' } = {}) {
    const text = values.join('\n');
    const notice = `已从附件抽出 ${values.length} 项${reason ? `（${reason}）` : ''}${truncated ? '，超出部分已截断' : ''}。`;
    return { text, notice };
}
