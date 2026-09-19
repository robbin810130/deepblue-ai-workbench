/**
 * 技能「立即使用」页 —— /skills/:skillKey
 *
 * 依据：03_前端规范 §9（/skills/:key = 动态表单 + 文件上传 + 开始执行）
 *      05_PRD §6 —— requires_confirmation 的技能执行后进入待确认
 *
 * 表单由后端 input_schema 驱动（string/number/enum/file）；
 * 文件先 POST /files/upload 拿 file_id，再随任务提交。
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Play, Upload, X } from 'lucide-react';
import { cn } from '../../components/ui/cn';
import {
  api,
  ApiError,
  type ApiSkill,
} from '../../api/client';

interface UploadedFile {
  file_id: string;
  name: string;
  size_bytes: number;
}

/**
 * 从 schema 的 format/type 推断控件类型
 *
 * ⚠️ catalog 里所有文件型字段都写成 `{ type: 'string', format: 'binary' }`（JSON Schema 的
 * 二进制约定），而不是 `format: 'file'`；两者都必须识别为文件上传，否则文件字段会退化成
 * 文本框，发票校验 / 合同审核 / 会议纪要等 10+ 个技能在新 UI 下直接不可用。
 */
function widgetOf(f: ApiSkill['input_schema']['properties'][string]): 'textarea' | 'input' | 'select' | 'file' | 'number' {
  if (f.type === 'file' || f.type === 'file_multi' || f.format === 'file' || f.format === 'binary') return 'file';
  if (f.enum && f.enum.length > 0) return 'select';
  if (f.type === 'number' || f.type === 'integer') return 'number';
  if (f.format === 'textarea' || f.type === 'text') return 'textarea';
  return 'input';
}

export function SkillUsePage() {
  const { skillKey } = useParams<{ skillKey: string }>();
  const nav = useNavigate();
  const [skill, setSkill] = useState<ApiSkill | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!skillKey) return;
    api
      .getSkill(skillKey)
      .then(setSkill)
      .catch((e) => setError(e instanceof ApiError ? `${e.code}: ${e.message}` : e.message));
  }, [skillKey]);

  const fields = useMemo(() => {
    if (!skill) return [];
    return Object.entries(skill.input_schema?.properties || {}).map(([key, f]) => ({ key, ...f }));
  }, [skill]);

  const required = useMemo(() => new Set(skill?.input_schema?.required || []), [skill]);

  if (error) {
    return (
      <div className="mx-auto max-w-[760px] px-8 py-16 text-center">
        <p className="text-lead text-danger">{error}</p>
        <Link to="/scenes" className="mt-4 inline-block text-caption text-primary-600 hover:underline">
          返回业务场景
        </Link>
      </div>
    );
  }
  if (!skill) return <p className="px-8 py-16 text-center text-caption text-ink-faint">加载中…</p>;

  const upload = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setUploading(true);
    setSubmitError(null);
    try {
      for (const f of Array.from(list)) {
        const r = await api.uploadFile(f);
        setFiles((prev) => [...prev, { file_id: r.file_id, name: r.name || f.name, size_bytes: r.size_bytes }]);
      }
    } catch (e) {
      setSubmitError(e instanceof ApiError ? e.message : '文件上传失败');
    } finally {
      setUploading(false);
    }
  };

  const submit = async (executeNow: boolean) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const task = await api.createTask({
        skill_key: skill.skill_key,
        title: `${skill.name}`,
        inputs: Object.fromEntries(Object.entries(values).filter(([, v]) => v !== '')),
        files: files.map((f) => ({ file_id: f.file_id, name: f.name })),
        execute_now: executeNow,
      });
      nav(`/tasks/${task.id}`);
    } catch (e) {
      setSubmitError(e instanceof ApiError ? `${e.message}` : '提交失败');
      setSubmitting(false);
    }
  };

  const missing = fields.filter((f) => required.has(f.key) && !values[f.key]?.trim() && widgetOf(f) !== 'file');
  const needFile = required.size > 0 && fields.some((f) => widgetOf(f) === 'file' && required.has(f.key));
  const canExecute = !submitting && !uploading && missing.length === 0 && (!needFile || files.length > 0);

  return (
    <div className="mx-auto w-full max-w-[760px] px-8 py-7">
      <Link
        to={`/scenes/${skill.scene}`}
        className="inline-flex items-center gap-1 text-caption text-ink-soft transition-colors hover:text-ink"
      >
        <ArrowLeft size={14} /> 返回场景
      </Link>

      <div className="mt-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-title font-semibold text-ink">{skill.name}</h1>
          <p className="mt-1.5 max-w-[560px] text-lead text-ink-soft">{skill.summary}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="rounded-md bg-surface-sunken px-2 py-1 text-[11px] text-ink-soft">
            {skill.execution_mode === 'async' ? '异步执行' : '同步执行'}
          </span>
          {skill.requires_confirmation && (
            <span className="rounded-md bg-warning-soft px-2 py-1 text-[11px] text-warning">需人工确认</span>
          )}
          {!skill.live && <span className="rounded-md bg-danger-soft px-2 py-1 text-[11px] text-danger">未开放</span>}
        </div>
      </div>

      {skill.permission_status === 'denied' && (
        <p className="mt-4 rounded-lg bg-danger-soft px-4 py-2.5 text-caption text-danger">
          当前账号没有此技能的权限：{skill.permission_status_reason}
        </p>
      )}

      {/* 动态表单 */}
      <div className="mt-5 space-y-4 rounded-xl border border-line bg-surface px-5 py-5">
        {fields.length === 0 && <p className="text-caption text-ink-faint">该技能无需填写参数。</p>}
        {fields.map((f) => {
          const w = widgetOf(f);
          return (
            <div key={f.key}>
              <label htmlFor={`f-${f.key}`} className="text-caption font-medium text-ink">
                {f.title || f.key}
                {required.has(f.key) && <span className="ml-1 text-danger">*</span>}
              </label>
              {f.description && <p className="mt-0.5 text-[11px] text-ink-faint">{f.description}</p>}
              {w === 'file' ? (
                <div className="mt-2">
                  <label
                    className={cn(
                      'flex h-9 w-fit cursor-pointer items-center gap-1.5 rounded-[10px] bg-surface-sunken px-3 text-caption text-ink-soft transition-colors hover:text-ink',
                      uploading && 'pointer-events-none opacity-50',
                    )}
                  >
                    <Upload size={13} /> {uploading ? '上传中…' : '选择文件'}
                    <input
                      type="file"
                      className="hidden"
                      multiple
                      accept={skill.supported_files?.length ? skill.supported_files.join(',') : undefined}
                      onChange={(e) => upload(e.target.files)}
                    />
                  </label>
                  {skill.supported_files && skill.supported_files.length > 0 && (
                    <p className="mt-1 text-[11px] text-ink-faint">
                      支持 {skill.supported_files.join(' / ')}
                    </p>
                  )}
                  {files.length > 0 && (                    <ul className="mt-2 space-y-1">
                      {files.map((uf) => (
                        <li key={uf.file_id} className="flex items-center gap-2 text-caption text-ink-soft">
                          <span className="truncate">{uf.name}</span>
                          <span className="text-ink-faint">{(uf.size_bytes / 1024).toFixed(1)} KB</span>
                          <button
                            type="button"
                            aria-label={`移除 ${uf.name}`}
                            onClick={() => setFiles((prev) => prev.filter((x) => x.file_id !== uf.file_id))}
                            className="text-ink-faint hover:text-danger"
                          >
                            <X size={12} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : w === 'select' ? (
                <select
                  id={`f-${f.key}`}
                  value={values[f.key] || ''}
                  onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))}
                  className="mt-2 h-9 w-full rounded-lg border border-line bg-page px-3 text-lead text-ink focus:border-primary-300 focus:outline-none"
                >
                  <option value="">请选择…</option>
                  {f.enum!.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : w === 'textarea' ? (
                <textarea
                  id={`f-${f.key}`}
                  value={values[f.key] || ''}
                  onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))}
                  rows={4}
                  className="mt-2 w-full resize-y rounded-lg border border-line bg-page px-3 py-2 text-lead leading-relaxed text-ink focus:border-primary-300 focus:outline-none"
                />
              ) : (
                <input
                  id={`f-${f.key}`}
                  type={w === 'number' ? 'number' : 'text'}
                  value={values[f.key] || ''}
                  onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))}
                  className="mt-2 h-9 w-full rounded-lg border border-line bg-page px-3 text-lead text-ink focus:border-primary-300 focus:outline-none"
                />
              )}
            </div>
          );
        })}
      </div>

      {submitError && (
        <p className="mt-3 rounded-lg bg-danger-soft px-4 py-2.5 text-caption text-danger">{submitError}</p>
      )}

      {/* 提交条 */}
      <div className="mt-5 flex items-center gap-2.5">
        <button
          type="button"
          disabled={!canExecute}
          onClick={() => submit(true)}
          className={cn(
            'inline-flex h-10 items-center gap-1.5 rounded-[10px] px-5 text-lead font-semibold transition-colors',
            canExecute
              ? 'bg-primary-600 text-white hover:bg-primary-700'
              : 'cursor-not-allowed bg-surface-sunken text-ink-faint',
          )}
        >
          <Play size={15} /> {submitting ? '提交中…' : '开始执行'}
        </button>
        <button
          type="button"
          disabled={!canExecute}
          onClick={() => submit(false)}
          className="h-10 rounded-[10px] bg-surface-sunken px-4 text-lead font-medium text-ink-soft transition-colors hover:text-ink disabled:opacity-50"
        >
          仅保存草稿
        </button>
        {missing.length > 0 && (
          <span className="text-caption text-ink-faint">
            还需填写：{missing.map((f) => f.title || f.key).join('、')}
          </span>
        )}
      </div>
    </div>
  );
}
