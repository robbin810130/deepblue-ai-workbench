/**
 * 深蓝工作台 /api/v1 真库冒烟 —— PostgreSQL 真实容器版
 *
 * 前置：
 *   docker run -d --name dwb-smoke-pg -e POSTGRES_PASSWORD=smoke123 \
 *     -e POSTGRES_DB=blueos -p 5598:5432 postgres:16-alpine
 *   DATABASE_URL=postgresql://postgres:smoke123@127.0.0.1:5598/blueos \
 *     SERVER_PORT=3901 node server/server.js   （后台）
 *
 * 运行：node tests/smoke-v1.mjs
 * 退出码：0 = 全部通过；1 = 存在失败项
 *
 * 说明：
 *   - JWT 直接本地签发（authenticateToken 对无 jti 的 token 纯校验），不依赖 sys_users。
 *   - contract_review 绑定需要 DIFY_CONTRACT_AUDIT_API_URL/KEY，冒烟环境不设 →
 *     执行必现 BINDING_INCOMPLETE，用于验证失败链路（事件/通知/重试）。
 *   - waiting_confirmation 等中间态用 SQL 造数（模拟 provider 成功路径），
 *     然后走 confirm/reject/archive 等状态机操作。
 */

import jwt from 'jsonwebtoken';
import pg from 'pg';

const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:3901';
const PG_URL = process.env.SMOKE_PG || 'postgresql://postgres:smoke123@127.0.0.1:5598/blueos';
const SECRET = process.env.JWT_SECRET || 'blue-os-super-secret-key';

const ADMIN = { id: 9001, username: 'smoke_admin', role: 'admin' };
const ALICE = { id: 9002, username: 'smoke_alice', role: 'user' };
const tokenOf = (u) => jwt.sign(u, SECRET, { expiresIn: '1h' });
const ADMIN_TOKEN = tokenOf(ADMIN);
const ALICE_TOKEN = tokenOf(ALICE);

const results = [];
function check(name, ok, note = '') {
    results.push({ name, ok });
    console.log(`${ok ? '✅' : '❌'} ${name}${note ? ` —— ${note}` : ''}`);
}

/** 统一请求：默认带 alice token；期望非 2xx 时抛出（由调用方 try/catch 断言错误） */
async function api(method, path, { token = ALICE_TOKEN, body, raw, headers = {} } = {}) {
    const h = { authorization: `Bearer ${token}`, ...headers };
    if (body !== undefined && !(body instanceof FormData)) h['content-type'] = 'application/json';
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers: h,
        body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (raw) return res;
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* 非 JSON */ }
    return { status: res.status, json, text };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer() {
    for (let i = 0; i < 40; i++) {
        try {
            const r = await fetch(`${BASE}/api/health`);
            if (r.ok) return true;
        } catch { /* not yet */ }
        await sleep(500);
    }
    return false;
}

async function waitForTerminal(taskId, timeoutMs = 30000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        const { json } = await api('GET', `/api/v1/tasks/${taskId}`);
        const st = json?.data?.task?.status;
        if (['succeeded', 'failed', 'cancelled', 'waiting_confirmation'].includes(st)) return st;
        await sleep(500);
    }
    return 'timeout';
}

async function main() {
    console.log('\n========== /api/v1 真库冒烟（Docker PG）==========\n');
    const pool = new pg.Pool({ connectionString: PG_URL });

    // ── A. 目录与权限 ─────────────────────────────────────────
    {
        const { json } = await api('GET', '/api/v1/health/skills', { token: ADMIN_TOKEN });
        check('1. 健康检查：注册表非空且校验零错误',
            json?.success && json.data.registry.total >= 34 && json.data.validation.errors === 0,
            `技能 ${json?.data?.registry?.total}，错误 ${json?.data?.validation?.errors}`);
    }
    {
        const { json } = await api('GET', '/api/v1/scenes?business_only=true');
        check('2. 场景清单 ≥ 6 个业务场景', json?.success && json.data.length >= 6, `${json?.data?.length} 个`);
    }
    {
        const { json } = await api('GET', '/api/v1/skills/contract_review', { token: ADMIN_TOKEN });
        check('3. admin 技能权限 granted',
            json?.success && json.data.permission_status === 'granted',
            json?.data?.permission_status);
    }
    {
        const { status, json } = await api('POST', '/api/v1/skills/contract_review/prepare', { body: { inputs: {} } });
        check('4. prepare 缺输入被拦（VALIDATION_FAILED）',
            status === 422 && json?.error?.code === 'VALIDATION_FAILED', json?.error?.code);
    }
    {
        const { json } = await api('POST', '/api/v1/skills/contract_review/prepare', { body: { inputs: { file: 'x.pdf' } } });
        check('5. prepare 齐输入放行并给预览', json?.success && json.data.preview != null, '');
    }

    // ── B. 文件管线 ───────────────────────────────────────────
    let fileId = '';
    const fileBytes = Buffer.from('深蓝冒烟测试合同内容 V1');
    {
        const fd = new FormData();
        fd.append('file', new Blob([fileBytes], { type: 'application/msword' }), '冒烟合同.docx');
        const { json } = await api('POST', '/api/v1/files/upload', { body: fd });
        fileId = json?.data?.file_id || '';
        check('6. 上传暂存成功（中文文件名修正）',
            Boolean(fileId) && json?.data?.name === '冒烟合同.docx', json?.data?.name);
    }
    {
        const { json } = await api('GET', `/api/v1/files/staged/${fileId}`);
        check('7. 暂存文件元信息可查', json?.success && Number(json.data.size_bytes) === fileBytes.length, `${json?.data?.size_bytes}B`);
    }
    let signedUrl = '';
    {
        const { json } = await api('GET', `/api/v1/files/staged/${fileId}/download-url`);
        signedUrl = json?.data?.url || '';
        check('8. 签发短时下载 URL（HMAC）', signedUrl.includes('sig=') && signedUrl.includes('exp='),
            `${json?.data?.expires_in_seconds}s`);
    }
    {
        // 无 JWT、仅签名 —— 签名即凭证
        const res = await fetch(`${BASE}${signedUrl}`);
        const buf = Buffer.from(await res.arrayBuffer());
        check('9. 无 JWT 签名下载成功且内容一致',
            res.status === 200 && buf.equals(fileBytes), `${res.status}，${buf.length}B`);
    }
    {
        const res = await fetch(`${BASE}${signedUrl.replace(/sig=./, 'sig=T')}`);
        check('10. 篡改签名 → 403', res.status === 403, String(res.status));
    }
    {
        const res = await fetch(`${BASE}/api/v1/files/download?kind=staged&id=${fileId}`);
        check('11. 缺签名参数 → 403', res.status === 403, String(res.status));
    }

    // ── C. 执行失败链路（BINDING_INCOMPLETE）────────────────
    let tFail = '';
    {
        const { json } = await api('POST', '/api/v1/tasks', {
            body: {
                skill_key: 'contract_review',
                title: '冒烟-失败链路',
                inputs: { file: fileId },
                files: [fileId],
                execute_now: true,
            },
        });
        tFail = json?.data?.id || '';
        // blocking 技能可能同步跑完（返回时已 failed），也可能仍在流转 —— 有合法 id 即可
        check('12. 创建即执行（execute_now）任务落库', Boolean(tFail), json?.data?.status);
    }
    {
        const st = await waitForTerminal(tFail);
        const { json } = await api('GET', `/api/v1/tasks/${tFail}`);
        const events = json?.data?.events || [];
        const lastRun = json?.data?.runs?.at(-1);
        check('13. 执行到终态 failed（绑定缺失 BINDING_INCOMPLETE）',
            st === 'failed' && lastRun?.error?.code === 'BINDING_INCOMPLETE', `终态=${st}`);
        check('14. 事件时间线记录失败事件',
            events.some((e) => e.event_type === 'task_failed'), `共${events.length}条事件`);
    }
    {
        const { json } = await api('GET', '/api/v1/notifications?unread_only=true');
        const hit = (json?.data || []).find((n) => n.type === 'task_failed' && n.task_id === tFail);
        check('15. 失败通知生成且未读', Boolean(hit), hit?.type);
    }
    {
        const { json } = await api('POST', `/api/v1/tasks/${tFail}/retry`, { body: {} });
        const runNo = json?.data?.run_no ?? json?.data?.run_count;
        check('16. 重试产生新 Run（旧 Run 保留）', json?.success && Number(runNo) >= 2, `run_no=${runNo}`);
        await waitForTerminal(tFail, 15000);
    }

    // ── D. 确认 / 驳回 / 归档 / 取消 / rerun ─────────────────
    const SQL_WAITING = `UPDATE tasks SET status='waiting_confirmation', updated_at=NOW() WHERE id=$1`;
    let tConfirm = '';
    {
        const { json } = await api('POST', '/api/v1/tasks', {
            body: { skill_key: 'contract_review', title: '冒烟-人工确认', inputs: { file: fileId }, files: [fileId] },
        });
        tConfirm = json?.data?.id || '';
        await pool.query(SQL_WAITING, [tConfirm]);
        await pool.query(
            `INSERT INTO task_events (task_id, event_type) VALUES ($1,'confirmation_requested')`,
            [tConfirm],
        );
        const { json: cj } = await api('POST', `/api/v1/tasks/${tConfirm}/confirm`, { body: {} });
        check('17. waiting_confirmation → confirm → succeeded', cj?.data?.status === 'succeeded', cj?.data?.status);
    }
    {
        // rerun 须在 succeeded 态做（archived 只允许 view）—— 克隆出的新任务不执行
        const { json } = await api('POST', `/api/v1/tasks/${tConfirm}/rerun`, { body: {} });
        const clone = json?.data;
        check('18. rerun 克隆为新任务（同技能同输入）',
            Boolean(clone?.id) && clone.id !== tConfirm && clone.skill_key === 'contract_review',
            clone?.task_no);
        await api('DELETE', `/api/v1/tasks/${clone.id}`, { body: {} }); // 清理草稿克隆
    }
    {
        const { json } = await api('POST', `/api/v1/tasks/${tConfirm}/archive`, { body: {} });
        check('19. succeeded → archive → archived', json?.data?.status === 'archived', json?.data?.status);
    }
    {
        const { json: made } = await api('POST', '/api/v1/tasks', {
            body: { skill_key: 'contract_review', title: '冒烟-驳回', inputs: { file: fileId }, files: [fileId] },
        });
        const tReject = made?.data?.id;
        await pool.query(SQL_WAITING, [tReject]);
        const noReason = await api('POST', `/api/v1/tasks/${tReject}/reject`, { body: {} });
        const withReason = await api('POST', `/api/v1/tasks/${tReject}/reject`, { body: { reason: '结果不可用' } });
        check('20. 驳回无原因被拦 / 带原因 → cancelled',
            noReason.status === 422 && withReason.json?.data?.status === 'cancelled',
            `${noReason.status}/${withReason.json?.data?.status}`);
    }
    {
        const { json: made } = await api('POST', '/api/v1/tasks', {
            body: { skill_key: 'contract_review', title: '冒烟-取消', inputs: { file: fileId }, files: [fileId] },
        });
        const tCancel = made?.data?.id;
        // blocking 技能 execute_now 会同步跑完进 failed（failed 不允许 cancel），故 SQL 造 queued 态
        await pool.query(`UPDATE tasks SET status='queued', updated_at=NOW() WHERE id=$1`, [tCancel]);
        const { json } = await api('POST', `/api/v1/tasks/${tCancel}/cancel`, { body: { reason: '不再需要' } });
        check('21. queued 任务取消 → cancelled', json?.data?.status === 'cancelled', json?.data?.status);
    }

    // ── E. 权限 / 指标 / 通知闭环 ─────────────────────────────
    let tAdmin = '';
    {
        const { json } = await api('POST', '/api/v1/tasks', {
            token: ADMIN_TOKEN,
            body: { skill_key: 'contract_review', title: '冒烟-admin私有任务', inputs: { file: fileId }, files: [fileId] },
        });
        tAdmin = json?.data?.id || '';
        const { status, json: rj } = await api('GET', `/api/v1/tasks/${tAdmin}`);
        check('22. 越权访问他人任务 → 403', status === 403 && rj?.error?.code === 'FORBIDDEN', `${status}`);
    }
    {
        const { json } = await api('GET', '/api/v1/tasks/metrics', { token: ADMIN_TOKEN });
        check('23. 任务指标可算（admin 全量视角）',
            json?.success && json.data.created >= 5 && json.data.by_status != null,
            `created=${json?.data?.created}`);
    }
    {
        await api('POST', '/api/v1/notifications/read-all', {});
        const { json } = await api('GET', '/api/v1/notifications/unread-count');
        check('24. 全部已读后未读数归零', json?.data?.unread === 0, `unread=${json?.data?.unread}`);
    }

    await pool.end();

    // ── 汇总 ─────────────────────────────────────────────────
    const failed = results.filter((r) => !r.ok);
    console.log(`\n========== 冒烟汇总：${results.length - failed.length}/${results.length} 通过 ==========\n`);
    if (failed.length) {
        console.log('失败项：');
        failed.forEach((f) => console.log(`  ❌ ${f.name}`));
        process.exit(1);
    }
}

main().catch((e) => {
    console.error('冒烟脚本异常终止：', e);
    process.exit(1);
});
