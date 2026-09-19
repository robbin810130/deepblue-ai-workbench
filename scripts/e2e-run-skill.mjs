/**
 * 端到端冒烟：直接经 providers/runSkill 走一遍真实 Dify 调用
 * 用法： node --env-file=.env scripts/e2e-run-skill.mjs
 */
import { runSkill } from '../server/modules/providers/index.js';

const cases = [
    ['rules_assistant', { inputs: { message: '一句话说明公司差旅报销的标准流程' } }],
    ['layout_compare', { inputs: {} }],
    ['quote_verify', { inputs: { supplier_name: '冒烟测试供应商' } }],
    ['business_dashboard', { inputs: { message: '生成一个简单的销售概览看板' } }],
];

for (const [k, input] of cases) {
    const t = Date.now();
    try {
        const r = await runSkill(k, { ...input, user: { id: 1, name: 'e2e' } });
        const txt = JSON.stringify(r?.data ?? r).slice(0, 200);
        console.log(`✅ ${k.padEnd(20)} ${String(Date.now() - t).padStart(6)}ms  ${txt}`);
    } catch (e) {
        console.log(`❌ ${k.padEnd(20)} ${String(Date.now() - t).padStart(6)}ms  code=${e.code} status=${e.http_status}  ${String(e.message).slice(0, 190)}`);
    }
}
