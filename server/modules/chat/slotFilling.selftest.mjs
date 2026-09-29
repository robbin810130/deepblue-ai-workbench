/**
 * slotFilling 自测 —— 零依赖，直接运行：
 *
 *   cd deepblue-workbench && node server/modules/chat/slotFilling.selftest.mjs
 *
 * 为什么要有这个文件：参数提取是「对话式填表」的命门 —— 填错业务参数的代价
 * 远大于多问一句。规则提取器改动频繁（口语蒸馏、护栏词表），必须有回归网兜住。
 */

import { buildSlotPlan, slotStatus, extractSlots, mergeInputs, composeOpening, composeAsk, composeSummary } from './slotFilling.js';
import { getSkill } from '../catalog/index.js';

let pass = 0;
let fail = 0;
const t = (name, cond, extra = '') => {
    if (cond) {
        pass++;
        console.log(`  ✓ ${name}`);
    } else {
        fail++;
        console.log(`  ✗ ${name}  ${extra}`);
    }
};

const planOf = (k) => buildSlotPlan(getSkill(k));
const X = (skillKey, text, inputs = {}, lastAsk = []) =>
    extractSlots({ plan: planOf(skillKey), inputs, text, lastAsk }).patch;

console.log('── 显式与枚举');
t('显式键值（客户名称是X）', X('customer_analysis', '客户名称是上海鑫达贸易').customer_name === '上海鑫达贸易');
t('枚举「按季度」→ quarter', X('marketing_forecast', '我要按季度看').period === 'quarter');
t('枚举「月度」→ month', X('marketing_forecast', '先来个月度预测').period === 'month');
// 「选品工作流」的真实枚举（2026-09-20 P1-4 对齐后）：supply_mode[全部/代发/集采]、rerank_level[高/低]
t('枚举「代发」→ supply_mode=代发', X('product_library', '只要代发的').supply_mode === '代发');
t('枚举「相似度按低的来」→ rerank_level=低', X('product_library', '相似度按低的来').rerank_level === '低');

// 固件用例：不依赖任何真实技能 schema —— 以后改技能清单也不会把「引擎能力覆盖」一起改没
const FIXTURE_PLAN = buildSlotPlan({
    skill_key: '_fixture',
    name: '固件',
    input_schema: {
        type: 'object',
        properties: {
            action: { type: 'string', enum: ['import', 'tag', 'search'] },
            region: { type: 'string', enum: ['华东', '华南'] },
        },
        required: [],
    },
});
const XF = (text) => extractSlots({ plan: FIXTURE_PLAN, inputs: {}, text, lastAsk: [] }).patch;
t('固件·枚举同义词「导入」→ import', XF('我要导入一批数据').action === 'import');
t('固件·枚举同义词「搜索」→ search', XF('搜索一下').action === 'search');
t('固件·枚举字面值「华东」→ 华东', XF('只看华东的').region === '华东');

console.log('── 多参数与顺序对齐');
{
    const r = X('tender_search', '检索关键词是充电桩，地区广东，从2026-01-01开始');
    t('一句话多参数', r.keyword === '充电桩' && r.region === '广东' && r.date_from === '2026-01-01', JSON.stringify(r));
}
t('顺序分配（重述全长）', X('tender_search', '充电桩、广东', { keyword: 'x' }, ['keyword', 'region']).region === '广东');
t('顺序分配（只答未填）', X('tender_search', '充电桩设备', { region: '广东' }, ['keyword', 'region']).keyword === '充电桩设备');

console.log('── 类型化槽位');
t('数字槽位（重量 12.5）', X('logistics_fee', '目的地是德国汉堡，重量 12.5').weight === 12.5);
t('数组槽位（顿号分隔）', (X('product_selection', '目标渠道是 Amazon、TikTok、Temu').channels || []).length === 3);

console.log('── 口语蒸馏（用户说的是句子，不是字段值）');
t('「帮我找一下X的招标信息」→ X', X('tender_search', '帮我找一下充电桩的招标信息，地区广东', {}, ['keyword']).keyword === '充电桩');
t('蒸馏不影响同句其他参数', X('tender_search', '帮我找一下充电桩的招标信息，地区广东', {}, ['keyword']).region === '广东');
t('「帮我查一下X的客户资料」→ X', X('customer_analysis', '帮我查一下上海鑫达贸易的客户资料', {}, ['customer_name']).customer_name === '上海鑫达贸易');
t('前导寒暄剥离', X('customer_analysis', '你好，帮我查上海鑫达贸易').customer_name === '上海鑫达贸易');

console.log('── 护栏（宁可多问一句，也不填错）');
t('纯寒暄不填关键词', X('tender_search', '你好', {}, ['keyword']).keyword === undefined);
t('「在吗」不填', X('tender_search', '在吗', {}, ['keyword']).keyword === undefined);
t('闲聊不误填（地区情况）', X('tender_search', '我想了解地区情况').region === undefined);
t('多空槽不瞎猜', X('tender_search', '随便看看').keyword === undefined);
t('已填值不被覆盖', X('customer_analysis', '你好', { customer_name: '已有值' }).customer_name === undefined);

console.log('── 兜底与进度');
t('单自由文本槽整句兜底', X('customer_analysis', '上海鑫达贸易').customer_name === '上海鑫达贸易');
{
    const p = planOf('tender_search');
    t('必填齐 → ready', slotStatus(p, { keyword: 'x' }).ready === true);
    t('必填缺 → 进度正确', slotStatus(p, {}).requiredMissing.length === 1);
    const ask = composeAsk({ plan: p, inputs: {}, hits: [] });
    t('追问列出缺失项', ask.content.includes('检索关键词') && ask.lastAsk.join() === 'keyword');
    t('开场白列出必填项（含文件提示）', composeOpening(planOf('invoice_verify')).content.includes('发票文件'));
    t('确认卡片是 markdown 表格', composeSummary({ plan: p, inputs: { keyword: '充电桩', region: '广东' } }).includes('| 参数 | 值 |'));
}

console.log('── 合并语义');
t('mergeInputs 只覆盖给出的键', JSON.stringify(mergeInputs({ a: 1, b: 2 }, { b: 3 })) === '{"a":1,"b":3}');

console.log('');
console.log(`结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
