/**
 * slotFilling —— workflow 类技能的「对话式参数收集」引擎（对话式改造 P1）
 *
 * 背景：技能页让用户填表单再提交的交互被裁决为不可接受。workflow 类技能
 *       （endpoint_kind='workflow'）不能像 chatflow 那样直接开聊，但可以
 *       **把 input_schema 当作待填槽位清单**，让用户在对话里自然地把参数说清楚。
 *
 * 职责边界（本文件只做纯逻辑，不碰数据库、不碰 HTTP）：
 *   buildSlotPlan      技能 input_schema → 槽位计划（含文件槽/枚举/必填标记）
 *   slotStatus         当前进度（已填 / 缺失 / 是否可执行）
 *   extractSlots       一句话 → 参数（规则提取，零外部依赖）
 *   composeOpening     进入技能时的引导语
 *   composeAsk         追问缺哪些参数
 *   composeSummary     参数齐了之后的确认卡片
 *
 * 🔴 设计铁律：
 *   1. **绝不猜测业务参数**。多个自由文本槽位同时缺失时不瞎分配，
 *      宁可多问一轮 —— 填错参数比多问一句代价大得多。
 *   2. 提取结果一律标注来源（extractor），不静默降级。
 *   3. 参数校验只做格式层（枚举/数字/日期），不做业务判断。
 */

/** 文件类槽位判定：format=binary 或 type=file 或 key 形如 file/files */
export function isFileSlot(key, def = {}) {
    return def.format === 'binary' || def.type === 'file' || /^files?$/i.test(key);
}

/**
 * 技能 → 槽位计划。
 * @param {object} skill catalog 技能定义
 * @returns {{skill_key:string, skill_name:string, slots:Array, requiredKeys:string[]}}
 */
export function buildSlotPlan(skill) {
    const schema = skill?.input_schema || {};
    const props = schema.properties || {};
    const required = Array.isArray(schema.required) ? schema.required : [];
    const slots = Object.entries(props).map(([key, def = {}]) => ({
        key,
        title: def.title || key,
        description: def.description || '',
        type: def.type || 'string',
        enum: Array.isArray(def.enum) ? def.enum : null,
        format: def.format || null,
        defaultValue: def.default,
        required: required.includes(key),
        isFile: isFileSlot(key, def),
    }));
    return {
        skill_key: skill?.skill_key || null,
        skill_name: skill?.name || '技能',
        summary: skill?.summary || '',
        slots,
        requiredKeys: slots.filter((s) => s.required).map((s) => s.key),
    };
}

/** 槽位当前进度 */
export function slotStatus(plan, inputs = {}) {
    const filled = [];
    const missing = [];
    for (const s of plan.slots) {
        const v = inputs[s.key];
        const has = v !== undefined && v !== null && String(v).trim() !== '';
        if (has) filled.push(s);
        else missing.push(s);
    }
    const requiredMissing = missing.filter((s) => s.required);
    return {
        filled,
        missing,
        requiredMissing,
        ready: requiredMissing.length === 0,
        filledCount: filled.length,
        totalCount: plan.slots.length,
    };
}

// ─────────────────────────────────────────────────────────────
// 规则提取
// ─────────────────────────────────────────────────────────────

/** 枚举值 → 中文同义表达（通用词表，覆盖常见动作/周期/布尔枚举） */
const ENUM_SYNONYMS = {
    month: ['月度', '按月', '本月', '当月', '这个月', '月度预测'],
    quarter: ['季度', '按季', '本季', '这个季度'],
    import: ['导入', '录入', '入库', '新增数据', '上传数据'],
    tag: ['打标', '标签', '标记', '分类'],
    search: ['检索', '搜索', '查询', '查找', '找一下'],
    export: ['导出', '下载', '生成文件'],
    create: ['新增', '新建', '创建', '添加'],
    update: ['更新', '修改', '编辑', '变更'],
    delete: ['删除', '移除', '下架'],
    yes: ['是', '对', '需要', '要', '确认'],
    no: ['否', '不是', '不需要', '不用'],
};

/** 常见礼貌/语气前缀 + 祈使动词，作单槽位兜底时剔除 */
const POLITE_PREFIX =
    /^(?:请|麻烦|帮我|帮忙|我想|我要|需要|给我|能不能|可以|麻烦你)?\s*(?:找|查|搜|检索|查询|搜索|看看|看|分析|处理|执行|生成|做|来|跑)?\s*(?:一下|一个|个|些)?\s*/;

/** 尾部「业务名词」——「X的招标信息」里的 X 才是用户真正想说的 */
const TAIL_NOUNS = ['信息', '数据', '资料', '文件', '清单', '列表', '报告', '情况', '内容', '结果', '记录', '文档', '分析', '报表', '明细', '汇总'];

/** 纯寒暄，不携带任何参数信息 */
const GREETING_ONLY = /^(?:你好|您好|hi|hello|嗨|在吗|在不在|有人吗|谢谢|多谢|好的|ok|嗯|测试|test|喂)[！!。.~～\s]*$/i;

/**
 * 口语蒸馏 —— 把「帮我找一下充电桩的招标信息」还原成「充电桩」。
 * 只用于**兜底**路径（用户没明说参数名，整句即答案的场景），
 * 显式键值对（「关键词是X」）不做蒸馏，用户说的就是值。
 */
function distillFreeText(text) {
    let s = String(text || '').trim();
    // 「你好，帮我查…」—— 前导寒暄先剥掉（整句纯寒暄的情况已在入口拦掉）
    s = s.replace(/^(?:你好|您好|hi|hello|嗨|喂|早上好|下午好|晚上好)[，,。.！!~～\s]*/i, '');
    s = cleanup(s.replace(POLITE_PREFIX, ''));
    if (!s) return '';
    // 「<核心>的<业务名词>」→ 取核心（「充电桩的招标信息」→「充电桩」）
    const m = s.match(/^(.{2,40}?)的([^的]{1,10})$/);
    if (m && TAIL_NOUNS.some((n) => m[2].includes(n))) s = m[1];
    s = s.replace(/^(?:关于|有关|针对|围绕)\s*/, '').replace(/(?:相关|方面|这块|那块)$/, '');
    return cleanup(s);
}

/**
 * 「直接跟随」模式的值护栏 —— 中文里常省略连接词（「地区广东」「重量 12.5」），
 * 但放宽后极易把闲聊当成参数值。以下片段一律不认：
 *   · 疑问/泛指词（「情况」「什么」「相关」…）
 *   · 以结构助词开头或结尾（「的客户」「大的」）
 *   · 以问号/感叹号结尾
 * 宁可多问一轮 —— 填错业务参数比多问一句代价大得多。
 */
const VALUE_STOPWORDS = new Set([
    '情况', '什么', '怎么', '如何', '哪些', '多少', '相关', '方面', '内容', '信息',
    '一下', '一点', '问题', '东西', '时候', '地方', '的吗', '吗', '呢', '吧', '了', '的',
]);
const VALUE_BAD_EDGE = /^[的地得]|[的地得]$|[？?！!]$/;

function acceptableDirectValue(v) {
    const s = cleanup(v);
    if (!s) return null;
    if (s.length > 20) return null;
    if (VALUE_STOPWORDS.has(s)) return null;
    if (VALUE_BAD_EDGE.test(s)) return null;
    return s;
}

/**
 * 按槽位类型决定是否对口语片段做蒸馏：
 * 自由文本槽蒸馏（用户说的是句子），数字/日期/数组槽保持原样（用户说的是值）。
 */
function distillFor(slot, part) {
    if (slot.type === 'string' && !slot.format && !slot.enum) {
        const d = distillFreeText(part);
        if (d && d.length >= 2) return d;
    }
    return part;
}

function cleanup(text) {
    return String(text || '')
        .trim()
        .replace(/^[「『"'\s]+|[」』"'\s]+$/g, '')
        .replace(/[。；;，,、\s]+$/g, '')
        .trim();
}

function escapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 值 → 槽位所需的类型（数字/字符串） */
function coerce(slot, raw) {
    const v = cleanup(raw);
    if (!v) return null;
    if (slot.type === 'integer' || slot.type === 'number') {
        const n = Number(String(v).replace(/[^\d.\-]/g, ''));
        return Number.isFinite(n) ? (slot.type === 'integer' ? Math.round(n) : n) : null;
    }
    if (slot.type === 'array') {
        return v.split(/[、,，;；\/]|\s+和\s+/).map((x) => cleanup(x)).filter(Boolean);
    }
    return v;
}

/** 枚举命中：值本身或同义词出现在文本中 */
function matchEnum(slot, text) {
    if (!slot.enum) return null;
    const t = text.toLowerCase();
    for (const val of slot.enum) {
        const names = [String(val), ...(ENUM_SYNONYMS[String(val).toLowerCase()] || [])];
        // 长词优先，避免「月」命中而漏掉「季度」
        const sorted = [...names].sort((a, b) => b.length - a.length);
        for (const n of sorted) {
            if (n && t.includes(String(n).toLowerCase())) return val;
        }
    }
    return null;
}

/**
 * 规则提取 —— 零外部依赖，永远可用。
 *
 * 提取优先级（高 → 低）：
 *   1. 显式键值：「客户名称是上海XX」「period=month」
 *   2. 枚举命中：「按季度来」→ quarter
 *   3. 日期/数字格式匹配
 *   4. 上一轮追问的顺序分配（用户按提问顺序逐项回答）
 *   5. 单槽位兜底（只剩一个自由文本槽位时，整句即答案）
 *
 * @param {object} p
 * @param {object} p.plan buildSlotPlan 结果
 * @param {object} p.inputs 当前已收集参数
 * @param {string} p.text 用户这一句话
 * @param {string[]} [p.lastAsk] 上一轮追问的槽位 key（按提问顺序）
 * @returns {{patch: object, hits: Array<{key:string, value:any, via:string}>}}
 */
export function extractSlots({ plan, inputs = {}, text = '', lastAsk = [] }) {
    const patch = {};
    const hits = [];
    const raw = String(text || '').trim();
    if (!raw) return { patch, hits };
    // 整句就是寒暄时不提取任何参数（「你好，帮我查充电桩」这种混合句不受影响）
    if (GREETING_ONLY.test(raw)) return { patch, hits };

    const put = (slot, value, via) => {
        if (value === null || value === undefined || value === '') return;
        if (patch[slot.key] !== undefined) return; // 高优先级已命中
        patch[slot.key] = value;
        hits.push({ key: slot.key, value, via });
    };

    const free = (s) => !(inputs[s.key] !== undefined && inputs[s.key] !== null && String(inputs[s.key]).trim() !== '');

    // ── 1. 显式键值对 ────────────────────────────────────────
    //   ① 带连接词：「客户名称是上海XX」「period=month」
    //   ② 直接跟随：「地区广东」「重量 12.5」（中文常省略「是」，靠护栏兜住误差）
    for (const slot of plan.slots) {
        if (!free(slot) || slot.isFile) continue;
        // title 常带单位/说明括号（「重量(kg)」）—— 去掉括号再匹配，否则永远命中不了
        const titleBare = slot.title ? slot.title.replace(/[（(][^）)]*[）)]/g, '').trim() : '';
        const names = [slot.key, slot.title, titleBare, slot.description]
            .filter((x) => x && x.length >= 2)
            .sort((a, b) => b.length - a.length); // 长名优先，避免「地区」压过「目标地区」

        let matched = false;
        for (const n of names) {
            const re = new RegExp(`${escapeRe(n)}\\s*(?:是|为|叫|=|:|：|设置为)\\s*([^，,。;；\\n]+)`, 'i');
            const m = raw.match(re);
            if (m) {
                put(slot, slot.enum ? (matchEnum(slot, m[1]) ?? coerce(slot, m[1])) : coerce(slot, m[1]), 'explicit');
                matched = true;
                break;
            }
        }
        if (matched) continue;
        for (const n of names) {
            const re = new RegExp(`${escapeRe(n)}\\s*[的]?\\s*([^，,。;；\\n]{1,20})`, 'i');
            const m = raw.match(re);
            if (!m) continue;
            const v = acceptableDirectValue(m[1].replace(/^(?:是|为|叫|等于)\s*/, ''));
            if (!v) continue;
            put(slot, slot.enum ? (matchEnum(slot, v) ?? coerce(slot, v)) : coerce(slot, v), 'direct');
            break;
        }
    }

    // ── 2. 枚举命中 ──────────────────────────────────────────
    for (const slot of plan.slots) {
        if (!free(slot) || slot.isFile || !slot.enum || patch[slot.key] !== undefined) continue;
        const hit = matchEnum(slot, raw);
        if (hit !== null) put(slot, hit, 'enum');
    }

    // ── 3. 格式匹配（日期 / 数字）────────────────────────────
    const dateSlots = plan.slots.filter((s) => free(s) && !s.isFile && (s.format === 'date' || s.type === 'string' && /日期|时间/.test(s.title)));
    if (dateSlots.length > 0) {
        const iso = raw.match(/(\d{4})[-/年](\d{1,2})(?:[-/月](\d{1,2}))?/);
        const md = raw.match(/(\d{1,2})月(\d{1,2})日?/);
        let d = null;
        if (iso) d = `${iso[1]}-${String(iso[2]).padStart(2, '0')}${iso[3] ? '-' + String(iso[3]).padStart(2, '0') : ''}`;
        else if (md) d = `${new Date().getFullYear()}-${String(md[1]).padStart(2, '0')}-${String(md[2]).padStart(2, '0')}`;
        if (d) put(dateSlots[0], d, 'date');
    }

    const numSlots = plan.slots.filter((s) => free(s) && !s.isFile && (s.type === 'integer' || s.type === 'number') && patch[s.key] === undefined);
    const nums = (raw.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    if (numSlots.length === 1 && nums.length >= 1) put(numSlots[0], coerce(numSlots[0], String(nums[0])), 'number');
    else if (numSlots.length > 1 && nums.length >= numSlots.length) numSlots.forEach((s, i) => put(s, coerce(s, String(nums[i])), 'number'));

    // ── 4. 上一轮追问的顺序分配 ───────────────────────────────
    //   两种对齐策略：用户重述了全部追问项 → 按提问顺序全长对齐；
    //   只回答了没填的那几项 → 按未填项对齐。
    const askedSlots = (lastAsk || []).map((k) => plan.slots.find((s) => s.key === k)).filter(Boolean);
    const pendingAsked = askedSlots.filter((s) => free(s) && !s.isFile && patch[s.key] === undefined);
    if (pendingAsked.length > 0) {
        const parts = raw
            .split(/[、,，;；\n]+|\s+和\s+|\s+以及\s+/)
            .map(cleanup)
            .filter((x) => x && x.length <= 60);
        if (askedSlots.length > 1 && parts.length >= askedSlots.length) {
            askedSlots.forEach((slot, i) => {
                if (free(slot) && !slot.isFile) put(slot, coerce(slot, distillFor(slot, parts[i])), 'ordered');
            });
        } else if (parts.length >= pendingAsked.length) {
            pendingAsked.forEach((slot, i) => put(slot, coerce(slot, distillFor(slot, parts[i])), 'ordered'));
        }
    }

    // ── 5. 单自由文本槽位兜底 ────────────────────────────────
    const remainingText = plan.slots.filter(
        (s) =>
            free(s) &&
            !s.isFile &&
            !s.enum &&
            s.format !== 'date' &&
            !/日期|时间/.test(s.title) &&
            s.type !== 'integer' &&
            s.type !== 'number' &&
            patch[s.key] === undefined &&
            (s.type === 'string' || s.type === 'array'),
    );
    if (remainingText.length === 1 && askedSlots.length <= 1) {
        if (GREETING_ONLY.test(raw.trim())) {
            // 寒暄不是参数 —— 交给追问，别把「你好」填进关键词
        } else {
            const cleaned = distillFreeText(raw).replace(/^(?:客户|账户|项目)?(?:名称|名字|叫)\s*[:：]?\s*/, '');
            if (cleaned.length >= 2 && cleaned.length <= 100) put(remainingText[0], coerce(remainingText[0], cleaned), 'fallback');
        }
    }

    return { patch, hits };
}

/** 合并提取结果（只覆盖显式给出的项，不清空其他项） */
export function mergeInputs(current = {}, patch = {}) {
    const next = { ...current };
    for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined || String(v).trim() === '') continue;
        next[k] = v;
    }
    return next;
}

// ─────────────────────────────────────────────────────────────
// 话术
// ─────────────────────────────────────────────────────────────

function slotLabel(slot) {
    const extra = slot.enum
        ? `（${slot.enum.join(' / ')}）`
        : slot.description
          ? `（${slot.description}）`
          : slot.type === 'array'
            ? '（多个用顿号分隔）'
            : '';
    return `**${slot.title}**${extra}`;
}

/** 进入技能时的引导语 */
export function composeOpening(plan) {
    const st = slotStatus(plan, {});
    const lines = [];
    lines.push(`我是「${plan.skill_name}」。${plan.summary ? plan.summary : '我们可以直接聊，我来帮你把参数填好。'}`);
    lines.push('');
    if (plan.requiredKeys.length === 0) {
        lines.push('这个技能没有必填参数，你可以直接描述需求，我整理好就执行。');
    } else {
        lines.push('开始前需要确认这几项：');
        st.requiredMissing.forEach((s, i) => lines.push(`${i + 1}. ${slotLabel(s)}`));
        lines.push('');
        lines.push('你可以一次性说清楚，也可以分几句慢慢说 —— 我来负责整理。');
    }
    if (plan.slots.some((s) => s.isFile)) {
        const f = plan.slots.find((s) => s.isFile);
        lines.push('');
        lines.push(`📎 其中 ${slotLabel(f)} 需要通过左下角的附件按钮上传。`);
    }
    return { content: lines.join('\n'), lastAsk: st.requiredMissing.map((s) => s.key) };
}

/** 追问话术 */
export function composeAsk({ plan, inputs, patch = {}, hits = [] }) {
    const st = slotStatus(plan, inputs);
    const lines = [];
    const filledNow = hits.filter((h) => h.via !== 'fallback');
    if (filledNow.length > 0) {
        lines.push(`已记录：${filledNow.map((h) => `**${slotTitleOf(plan, h.key)}** = ${formatValue(h.value)}`).join('，')} ✅`);
        lines.push('');
    }
    if (st.ready) {
        lines.push('参数齐了 👇 确认无误就可以开始执行。');
        return { content: lines.join('\n'), lastAsk: [] };
    }
    const miss = st.requiredMissing;
    if (miss.length === 1) {
        lines.push(`还差一项：${slotLabel(miss[0])}`);
    } else {
        lines.push(`还需要补充 ${miss.length} 项：`);
        miss.forEach((s, i) => lines.push(`${i + 1}. ${slotLabel(s)}`));
        lines.push('');
        lines.push('可以直接按顺序回答，也可以一次说全。');
    }
    return { content: lines.join('\n'), lastAsk: miss.map((s) => s.key) };
}

function slotTitleOf(plan, key) {
    return plan.slots.find((s) => s.key === key)?.title || key;
}

export function formatValue(v) {
    if (Array.isArray(v)) return v.join('、');
    return String(v);
}

/** 确认卡片（参数齐了之后的内部确认） */
export function composeSummary({ plan, inputs }) {
    const lines = [];
    lines.push('#### 请确认执行参数');
    lines.push('');
    lines.push('| 参数 | 值 |');
    lines.push('| --- | --- |');
    for (const s of plan.slots) {
        const v = inputs[s.key];
        if (v === undefined || v === null || String(v).trim() === '') continue;
        lines.push(`| ${s.title} | ${formatValue(v).replace(/\|/g, '\\|')} |`);
    }
    const st = slotStatus(plan, inputs);
    if (st.requiredMissing.length > 0) {
        lines.push('');
        lines.push(`⚠️ 仍缺：${st.requiredMissing.map((s) => s.title).join('、')}`);
    }
    return lines.join('\n');
}
