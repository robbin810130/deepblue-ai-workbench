// ============================================================
// server/utils/docxBuilder.js — 基于 PizZip 的 docx 构建器
// 从零构建格式规范的 Word 文档，样式完全可控
// ============================================================
import PizZip from 'pizzip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

/**
 * 将 HTML 内容转换为 WordprocessingML XML 字符串
 * @param {string} html - HTML 内容
 * @returns {string} Word XML 片段
 */
export function htmlToWordMl(html) {
    const parser = new DOMParser();
    // 使用 text/html 解析后只取 body 内容，避免 head 中的意外内容泄漏到 Word XML
    const htmlDoc = parser.parseFromString(`<root>${html || ''}</root>`, 'text/html');
    const serializer = new XMLSerializer();

    function escapeXml(text) {
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // 递归处理 HTML 节点 → 生成 Word XML 字符串
    function processNode(node) {
        if (node.nodeType === 3) { // 文本节点
            const text = node.textContent || '';
            if (!text.trim()) return '';
            return `<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
        }
        if (node.nodeType !== 1) return '';

        const tag = node.tagName.toLowerCase();
        const style = node.getAttribute('style') || '';

        // ─── 段落/标题 ───
        if (['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
            let pPr = '';
            if (tag.startsWith('h')) {
                const level = Math.min(parseInt(tag[1], 10), 6);
                pPr += `<w:pStyle w:val="Heading${level}"/>`;
            }
            // 对齐方式
            if (style.includes('text-align: center')) {
                pPr += '<w:jc w:val="center"/>';
            } else if (style.includes('text-align: right')) {
                pPr += '<w:jc w:val="right"/>';
            }
            const children = Array.from(node.childNodes).map(processNode).join('');
            return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${children}</w:p>`;
        }

        // ─── 表格 ───
        if (tag === 'table') {
            let tbl = `<w:tbl><w:tblPr>
                <w:tblW w:w="5000" w:type="pct"/>
                <w:tblBorders>
                    <w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/>
                    <w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/>
                    <w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/>
                    <w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/>
                    <w:insideH w:val="single" w:sz="4" w:space="0" w:color="000000"/>
                    <w:insideV w:val="single" w:sz="4" w:space="0" w:color="000000"/>
                </w:tblBorders>
            </w:tblPr>`;

            const rows = node.getElementsByTagName('tr');
            for (let ri = 0; ri < rows.length; ri++) {
                const row = rows[ri];
                tbl += '<w:tr>';
                // 按 DOM 原始顺序遍历单元格，保持 th/td 原始位置
                const allCells = Array.from(row.children).filter(
                    c => c.tagName.toLowerCase() === 'td' || c.tagName.toLowerCase() === 'th'
                ).map(el => ({ el, head: el.tagName.toLowerCase() === 'th' }));
                for (const { el: cell, head: isHead } of allCells) {
                    const cellChildren = Array.from(cell.childNodes).map(processNode).join('');
                    // 单元格内容如果为空则加一个空段落
                    const cellContent = cellChildren || '<w:p/>';
                    tbl += `<w:tc><w:tcPr><w:tcBorders>
                        <w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/>
                        <w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/>
                        <w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/>
                        <w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/>
                    </w:tcBorders>${isHead ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>' : ''}
                    <w:vAlign w:val="center"/></w:tcPr>${cellContent}</w:tc>`;
                }
                tbl += '</w:tr>';
            }
            tbl += '</w:tbl>';
            return tbl;
        }

        // ─── 列表 ───
        if (tag === 'ul' || tag === 'ol') {
            let result = '';
            let idx = 0;
            // 只遍历直接子元素中的 li，避免 getElementsByTagName 获取所有后代 li 导致嵌套列表项重复
            const lis = Array.from(node.children).filter(c => c.tagName.toLowerCase() === 'li');
            for (const li of lis) {
                idx++;
                const prefix = tag === 'ol' ? `${idx}. ` : '• ';
                const children = Array.from(li.childNodes).map(processNode).join('');
                result += `<w:p><w:pPr><w:ind w:left="420"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(prefix)}</w:t></w:r>${children}</w:p>`;
            }
            return result;
        }

        // ─── 行内格式 ───
        if (['strong', 'b'].includes(tag)) {
            const children = Array.from(node.childNodes).map(processNode).join('');
            return `<w:r><w:rPr><w:b/></w:rPr>${children.replace(/<w:r>/g, '').replace(/<\/w:r>/g, '')}</w:r>`;
        }
        if (['em', 'i'].includes(tag)) {
            const children = Array.from(node.childNodes).map(processNode).join('');
            return `<w:r><w:rPr><w:i/></w:rPr>${children.replace(/<w:r>/g, '').replace(/<\/w:r>/g, '')}</w:r>`;
        }
        if (tag === 'br') {
            return '<w:r><w:br/></w:r>';
        }
        if (tag === 'span') {
            return Array.from(node.childNodes).map(processNode).join('');
        }
        if (tag === 'img') {
            // 图片无法内嵌（无二进制数据），输出占位提示
            const alt = node.getAttribute('alt') || '图片';
            return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t xml:space="preserve">[${escapeXml(alt)}]</w:t></w:r></w:p>`;
        }

        // ─── 其他标签：递归处理子节点 ───
        return Array.from(node.childNodes).map(processNode).join('');
    }

    // 处理根节点下的所有子节点：优先取 body 内容，避免 head 中的意外内容泄漏
    let result = '';
    const bodyEl = htmlDoc.getElementsByTagName('body')[0];
    const rootEl = bodyEl || htmlDoc.documentElement;
    for (const child of Array.from(rootEl.childNodes)) {
        result += processNode(child);
    }
    return result;
}

/**
 * 构建完整 docx 文件
 * @param {Array} chapters - 章节列表（含 title, level, contentHtml）
 * @param {string} projectName - 项目名称
 * @returns {Buffer} docx 文件 Buffer
 */
export function buildDocx(chapters, projectName = '投标文件') {
    const sorted = [...chapters].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    // ─── document.xml ───
    let bodyXml = '';
    for (const c of sorted) {
        const lv = Math.min(Math.max(c.level || 1, 1), 6);
        bodyXml += `<w:p><w:pPr><w:pStyle w:val="Heading${lv}"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(c.title || '')}</w:t></w:r></w:p>`;
        bodyXml += htmlToWordMl(c.contentHtml || '');
    }
    // 段落标记
    bodyXml += '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>';

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>${bodyXml}</w:body>
</w:document>`;

    // ─── styles.xml ───
    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:docDefaults>
        <w:rPrDefault><w:rPr><w:rFonts w:ascii="SimSun" w:eastAsia="宋体" w:hAnsi="SimSun"/><w:sz w:val="24"/></w:rPr></w:rPrDefault>
        <w:pPrDefault><w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault>
    </w:docDefaults>
    <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
        <w:name w:val="Normal"/>
        <w:rPr><w:rFonts w:ascii="SimSun" w:eastAsia="宋体" w:hAnsi="SimSun"/><w:sz w:val="24"/></w:rPr>
    </w:style>
    <w:style w:type="paragraph" w:styleId="Heading1">
        <w:name w:val="heading 1"/>
        <w:basedOn w:val="Normal"/>
        <w:next w:val="Normal"/>
        <w:qFormat/>
        <w:pPr><w:keepNext/><w:spacing w:before="360" w:after="240"/><w:jc w:val="center"/><w:outlineLvl w:val="0"/></w:pPr>
        <w:rPr><w:rFonts w:ascii="SimHei" w:eastAsia="黑体" w:hAnsi="SimHei"/><w:b/><w:sz w:val="36"/></w:rPr>
    </w:style>
    <w:style w:type="paragraph" w:styleId="Heading2">
        <w:name w:val="heading 2"/>
        <w:basedOn w:val="Normal"/>
        <w:next w:val="Normal"/>
        <w:qFormat/>
        <w:pPr><w:keepNext/><w:spacing w:before="280" w:after="160"/><w:outlineLvl w:val="1"/></w:pPr>
        <w:rPr><w:rFonts w:ascii="SimHei" w:eastAsia="黑体" w:hAnsi="SimHei"/><w:b/><w:sz w:val="30"/></w:rPr>
    </w:style>
    <w:style w:type="paragraph" w:styleId="Heading3">
        <w:name w:val="heading 3"/>
        <w:basedOn w:val="Normal"/>
        <w:next w:val="Normal"/>
        <w:qFormat/>
        <w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="2"/></w:pPr>
        <w:rPr><w:rFonts w:ascii="SimHei" w:eastAsia="黑体" w:hAnsi="SimHei"/><w:b/><w:sz w:val="28"/></w:rPr>
    </w:style>
    <w:style w:type="paragraph" w:styleId="Heading4">
        <w:name w:val="heading 4"/>
        <w:basedOn w:val="Normal"/>
        <w:next w:val="Normal"/>
        <w:qFormat/>
        <w:pPr><w:keepNext/><w:spacing w:before="200" w:after="100"/><w:outlineLvl w:val="3"/></w:pPr>
        <w:rPr><w:rFonts w:ascii="SimSun" w:eastAsia="宋体" w:hAnsi="SimSun"/><w:b/><w:sz w:val="24"/></w:rPr>
    </w:style>
    <w:style w:type="paragraph" w:styleId="Heading5">
        <w:name w:val="heading 5"/>
        <w:basedOn w:val="Normal"/>
        <w:next w:val="Normal"/>
        <w:qFormat/>
        <w:pPr><w:keepNext/><w:spacing w:before="160" w:after="80"/><w:outlineLvl w:val="4"/></w:pPr>
        <w:rPr><w:rFonts w:ascii="SimSun" w:eastAsia="宋体" w:hAnsi="SimSun"/><w:b/><w:sz w:val="24"/></w:rPr>
    </w:style>
    <w:style w:type="paragraph" w:styleId="Heading6">
        <w:name w:val="heading 6"/>
        <w:basedOn w:val="Normal"/>
        <w:next w:val="Normal"/>
        <w:qFormat/>
        <w:pPr><w:keepNext/><w:spacing w:before="120" w:after="60"/><w:outlineLvl w:val="5"/></w:pPr>
        <w:rPr><w:rFonts w:ascii="SimSun" w:eastAsia="宋体" w:hAnsi="SimSun"/><w:b/><w:sz w:val="24"/></w:rPr>
    </w:style>
</w:styles>`;

    // ─── [Content_Types].xml ───
    const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    <Default Extension="xml" ContentType="application/xml"/>
    <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
    <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
    <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
    <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

    // ─── _rels/.rels ───
    const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
    <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
    <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

    // ─── word/_rels/document.xml.rels ───
    const docRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

    // ─── docProps ───
    const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <dc:title>${escapeXml(projectName)}</dc:title>
    <dc:creator>WebOS Pro</dc:creator>
</cp:coreProperties>`;

    const appXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
    <Application>WebOS Pro</Application>
</Properties>`;

    // ─── 打包 ───
    const zip = new PizZip();
    zip.file('[Content_Types].xml', contentTypesXml);
    zip.file('_rels/.rels', rootRelsXml);
    zip.file('word/document.xml', documentXml);
    zip.file('word/styles.xml', stylesXml);
    zip.file('word/_rels/document.xml.rels', docRelsXml);
    zip.file('docProps/core.xml', coreXml);
    zip.file('docProps/app.xml', appXml);

    return zip.generate({ type: 'nodebuffer' });
}

function escapeXml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
