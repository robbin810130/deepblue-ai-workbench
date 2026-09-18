/**
 * 平台标准错误码 —— 文档 `03_API接口规范` §11
 *
 * 为什么需要它：
 *   现状后端错误一律 `res.status(500).json({ error: err.message })`，
 *   前端拿到的只有 HTTP 500 和一句原始报错，**无法区分**
 *   「我输入错了」和「外面服务挂了」，也就没法给用户不同的提示与补救动作。
 *
 *   有了错误码，前端可以稳定判断：
 *     VALIDATION_FAILED → 高亮表单字段，让用户改
 *     PROVIDER_TIMEOUT  → 提示重试，并允许后台继续跑
 *     FORBIDDEN         → 隐藏入口而不是报错
 */

/** 错误码 → 默认 HTTP 状态 → 默认用户提示（文档 03 §11 原文） */
export const ERROR_CODES = Object.freeze({
    AUTH_REQUIRED: { http_status: 401, message: '未登录或登录已失效' },
    FORBIDDEN: { http_status: 403, message: '你没有执行该操作的权限' },
    RESOURCE_NOT_FOUND: { http_status: 404, message: '资源不存在或不可见' },
    VALIDATION_FAILED: { http_status: 422, message: '输入不满足技能要求' },
    TASK_ALREADY_RUNNING: { http_status: 409, message: '任务已在执行中' },
    PROVIDER_TIMEOUT: { http_status: 504, message: 'AI 服务响应超时，请稍后重试' },
    PROVIDER_ERROR: { http_status: 502, message: 'AI 服务暂时不可用，请稍后重试' },
    RATE_LIMITED: { http_status: 429, message: '请求过于频繁，请稍后重试' },
    /** 平台扩展（文档未列，但注册表与绑定层实际需要） */
    BINDING_INCOMPLETE: { http_status: 502, message: 'AI 服务未正确配置，请联系管理员' },
    INTERNAL_ERROR: { http_status: 500, message: '服务内部错误' },
});

/** 业务异常：带错误码，便于在任意层抛出后由统一处理器翻译 */
export class AppError extends Error {
    /**
     * @param {keyof typeof ERROR_CODES} code
     * @param {string} [message] 覆盖默认提示
     * @param {object} [options]
     */
    constructor(code, message, options = {}) {
        const def = ERROR_CODES[code] || ERROR_CODES.INTERNAL_ERROR;
        super(message || def.message);
        this.name = 'AppError';
        this.code = ERROR_CODES[code] ? code : 'INTERNAL_ERROR';
        this.http_status = options.http_status || def.http_status;
        this.detail = options.detail || null;
        this.extra = options.extra || null;
    }
}

/** 便捷构造器 */
export const badRequest = (msg, extra) => new AppError('VALIDATION_FAILED', msg, { extra });
export const notFound = (msg) => new AppError('RESOURCE_NOT_FOUND', msg);
export const forbidden = (msg) => new AppError('FORBIDDEN', msg);
