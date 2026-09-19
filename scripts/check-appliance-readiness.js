#!/usr/bin/env node
/**
 * appliance 一体化交付自检脚本（XO appliance 准备，2026-09-19）
 *
 * 用途：每台出厂设备 / 每次客户现场部署后运行，输出结构化就绪度报告。
 * 检查项：
 *   1. 运行时（Node 版本）
 *   2. 数据库连通 + 关键表齐全（含任务中心六表、通知新表、权限新表）
 *   3. AI 绑定配置体检（checkAllBindings：env 完整性，不泄露密钥）
 *   4. 试点开关清单（TASK_CENTER_PILOT）
 *   5. 日志目录可写
 *
 * 用法：node scripts/check-appliance-readiness.js [--json]
 * 退出码：0=就绪，1=有阻塞项（BLOCK），2=有警告（WARN 不阻塞）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const asJson = args.includes('--json');

const report = { time: new Date().toISOString(), blocks: [], warns: [], oks: [], info: {} };
const block = (item, detail) => report.blocks.push({ item, detail });
const warn = (item, detail) => report.warns.push({ item, detail });
const ok = (item, detail) => report.oks.push({ item, detail });

// ── 1. 运行时 ──
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor >= 20) ok('node 版本', `v${process.versions.node}（>=20）`);
else block('node 版本', `v${process.versions.node}，需要 >=20`);

// ── 2. 数据库 ──
let pool = null;
try {
    const { default: pg } = await import('../server/db.js');
    pool = pg;
    const { rows } = await pool.query('SELECT version() AS v');
    ok('数据库连通', String(rows[0].v).split(',').slice(0, 2).join(','));

    // 关键表清单（架构演进后新增表必须在此登记）
    const REQUIRED_TABLES = [
        // 平台基础
        'sys_users', 'sys_roles', 'sys_user_sessions', 'sys_audit_logs',
        // 任务中心
        'tasks', 'task_runs', 'task_events', 'task_artifacts', 'task_staged_files', 'task_notifications',
        // XO-07 整合后新表
        'skill_permissions',
        // 业务核心
        'product_entry_history',
        'sys_product_selection_conversations', 'sys_product_selection_messages',
    ];
    // 惰性建表的文件暂存表：自检时主动触发 ensure（与首次上传行为一致）
    const { ensureFilesTables } = await import('../server/modules/files/fileStore.js');
    await ensureFilesTables().catch(() => {});
    const { rows: tbls } = await pool.query(
        `SELECT tablename FROM pg_tables WHERE schemaname='public'`);
    const existing = new Set(tbls.map((r) => r.tablename));
    const missing = REQUIRED_TABLES.filter((t) => !existing.has(t));
    if (missing.length === 0) {
        ok('关键表齐全', `${REQUIRED_TABLES.length} 张必需表全部存在（库内共 ${existing.size} 张）`);
    } else {
        block('关键表缺失', missing.join(', ') + '（启动服务可自动补建：runInitDDL 幂等）');
    }
    report.info.table_count = existing.size;
} catch (e) {
    block('数据库连通', e.message);
}

// ── 3. AI 绑定体检 ──
try {
    const { checkAllBindings } = await import('../server/modules/providers/bindings.js');
    const r = checkAllBindings(process.env);
    report.info.bindings = { total: r.total, ready: r.ready, not_ready: r.not_ready, inactive: r.disabled };
    const activeNotReady = r.items.filter((i) => i.status === 'active' && !i.ready);
    if (activeNotReady.length === 0) {
        ok('AI 绑定配置', `${r.total} 个绑定全部就绪（inactive 存档 ${r.disabled} 个不计）`);
    } else {
        warn('AI 绑定缺配置', activeNotReady.map((i) => `${i.binding_key}(缺 ${i.missing.join('/')})`).join('; ')
            + ' —— 对应应用会以「未配置」提示降级，不影响其他功能');
    }
} catch (e) {
    block('AI 绑定体检', e.message);
}

// ── 4. 试点开关 ──
const pilot = (process.env.TASK_CENTER_PILOT || '').split(',').map((s) => s.trim()).filter(Boolean);
report.info.pilot_skills = pilot;
if (pilot.length > 0) ok('任务中心试点开关', `${pilot.length} 个技能纳入闭环`);
else warn('任务中心试点开关', 'TASK_CENTER_PILOT 为空 —— 所有存量路由走旧直连路径');

// ── 5. 日志目录 ──
const logDir = path.join(ROOT, 'logs');
try {
    fs.mkdirSync(logDir, { recursive: true });
    fs.accessSync(logDir, fs.constants.W_OK);
    ok('日志目录可写', logDir);
} catch (e) {
    block('日志目录', `${logDir}: ${e.message}`);
}

// ── 汇总 ──
report.ready = report.blocks.length === 0;
report.summary = `就绪=${report.ready} 阻塞=${report.blocks.length} 警告=${report.warns.length} 通过=${report.oks.length}`;

if (asJson) {
    console.log(JSON.stringify(report, null, 2));
} else {
    console.log('════════ appliance 交付自检报告 ════════');
    console.log(`时间: ${report.time}`);
    for (const { item, detail } of report.oks) console.log(`  ✅ ${item}: ${detail}`);
    for (const { item, detail } of report.warns) console.log(`  ⚠️  ${item}: ${detail}`);
    for (const { item, detail } of report.blocks) console.log(`  ❌ ${item}: ${detail}`);
    console.log(`────────────────────────────`);
    console.log(`结论: ${report.summary}`);
}

process.exitCode = report.ready ? (report.warns.length ? 2 : 0) : 1;
// 断开连接（pool 惰性创建时才有）
if (pool) await pool.end().catch(() => {});
