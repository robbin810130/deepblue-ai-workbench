/**
 * 系统设置 —— /settings
 *
 * 依据：06_前端页面详细PRD §10（配置类表单）+ 存量个人中心接口
 *   GET    /api/user/profile            个人资料
 *   PUT    /api/user/profile            改姓名/部门/邮箱
 *   POST   /api/user/change-password    改密码（成功后踢出其他设备）
 *   POST   /api/user/avatar             头像（base64 DataURL，限 ~350KB）
 *   GET    /api/user/sessions           在线会话
 *   DELETE /api/user/sessions/:jti      踢出指定设备
 *   DELETE /api/user/sessions           退出所有其他设备
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Lock, Monitor, ShieldAlert, UserRound } from 'lucide-react';
import { cn } from '../../components/ui/cn';
import { api, type AccountProfile, type AccountSession } from '../../api/client';
import { Banner, Panel, PrimaryButton, SubButton, TextField, errText, fmtDateTime } from '../admin/ui';

function fmtRemain(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (Number.isNaN(ms) || ms <= 0) return '已过期';
  const h = Math.floor(ms / 3600000);
  return h >= 24 ? `${Math.floor(h / 24)} 天后过期` : `${h} 小时后过期`;
}

export function SettingsPage() {
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [department, setDepartment] = useState('');
  const [email, setEmail] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [savingPwd, setSavingPwd] = useState(false);

  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [pendingKick, setPendingKick] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const avatarRef = useRef<HTMLInputElement>(null);

  const loadSessions = useCallback(() => {
    api.account
      .sessions()
      .then(setSessions)
      .catch(() => setSessions([]));
  }, []);

  useEffect(() => {
    api.account
      .profile()
      .then((p) => {
        setProfile(p);
        setDisplayName(p.display_name || '');
        setDepartment(p.department || '');
        setEmail(p.email || '');
      })
      .catch((e) => setError(errText(e)));
    loadSessions();
  }, [loadSessions]);

  const saveProfile = async () => {
    setSavingProfile(true);
    setError(null);
    setNotice(null);
    try {
      await api.account.updateProfile({ display_name: displayName, department, email });
      setNotice('个人资料已更新。');
      const fresh = await api.account.profile().catch(() => null);
      if (fresh) setProfile(fresh);
    } catch (e) {
      setError(errText(e));
    } finally {
      setSavingProfile(false);
    }
  };

  const changePwd = async () => {
    if (newPwd !== confirmPwd) {
      setError('两次输入的新密码不一致。');
      return;
    }
    setSavingPwd(true);
    setError(null);
    setNotice(null);
    try {
      await api.account.changePassword(oldPwd, newPwd);
      setOldPwd('');
      setNewPwd('');
      setConfirmPwd('');
      setNotice('密码已修改，其他登录设备已自动下线。');
      loadSessions();
    } catch (e) {
      setError(errText(e));
    } finally {
      setSavingPwd(false);
    }
  };

  const pickAvatar = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 340 * 1024) {
      setError('头像文件过大（限 ~350KB），请先压缩后再上传。');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      setError(null);
      try {
        await api.account.uploadAvatar(String(reader.result));
        setNotice('头像已更新。');
        const fresh = await api.account.profile().catch(() => null);
        if (fresh) setProfile(fresh);
      } catch (e) {
        setError(errText(e));
      }
    };
    reader.readAsDataURL(file);
  };

  const kick = async (jti: string) => {
    setError(null);
    try {
      await api.account.revokeSession(jti);
      setPendingKick(null);
      setNotice('设备已踢出。');
      loadSessions();
    } catch (e) {
      setError(errText(e));
    }
  };

  const kickAll = async () => {
    setError(null);
    try {
      await api.account.revokeAllSessions();
      setNotice('已退出其他所有设备。');
      loadSessions();
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <div className="mx-auto w-full max-w-[880px] px-8 py-7">
      <header>
        <h1 className="text-title font-semibold text-ink">系统设置</h1>
        <p className="mt-1 text-caption text-ink-soft">维护个人资料、登录密码与在线设备。</p>
      </header>

      {error && (
        <Banner tone="error" onClose={() => setError(null)}>
          {error}
        </Banner>
      )}
      {notice && (
        <Banner tone="success" onClose={() => setNotice(null)}>
          {notice}
        </Banner>
      )}

      {/* ── 个人资料 ── */}
      <Panel title="个人资料" hint="用户名与角色由管理员维护，不可自行修改。">
        {!profile ? (
          <p className="py-6 text-center text-caption text-ink-faint">加载中…</p>
        ) : (
          <div className="flex items-start gap-5">
            <div className="flex w-[120px] shrink-0 flex-col items-center">
              {profile.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt="头像"
                  className="h-[72px] w-[72px] rounded-full object-cover"
                />
              ) : (
                <span className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-primary-50 text-primary-600">
                  <UserRound size={28} />
                </span>
              )}
              <button
                type="button"
                onClick={() => avatarRef.current?.click()}
                className="mt-2 text-caption text-primary-600 hover:underline"
              >
                更换头像
              </button>
              <span className="mt-0.5 text-[10px] text-ink-faint">PNG/JPG ≤ 350KB</span>
              <input
                ref={avatarRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => pickAvatar(e.target.files?.[0])}
              />
            </div>

            <div className="min-w-0 flex-1">
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-caption font-medium text-ink">用户名</span>
                  <input
                    value={profile.username}
                    disabled
                    className="mt-1.5 h-9 w-full rounded-lg border border-line bg-surface-sunken px-3 text-lead text-ink-faint"
                  />
                </label>
                <label className="block">
                  <span className="text-caption font-medium text-ink">角色</span>
                  <input
                    value={profile.role_label || profile.role}
                    disabled
                    className="mt-1.5 h-9 w-full rounded-lg border border-line bg-surface-sunken px-3 text-lead text-ink-faint"
                  />
                </label>
                <TextField label="显示姓名" value={displayName} onChange={setDisplayName} />
                <TextField label="部门" value={department} onChange={setDepartment} placeholder="如 运营中心" />
                <TextField label="邮箱" value={email} onChange={setEmail} placeholder="name@example.com" />
                <label className="block">
                  <span className="text-caption font-medium text-ink">最近登录</span>
                  <input
                    value={fmtDateTime(profile.last_login_at)}
                    disabled
                    className="mt-1.5 h-9 w-full rounded-lg border border-line bg-surface-sunken px-3 text-lead text-ink-faint"
                  />
                </label>
              </div>
              <div className="mt-3.5 flex items-center gap-2.5">
                <PrimaryButton
                  onClick={saveProfile}
                  loading={savingProfile}
                  disabled={!displayName.trim()}
                >
                  保存资料
                </PrimaryButton>
                {!displayName.trim() && <span className="text-[11px] text-ink-faint">显示姓名不能为空</span>}
              </div>
            </div>
          </div>
        )}
      </Panel>

      {/* ── 修改密码 ── */}
      <Panel title="登录密码" hint="修改成功后，其他所有登录设备会被自动下线。">
        <div className="grid grid-cols-3 gap-3">
          <TextField label="当前密码" type="password" value={oldPwd} onChange={setOldPwd} />
          <TextField label="新密码（≥6 位）" type="password" value={newPwd} onChange={setNewPwd} />
          <TextField label="确认新密码" type="password" value={confirmPwd} onChange={setConfirmPwd} />
        </div>
        {newPwd && confirmPwd && newPwd !== confirmPwd && (
          <p className="mt-2 text-caption text-danger">两次输入的新密码不一致。</p>
        )}
        <div className="mt-3.5 flex items-center gap-2.5">
          <PrimaryButton
            onClick={changePwd}
            loading={savingPwd}
            disabled={!oldPwd || newPwd.length < 6 || newPwd !== confirmPwd}
          >
            <Lock size={14} /> 修改密码
          </PrimaryButton>
          <span className="text-[11px] text-ink-faint">新密码至少 6 位</span>
        </div>
      </Panel>

      {/* ── 在线设备 ── */}
      <Panel
        title="在线设备"
        hint="当前账号仍然有效的登录会话；发现陌生设备请立即踢出并修改密码。"
        actions={
          sessions.filter((s) => !s.is_current).length > 0 ? (
            <PrimaryButton onClick={kickAll} className="bg-surface text-ink-soft hover:bg-surface-sunken hover:text-ink">
              退出其他设备
            </PrimaryButton>
          ) : undefined
        }
      >
        {sessions.length === 0 ? (
          <p className="py-6 text-center text-caption text-ink-faint">没有查询到有效会话。</p>
        ) : (
          <div className="space-y-2.5">
            {sessions.map((s) => (
              <div
                key={s.jti}
                className={cn(
                  'flex items-center justify-between gap-3 rounded-lg border px-4 py-3',
                  s.is_current ? 'border-primary-200 bg-primary-50/40' : 'border-line',
                )}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-ink-soft">
                    <Monitor size={15} />
                  </span>
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-lead text-ink">
                      <span className="truncate">{s.device_info || '未知设备'}</span>
                      {s.is_current && (
                        <span className="shrink-0 rounded-md bg-primary-100 px-1.5 py-0.5 text-[10px] text-primary-700">
                          本设备
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-[11px] text-ink-faint">
                      {s.ip_address || '未知 IP'} · 登录于 {fmtDateTime(s.created_at)} · {fmtRemain(s.expires_at)}
                    </p>
                  </div>
                </div>
                {!s.is_current &&
                  (pendingKick === s.jti ? (
                    <span className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => kick(s.jti)}
                        className="text-caption font-medium text-danger hover:underline"
                      >
                        确认踢出
                      </button>
                      <SubButton onClick={() => setPendingKick(null)}>取消</SubButton>
                    </span>
                  ) : (
                    <SubButton danger onClick={() => setPendingKick(s.jti)}>
                      踢出
                    </SubButton>
                  ))}
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-ink-faint">
          <ShieldAlert size={12} /> 会话记录保存在服务端，踢出后该设备的令牌立即失效。
        </p>
      </Panel>
    </div>
  );
}
