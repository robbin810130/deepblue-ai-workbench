/**
 * 任务输入框（工作台首页模块 3 · TaskCommandBox）
 *
 * 依据：06_前端页面详细PRD §1.3 任务输入行为
 *   - 空输入不提交；Enter 提交，Shift+Enter 换行
 *   - 输入后调用技能路由接口；高置信度仅一个技能时显示「建议使用：xxx」，仍由用户确认
 *   - 低置信度时展示最多 3 个候选技能（本版尚未接入路由接口，先给高置信度分支）
 *   - 拖入文件时先上传对象存储，输入框显示附件 chip
 *
 * ⚠️ 当前为前端形态版：技能路由接口（POST /api/skills/route）未接入，
 *    提交后以本地关键词匹配演示「建议使用」交互，接后端时替换 resolveSuggestion。
 */
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Paperclip, Sparkles, X } from 'lucide-react';
import { SCENES } from '../../../config/scenes';
import { sceneApiKey } from '../../../api/sceneMap';
import { cn } from '../../../components/ui/cn';

interface Suggestion {
  sceneKey: string;
  sceneName: string;
  summary: string;
}

/** 临时实现：用场景名/摘要做关键词命中，接后端后整体替换 */
function resolveSuggestion(text: string): Suggestion | null {
  const q = text.trim();
  if (!q) return null;
  const hit = SCENES.find(
    (s) => q.includes(s.name) || s.summary.includes(q),
  );
  if (!hit) return null;
  return {
    sceneKey: hit.key,
    sceneName: hit.name,
    summary: hit.summary,
  };
}

export function TaskCommandBox() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [value, setValue] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const canSubmit = useMemo(
    () => value.trim().length > 0 || files.length > 0,
    [value, files],
  );

  const reset = () => {
    setValue('');
    setFiles([]);
    setSuggestion(null);
  };

  const submit = () => {
    if (!canSubmit) return;
    const text = value.trim();

    // 高置信度：命中唯一场景 → 给「建议使用」提示，仍需用户确认（PRD §1.3）
    const s = resolveSuggestion(text);
    if (s) {
      setSuggestion(s);
      setSubmitted(null);
      return;
    }

    // 未命中：演示态提示（接 /api/skills/route 后改为候选技能列表）
    setSuggestion(null);
    setSubmitted(
      text || `已上传 ${files.length} 个附件`,
    );
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
    if (e.key === 'Escape') reset();
  };

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    setFiles((prev) => [...prev, ...Array.from(list)].slice(0, 5));
    setSubmitted(null);
  };

  return (
    <section aria-label="任务输入">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        className={cn(
          'flex min-h-[56px] items-center gap-3 rounded-[14px] border bg-surface px-5 py-[8px] transition-all',
          dragging
            ? 'border-primary-400 ring-4 ring-primary-100'
            : 'border-line shadow-panel focus-within:border-primary-300 focus-within:ring-4 focus-within:ring-primary-100',
        )}
      >
        <Sparkles
          size={18}
          className="mt-[1px] shrink-0 self-start pt-[19px] text-primary-500"
          aria-hidden="true"
        />

        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {/* 附件 chip */}
          {files.map((f) => (
            <span
              key={`${f.name}-${f.size}`}
              className="inline-flex max-w-[200px] items-center gap-1.5 rounded-lg bg-primary-50 py-1 pl-2.5 pr-1.5 text-caption text-primary-700"
            >
              <Paperclip size={12} className="shrink-0" />
              <span className="truncate">{f.name}</span>
              <button
                type="button"
                aria-label={`移除附件 ${f.name}`}
                onClick={() =>
                  setFiles((prev) => prev.filter((x) => x !== f))
                }
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full hover:bg-primary-200"
              >
                <X size={11} />
              </button>
            </span>
          ))}

          <textarea
            ref={inputRef}
            rows={1}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setSubmitted(null);
            }}
            onKeyDown={onKeyDown}
            aria-label="输入你想处理的任务"
            placeholder="今天想处理什么？输入你的任务，或从下方选择业务场景开始。"
            className="dw-scroll min-h-[22px] flex-1 resize-none bg-transparent py-0 text-lead leading-[22px] text-ink outline-none placeholder:text-ink-faint"
          />
        </div>

        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => addFiles(e.target.files)}
        />

        <button
          type="button"
          aria-label="添加附件"
          onClick={() => fileRef.current?.click()}
          className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-ink-faint transition-colors hover:bg-page hover:text-ink-soft sm:flex"
        >
          <Paperclip size={17} />
        </button>

        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          aria-label="提交任务"
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 focus-visible:ring-offset-2',
            canSubmit
              ? 'bg-primary-500 text-white hover:bg-primary-600 active:bg-primary-700'
              : 'bg-primary-100 text-primary-300',
          )}
        >
          <ArrowRight size={18} strokeWidth={2.2} />
        </button>
      </div>

      {/* 反馈区：PRD §10 要求点击后 300ms 内出现明确反馈 */}
      {suggestion && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[12px] border border-primary-200 bg-primary-50 px-4 py-3">
          <span className="text-lead text-ink">
            建议使用：<strong className="font-medium text-primary-600">{suggestion.sceneName}</strong>
          </span>
          <span className="text-caption text-ink-soft">{suggestion.summary}</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={reset}
              className="h-8 rounded-control px-3 text-caption text-ink-soft transition-colors hover:bg-white/70 hover:text-ink"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => navigate(`/scenes/${sceneApiKey(suggestion.sceneKey)}`)}
              className="h-8 rounded-control bg-primary-500 px-3.5 text-caption font-medium text-white transition-colors hover:bg-primary-600"
            >
              去发起
            </button>
          </div>
        </div>
      )}

      {submitted && (
        <div className="mt-3 flex items-center gap-3 rounded-[12px] border border-line bg-surface-sunken px-4 py-3">
          <span className="text-lead text-ink-soft">
            已收到「{submitted}」
          </span>
          <span className="text-caption text-ink-faint">
            技能路由接口（<code>/api/skills/route</code>）尚未接入，接入后此处显示候选技能
          </span>
          <button
            type="button"
            onClick={reset}
            className="ml-auto h-8 shrink-0 rounded-control px-3 text-caption text-ink-soft transition-colors hover:bg-surface hover:text-ink"
          >
            清空
          </button>
        </div>
      )}
    </section>
  );
}
