/**
 * resultCard —— 执行结果 → 对话消息卡片（对话式改造 P1）
 *
 * 职责：把任务执行结果（taskService 的归一化输出）翻译成
 *      ① 一段可读的 Markdown 正文（消息流里直接看）
 *      ② 一份结构化 card 数据（前端渲染成卡片：状态徽标 / 字段表 / 任务跳转）
 *
 * 结果形态（来自 normalizeWorkflowResult）：
 *   { status, summary, data: {...}, artifacts: [], warnings: [], metrics: {} }
 */

/** 长文本字段优先作为正文（按优先级） */
const PRIMARY_TEXT_KEYS = ['answer', 'result', 'text', 'content', 'summary', 'output', 'markdown', 'report'];

/** 这些字段已进正文或属于元信息，不再重复进字段表 */
const SKIP_KEYS = new Set([
    'answer', 'result', 'text', 'content', 'output', 'markdown', 'report',
    '_extra', 'conversation_id', 'message_id', 'id',
]);

const MAX_PRIMARY_CHARS = 12000;

function isScalar(v) {
    return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

/** 值 → 可读字符串（截断超长内容） */
function asText(v, max = 300) {
    if (v === null || v === undefined) return '';
    if (Array.isArray(v)) return v.map((x) => (isScalar(x) ? String(x) : JSON.stringify(x))).join('、');
    if (typeof v === 'object') {
        try {
            return JSON.stringify(v);
        } catch {
            return String(v);
        }
    }
    const s = String(v);
    return s.length > max ? `${s.slice(0, max)}…` : s;
}

function pickPrimary(data) {
    if (!data || typeof data !== 'object') return { key: null, text: '' };
    for (const k of PRIMARY_TEXT_KEYS) {
        const v = data[k];
        if (typeof v === 'string' && v.trim().length > 0) return { key: k, text: v.trim().slice(0, MAX_PRIMARY_CHARS) };
        if (v && typeof v === 'object' && typeof v.markdown === 'string') return { key: k, text: v.markdown };
    }
    return { key: null, text: '' };
}

/** 平台内部字段映射提示 —— 对用户无意义，展示错误时要过滤掉 */
const INTERNAL_NOISE = /不在 output_schema|已收进 _extra/;

/**
 * 从 Provider 的错误串里挑出**用户看得懂的那句**。
 * taskService 失败时会把 warnings 全部拼进 error_message，其中第一条常常是
 * 「以下字段不在 output_schema 中…」这类内部提示，真正的原因在后面。
 */
function pickErrorText(raw) {
    const parts = String(raw || '')
        .split(/；|;/)
        .map((s) => s.trim())
        .filter(Boolean);
    if (parts.length === 0) return '执行失败，未返回错误详情';
    const biz = parts.filter((p) => !INTERNAL_NOISE.test(p));
    return (biz.length ? biz : parts).join('；');
}

/**
 * @param {object} task 任务行（含 id / task_no / status / result / summary / error_message）
 * @param {object} [opts]
 * @param {string} [opts.skillName]
 * @returns {{content:string, card:object}}
 */
export function buildResultCard(task, opts = {}) {
    const status = task?.status || 'unknown';
    const data = task?.result && typeof task.result === 'object' ? task.result : {};
    const failed = ['failed', 'cancelled'].includes(status);

    // 失败：正文就是错误信息 + 可重试提示
    if (failed) {
        const msg = pickErrorText(task?.error_message);
        return {
            content: [`**执行未成功**（${status === 'cancelled' ? '已取消' : '失败'}）`, '', `> ${msg}`, '', '可以补充或修改参数后重新执行。'].join('\n'),
            card: {
                kind: 'result',
                task_id: task?.id ?? null,
                task_no: task?.task_no ?? null,
                status,
                summary: null,
                fields: [],
                warnings: [],
                can_retry: true,
                skill_name: opts.skillName || null,
            },
        };
    }

    const { text: primary, key: primaryKey } = pickPrimary(data);
    const fields = [];
    for (const [k, v] of Object.entries(data)) {
        if (primaryKey === k || SKIP_KEYS.has(k)) continue;
        if (v === null || v === undefined || String(v).trim() === '') continue;
        if (Array.isArray(v) && v.length === 0) continue;
        fields.push({ key: k, value: Array.isArray(v) || typeof v === 'object' ? v : asText(v) });
    }

    const parts = [];
    if (primary) {
        parts.push(primary);
    } else if (task?.summary) {
        parts.push(task.summary);
    }

    // 标量字段补一张小表（长文本字段单独处理）
    const scalarFields = fields.filter((f) => isScalar(f.value) && String(f.value).length <= 120);
    const richFields = fields.filter((f) => !scalarFields.includes(f));
    if (scalarFields.length > 0) {
        parts.push('');
        parts.push('| 字段 | 结果 |');
        parts.push('| --- | --- |');
        for (const f of scalarFields) parts.push(`| ${f.key} | ${String(f.value).replace(/\|/g, '\\|')} |`);
    }
    for (const f of richFields) {
        parts.push('');
        parts.push(`**${f.key}**`);
        parts.push('');
        if (Array.isArray(f.value) && f.value.every(isScalar)) {
            f.value.forEach((x) => parts.push(`- ${x}`));
        } else {
            parts.push('```json');
            parts.push(asText(f.value, 2000));
            parts.push('```');
        }
    }

    if (!primary && parts.length === 0) {
        parts.push('执行已完成，但工作流没有返回可展示的内容。');
    }

    const warnings = Array.isArray(task?.result?.warnings) ? task.result.warnings : [];
    return {
        content: parts.join('\n').trim(),
        card: {
            kind: 'result',
            task_id: task?.id ?? null,
            task_no: task?.task_no ?? null,
            status,
            summary: task?.summary ?? null,
            fields,
            warnings,
            can_retry: false,
            skill_name: opts.skillName || null,
        },
    };
}

/** 参数收集状态 → 前端卡片数据（进度 / 缺失清单） */
export function buildSlotCard({ plan, inputs, status, askKeys = [], files = {} }) {
    return {
        kind: 'slot',
        skill_key: plan.skill_key,
        skill_name: plan.skill_name,
        filled: plan.slots
            .filter((s) => inputs[s.key] !== undefined && inputs[s.key] !== null && String(inputs[s.key]).trim() !== '')
            .map((s) => ({ key: s.key, title: s.title, value: inputs[s.key], is_file: s.isFile })),
        missing: status.requiredMissing.map((s) => ({
            key: s.key,
            title: s.title,
            description: s.description,
            type: s.type,
            enum: s.enum,
            is_file: s.isFile,
        })),
        optional_missing: status.missing.filter((s) => !s.required).map((s) => ({ key: s.key, title: s.title, type: s.type, enum: s.enum })),
        ask_keys: askKeys,
        files,
        all_slots: plan.slots.map((s) => ({
            key: s.key,
            title: s.title,
            description: s.description,
            type: s.type,
            enum: s.enum,
            required: s.required,
            is_file: s.isFile,
        })),
        ready: status.ready,
        filled_count: status.filledCount,
        total_count: status.totalCount,
    };
}
