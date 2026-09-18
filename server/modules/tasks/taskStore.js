/**
 * 任务持久层 —— tasks / task_runs / task_events / task_artifacts 四表
 *
 * 设计要点：
 *   1. DDL 全部 IF NOT EXISTS，沿用平台 dashboardRoutes 的启动自建模式，
 *      不引入迁移工具（与存量约定一致）。
 *   2. 内部主键用 UUID（PRD §10），业务编号 task_no 形如 AI-20260919-A3F921。
 *   3. 事件只追加、不更新（PRD §5「TaskEvent 时间线」要求可审计）。
 *   4. 这里只有数据访问，不含任何业务判断 —— 状态合法性归 states.js，
 *      流程编排归 taskService.js。
 */

import crypto from 'crypto';
import pool from '../../db.js';

/** 生成任务编号：AI-YYYYMMDD-6位（PRD §10） */
export function generateTaskNo(now = new Date()) {
    const date = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
    ].join('');
    const rand = crypto.randomBytes(3).toString('hex').toUpperCase(); // 6 位短随机串
    return `AI-${date}-${rand}`;
}

/** 启动期建表（幂等） */
export async function ensureTasksTables() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS tasks (
            id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            task_no       VARCHAR(24) NOT NULL UNIQUE,
            title         VARCHAR(200) NOT NULL,
            skill_key     VARCHAR(64)  NOT NULL,
            scene         VARCHAR(40)  NOT NULL,
            status        VARCHAR(24)  NOT NULL DEFAULT 'draft',
            input         JSONB        NOT NULL DEFAULT '{}'::jsonb,
            result        JSONB,
            summary       TEXT,
            error_code    VARCHAR(40),
            error_message TEXT,
            trace_id      VARCHAR(64),
            created_by    INTEGER      NOT NULL,
            created_by_name VARCHAR(64),
            assigned_to   INTEGER,
            run_count     INTEGER      NOT NULL DEFAULT 0,
            created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            started_at    TIMESTAMPTZ,
            completed_at  TIMESTAMPTZ,
            archived_at   TIMESTAMPTZ
        )
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_tasks_created_by ON tasks (created_by, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status);
        CREATE INDEX IF NOT EXISTS idx_tasks_scene ON tasks (scene);
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS task_runs (
            id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            task_id        UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            run_no         INTEGER NOT NULL,
            status         VARCHAR(24) NOT NULL,
            provider       VARCHAR(24),
            binding_key    VARCHAR(80),
            workflow_run_id VARCHAR(80),
            duration_ms    INTEGER,
            error          JSONB,
            started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            finished_at    TIMESTAMPTZ,
            UNIQUE (task_id, run_no)
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS task_events (
            id          BIGSERIAL PRIMARY KEY,
            task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            run_id      UUID,
            event_type  VARCHAR(40) NOT NULL,
            from_status VARCHAR(24),
            to_status   VARCHAR(24),
            actor       VARCHAR(64),
            detail      JSONB,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events (task_id, created_at);
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS task_artifacts (
            id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            task_id      UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            run_id       UUID,
            kind         VARCHAR(24) NOT NULL,
            name         VARCHAR(200),
            mime_type    VARCHAR(100),
            size_bytes   BIGINT,
            storage_path TEXT,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
}

// ─────────────────────────────────────────────────────────────
// tasks
// ─────────────────────────────────────────────────────────────

/**
 * 创建任务
 * @param {object} t
 * @param {string} t.title
 * @param {string} t.skill_key
 * @param {string} t.scene
 * @param {'draft'|'queued'} t.status 初始状态（草稿 或 直接提交）
 * @param {object} t.input
 * @param {{id:number,name?:string}} t.user 创建人
 * @param {number} [t.assigned_to]
 */
export async function insertTask({ title, skill_key, scene, status, input, user, assigned_to = null, trace_id = null }) {
    const taskNo = generateTaskNo();
    const { rows } = await pool.query(
        `INSERT INTO tasks (task_no, title, skill_key, scene, status, input, created_by, created_by_name, assigned_to, trace_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [taskNo, title, skill_key, scene, status, JSON.stringify(input || {}), user.id, user.name || user.username || null, assigned_to, trace_id],
    );
    return rows[0];
}

/**
 * 任务列表（PRD §4：默认当前用户创建或被分配；支持状态/场景/技能/时间/搜索）
 */
export async function listTasks({ userId, isAdmin = false, status, scene, skill, since, until, q, limit = 20, offset = 0 }) {
    const where = [];
    const params = [];
    if (!isAdmin) {
        params.push(userId);
        where.push(`(created_by = $${params.length} OR assigned_to = $${params.length})`);
    }
    const add = (value) => {
        params.push(value);
        return `$${params.length}`;
    };
    if (status) where.push(`status = ${add(status)}`);
    if (scene) where.push(`scene = ${add(scene)}`);
    if (skill) where.push(`skill_key = ${add(skill)}`);
    if (since) where.push(`created_at >= ${add(since)}`);
    if (until) where.push(`created_at <= ${add(until)}`);
    if (q) {
        const p = add(`%${q}%`);
        where.push(`(title ILIKE ${p} OR task_no ILIKE ${p})`);
    }
    params.push(Math.min(Number(limit) || 20, 100));
    const lim = `$${params.length}`;
    params.push(Math.max(Number(offset) || 0, 0));
    const off = `$${params.length}`;

    const sql = `SELECT * FROM tasks ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ${lim} OFFSET ${off}`;
    const { rows } = await pool.query(sql, params);
    return rows;
}

export async function getTaskById(id) {
    const { rows } = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
    return rows[0] || null;
}

/** 状态迁移 + 对应字段落库（单条 UPDATE，updated_at 一起刷） */
export async function updateTaskStatus(id, { status, error_code = null, error_message = null, result = undefined, summary = undefined, trace_id = undefined, started = false, completed = false, archived = false }) {
    const sets = ['status = $2', 'updated_at = NOW()'];
    const params = [id, status];
    const add = (v) => {
        params.push(v);
        return `$${params.length}`;
    };
    if (error_code) sets.push(`error_code = ${add(error_code)}`);
    if (error_message) sets.push(`error_message = ${add(error_message)}`);
    if (result !== undefined) sets.push(`result = ${add(JSON.stringify(result))}::jsonb`);
    if (summary !== undefined) sets.push(`summary = ${add(summary)}`);
    if (trace_id !== undefined) sets.push(`trace_id = ${add(trace_id)}`);
    if (status === 'running' || started) sets.push(`started_at = COALESCE(started_at, NOW())`);
    if (['succeeded', 'failed', 'cancelled'].includes(status) || completed) {
        sets.push(`completed_at = NOW()`);
    }
    if (status === 'archived' || archived) sets.push(`archived_at = NOW()`);
    const { rows } = await pool.query(`UPDATE tasks SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params);
    return rows[0] || null;
}

export async function deleteDraftTask(id) {
    // 仅草稿可物理删除（PRD §3）；非草稿由调用方先校验
    const { rowCount } = await pool.query("DELETE FROM tasks WHERE id = $1 AND status = 'draft'", [id]);
    return rowCount > 0;
}

/** 复用原输入新建任务（rerun：succeeded/cancelled 的「再次执行」） */
export async function cloneTask(source, { user }) {
    return insertTask({
        title: source.title,
        skill_key: source.skill_key,
        scene: source.scene,
        status: 'draft',
        input: source.input,
        user,
        trace_id: source.trace_id,
    });
}

// ─────────────────────────────────────────────────────────────
// task_runs（PRD §7：重试 = run_no + 1，旧 Run 保留）
// ─────────────────────────────────────────────────────────────

export async function insertRun(taskId, { provider, binding_key }) {
    const { rows } = await pool.query(
        `INSERT INTO task_runs (task_id, run_no, status, provider, binding_key)
         SELECT $1, COALESCE(MAX(run_no), 0) + 1, 'running', $2, $3 FROM task_runs WHERE task_id = $1
         RETURNING *`,
        [taskId, provider, binding_key],
    );
    // 同步递增任务上的 run_count（列表页展示「执行过几次」）
    await pool.query('UPDATE tasks SET run_count = run_count + 1, updated_at = NOW() WHERE id = $1', [taskId]);
    return rows[0];
}

export async function finishRun(runId, { status, duration_ms = null, workflow_run_id = null, error = null }) {
    const { rows } = await pool.query(
        `UPDATE task_runs SET status = $2, duration_ms = $3, workflow_run_id = COALESCE($4, workflow_run_id),
                error = $5, finished_at = NOW() WHERE id = $1 RETURNING *`,
        [runId, status, duration_ms, workflow_run_id, error ? JSON.stringify(error) : null],
    );
    return rows[0] || null;
}

export async function getRunById(runId) {
    const { rows } = await pool.query('SELECT * FROM task_runs WHERE id = $1', [runId]);
    return rows[0] || null;
}

export async function listRuns(taskId) {
    const { rows } = await pool.query('SELECT * FROM task_runs WHERE task_id = $1 ORDER BY run_no', [taskId]);
    return rows;
}

// ─────────────────────────────────────────────────────────────
// task_events（只追加）
// ─────────────────────────────────────────────────────────────

export async function appendEvent(taskId, { run_id = null, event_type, from_status = null, to_status = null, actor = 'system', detail = null }) {
    await pool.query(
        `INSERT INTO task_events (task_id, run_id, event_type, from_status, to_status, actor, detail)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [taskId, run_id, event_type, from_status, to_status, actor, detail ? JSON.stringify(detail) : null],
    );
}

export async function listEvents(taskId) {
    const { rows } = await pool.query('SELECT * FROM task_events WHERE task_id = $1 ORDER BY created_at, id', [taskId]);
    return rows;
}

// ─────────────────────────────────────────────────────────────
// task_artifacts（PRD §9；签名 URL 下载属 M4 文件暂存层，先落登记）
// ─────────────────────────────────────────────────────────────

export async function insertArtifact(taskId, { run_id = null, kind, name, mime_type, size_bytes, storage_path }) {
    const { rows } = await pool.query(
        `INSERT INTO task_artifacts (task_id, run_id, kind, name, mime_type, size_bytes, storage_path)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [taskId, run_id, kind, name || null, mime_type || null, size_bytes || null, storage_path || null],
    );
    return rows[0];
}

export async function listArtifacts(taskId) {
    const { rows } = await pool.query('SELECT * FROM task_artifacts WHERE task_id = $1 ORDER BY created_at', [taskId]);
    return rows;
}
