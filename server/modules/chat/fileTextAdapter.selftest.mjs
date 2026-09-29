/**
 * fileTextAdapter 自测（纯函数，零外部依赖）
 *   node server/modules/chat/fileTextAdapter.selftest.mjs
 */
import * as XLSX from 'xlsx';
import {
    extractNamesFromSpreadsheet,
    extractNamesFromPlainText,
    extractNamesFromFile,
    namesToSlotText,
    decodeTextBuffer,
} from './fileTextAdapter.js';

let pass = 0;
let fail = 0;
const t = (name, fn) => {
    try {
        fn();
        pass++;
        console.log(`  ✅ ${name}`);
    } catch (e) {
        fail++;
        console.log(`  ❌ ${name}\n     ${e.message}`);
    }
};
const eq = (a, b, msg = '') => {
    const A = JSON.stringify(a);
    const B = JSON.stringify(b);
    if (A !== B) throw new Error(`${msg} 期望 ${B}，实际 ${A}`);
};
const ok = (c, msg) => {
    if (!c) throw new Error(msg || '断言失败');
};

/** 用二维数组造一个 xlsx buffer */
const book = (rows) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
};

console.log('fileTextAdapter 自测\n');

t('表头含「商品名称」→ 取该列', () => {
    const r = extractNamesFromSpreadsheet(book([
        ['编号', '商品名称', '规格'],
        [1, '不锈钢保温杯 500ml', 'A'],
        [2, '折叠雨伞', 'B'],
    ]));
    ok(r.ok, r.error);
    eq(r.values, ['不锈钢保温杯 500ml', '折叠雨伞']);
    ok(/商品名称/.test(r.reason), '应说明按表头识别');
});

t('表头含「产品」也能识别', () => {
    const r = extractNamesFromSpreadsheet(book([['产品', '价格'], ['小风扇', 30]]));
    ok(r.ok, r.error);
    eq(r.values, ['小风扇']);
});

t('英文表头 product name 也能识别（大小写不敏感）', () => {
    const r = extractNamesFromSpreadsheet(book([['NO.', 'Product Name'], [1, 'Desk Lamp']]));
    ok(r.ok, r.error);
    eq(r.values, ['Desk Lamp']);
});

t('无表头且只有一列 → 直接取该列', () => {
    const r = extractNamesFromSpreadsheet(book([['杯子'], ['雨伞'], ['台灯']]));
    ok(r.ok, r.error);
    eq(r.values, ['杯子', '雨伞', '台灯']);
});

t('多列且认不出品名列 → 明确失败并给提示（不乱抽）', () => {
    const r = extractNamesFromSpreadsheet(book([
        ['code', 'qty', 'price'],
        ['A1', 3, 9.9],
    ]));
    eq(r.ok, false, '不该成功');
    ok(/商品名|品名/.test(r.error), '错误信息应指向品名列');
});

t('显式指定列序号', () => {
    const r = extractNamesFromSpreadsheet(book([['a', 'b'], ['x', '目标1'], ['y', '目标2']]), { column: 1 });
    ok(r.ok, r.error);
    eq(r.values, ['目标1', '目标2']);
});

t('显式指定列名', () => {
    const r = extractNamesFromSpreadsheet(book([['编号', '名字'], [1, '甲'], [2, '乙']]), { column: '名字' });
    ok(r.ok, r.error);
    eq(r.values, ['甲', '乙']);
});

t('空白/重复行被过滤', () => {
    const r = extractNamesFromSpreadsheet(book([['商品名'], ['A'], [''], ['  '], ['B']]));
    ok(r.ok, r.error);
    eq(r.values, ['A', 'B'], '空行应被剔除');
});

t('超上限截断并标记 truncated', () => {
    const rows = [['商品名']];
    for (let i = 0; i < 12; i++) rows.push([`商品${i}`]);
    const r = extractNamesFromSpreadsheet(book(rows), { maxItems: 5 });
    ok(r.ok, r.error);
    eq(r.values.length, 5);
    eq(r.truncated, true);
});

t('纯文本按行拆', () => {
    const r = extractNamesFromPlainText(Buffer.from('杯子\n雨伞\n\n台灯\n'));
    ok(r.ok, r.error);
    eq(r.values, ['杯子', '雨伞', '台灯']);
});

t('不支持的扩展名 → 明确失败', () => {
    const r = extractNamesFromFile({ buffer: Buffer.from('x'), name: 'a.pdf' });
    eq(r.ok, false);
    ok(/支持/.test(r.error));
});

t('按扩展名路由：xlsx 走表格解析', () => {
    const r = extractNamesFromFile({ buffer: book([['商品名'], ['A']]), name: 'list.xlsx' });
    ok(r.ok, r.error);
    eq(r.values, ['A']);
});

t('namesToSlotText 拼成多行 + 提示语', () => {
    const out = namesToSlotText(['A', 'B'], { truncated: true, reason: '按表头「商品名」识别' });
    eq(out.text, 'A\nB');
    ok(/2 项/.test(out.notice) && /截断/.test(out.notice) && /商品名/.test(out.notice));
});

t('空表格 → 明确失败', () => {
    const r = extractNamesFromSpreadsheet(book([]));
    eq(r.ok, false);
});

t('损坏的 .xlsx（伪装成 Excel 的文本）→ 明确报错而不是把二进制当品名', () => {
    const r = extractNamesFromFile({ buffer: Buffer.from('这不是表格'), name: 'a.xlsx' });
    eq(r.ok, false);
    ok(/损坏|有效/.test(r.error), '应提示文件损坏：' + r.error);
});

t('.csv 走文本解析（无需文件头校验）', () => {
    const r = extractNamesFromFile({ buffer: Buffer.from('商品名\n杯子\n雨伞\n'), name: 'list.csv' });
    ok(r.ok, r.error);
    eq(r.values, ['杯子', '雨伞']);
});

t('.csv 带多列表头 → 认出品名列', () => {
    const r = extractNamesFromFile({ buffer: Buffer.from('编号,商品名称,规格\n1,保温杯,A\n2,雨伞,B\n'), name: 'l.csv' });
    ok(r.ok, r.error);
    eq(r.values, ['保温杯', '雨伞']);
});

t('GBK 编码的 CSV（Windows Excel 另存）也能正确解码', () => {
    // '商品名\n保温杯\n雨伞\n' 的 GBK 字节
    const gbk = Buffer.from([0xc9, 0xcc, 0xc6, 0xb7, 0xc3, 0xfb, 0x0a, 0xb1, 0xa3, 0xce, 0xc2, 0xb1, 0xad, 0x0a, 0xd3, 0xea, 0xc9, 0xa1, 0x0a]);
    const r = extractNamesFromFile({ buffer: gbk, name: 'gbk.csv' });
    ok(r.ok, r.error);
    eq(r.values, ['保温杯', '雨伞'], 'GBK 应被正确解码');
});

t('decodeTextBuffer 直接解 GBK', () => {
    const gbk = Buffer.from([0xc9, 0xcc, 0xc6, 0xb7, 0xc3, 0xfb]);
    eq(decodeTextBuffer(gbk), '商品名');
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
