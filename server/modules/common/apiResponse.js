/**
 * 标准响应与错误模型 —— 文档 `03_API接口规范` §1–§3
 *
 * 成功：{ success: true,  data: {...}, trace_id, meta: { request_time_ms } }
 * 失败：{ success: false, error: { code, message, detail }, trace_id }
 *
 * 链路追踪（文档 03 §1）：
 *   X-Trace-Id 由客户端可选传入，服务端缺失时生成 —— 用于把
 *   「用户看到的一句报错」和「日志里的一次 Provider 调用」串起来。
 */

import crypto from 'crypto';
import { ERROR_CODES, AppError } from './errors.js';

/** 取或生成 trace_id */
export function resolveTraceId(req) {
    const fromHeader = req?.headers?.['x-trace-id'];
    if (typeof fromHeader === 'string' && fromHeader.trim()) return fromHeader.trim();
    return `01J${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

/** 成功响应 */
export function sendOk(res, data, ctx = {}) {
    const traceId = ctx.trace_id || resolveTraceId(res.req);
    const body = { success: true, data };
    if (ctx.meta) body.meta = ctx.meta;
    body.trace_id = traceId;
    return res.json(body);
}

/**
 * 失败响应。
 * @param {import('express').Response} res
 * @param {Error & {code?:string, http_status?:number, detail?:string}} err
 * @param {{trace_id?:string, exposeDetail?:boolean}} [ctx]
 */
export function sendFail(res, err, ctx = {}) {
    const traceId = ctx.trace_id || resolveTraceId(res.req);
    const code = err?.code && ERROR_CODES[err.code] ? err.code : 'INTERNAL_ERROR';
    const def = ERROR_CODES[code];
    const httpStatus = err?.http_status || def.http_status;

    // 文档 03 §3：detail 仅在管理员/调试环境返回必要诊断信息
    const exposeDetail = ctx.exposeDetail ?? process.env.NODE_ENV !== 'production';

    const error = {
        code,
        message: err?.message || def.message,
    };
    if (exposeDetail && err?.detail) error.detail = err.detail;
    if (exposeDetail && err?.missing) error.missing = err.missing;

    return res.status(httpStatus).json({ success: false, error, trace_id: traceId });
}

/**
 * 把 async 路由处理器的异常自动转成标准错误响应。
 * 避免每个 handler 都写 try/catch（也在防止「漏 catch 导致请求挂死」）。
 * @param {(req:any,res:any,next:any)=>Promise<any>} fn
 */
export function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

/**
 * v1 路由专用错误中间件：把任意异常翻译为标准错误体。
 * 挂在 /api/v1 路由之后。
 */
export function v1ErrorHandler() {
    // eslint-disable-next-line no-unused-vars
    return (err, req, res, next) => {
        if (res.headersSent) return next(err);
        const traceId = resolveTraceId(req);
        if (err instanceof AppError) {
            return sendFail(res, err, { trace_id: traceId });
        }
        // 未知异常：记录完整堆栈，但对外只说“服务内部错误”
        console.error('[api/v1] 未处理异常', { trace_id: traceId, path: req.originalUrl, err: err?.stack || err });
        return sendFail(
            res,
            new AppError('INTERNAL_ERROR', null, { detail: String(err?.message || err) }),
            { trace_id: traceId },
        );
    };
}

/** 计时器：用于 meta.request_time_ms */
export function startTimer() {
    const t0 = process.hrtime.bigint();
    return () => Number(process.hrtime.bigint() - t0) / 1e6;
}
