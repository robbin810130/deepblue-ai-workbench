import React, { useState, useEffect } from 'react';
import { Eye, EyeOff, Loader2, User, Lock } from 'lucide-react';
import { BrandMark } from './brand/BrandMark';
import { APP_TITLE } from '../config';
import { consumeLoginRedirect } from '../api/client';

interface LoginScreenProps {
  onLogin: (user: string) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin }) => {
  const [formData, setFormData] = useState({ username: '', password: '' });
  const [errors, setErrors] = useState({ username: '', password: '' });
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [time, setTime] = useState(new Date());
  const [mounted, setMounted] = useState(false);
  const [rememberPwd, setRememberPwd] = useState(false);
  // 从 /next 被踢回来时会带 ?redirect=，登录后自动回跳；此处仅用于文案提示
  const [willReturnToNext, setWillReturnToNext] = useState(false);

  useEffect(() => {
    setMounted(true);
    setWillReturnToNext(consumeLoginRedirect() !== null);
    const t = setInterval(() => setTime(new Date()), 1000);

    // 初始化时检查并载入已保存的密码与账号
    const savedUser = localStorage.getItem('blue_os_username');
    const savedPwd = localStorage.getItem('blue_os_password');
    if (savedUser) {
      setFormData(prev => ({ ...prev, username: savedUser }));
    }
    if (savedPwd) {
      setFormData(prev => ({ ...prev, password: savedPwd }));
      setRememberPwd(true);
    }

    return () => clearInterval(t);
  }, []);

  const validate = () => {
    let isValid = true;
    const newErrors = { username: '', password: '' };
    if (!formData.username) { newErrors.username = '请输入账号'; isValid = false; }
    else if (formData.username.length < 3) { newErrors.username = '账号格式不正确'; isValid = false; }
    if (!formData.password) { newErrors.password = '请输入密码'; isValid = false; }
    else if (formData.password.length < 6) { newErrors.password = '密码至少需要 6 位'; isValid = false; }
    setErrors(newErrors);
    return isValid;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: formData.username, password: formData.password })
      });

      let data;
      try {
        data = await res.json();
      } catch (e) {
        throw new Error('服务器响应异常，请确保已重启后端 server.js 服务');
      }

      if (res.ok && data.success) {
        // 账号必存
        localStorage.setItem('blue_os_username', formData.username);
        // 保存真正的 Token
        if (data.data?.token) {
          localStorage.setItem('blue_os_token', data.data.token);
        }
        // 密码按需存取
        if (rememberPwd) {
          localStorage.setItem('blue_os_password', formData.password);
        } else {
          localStorage.removeItem('blue_os_password');
        }
        onLogin(data.data.username);
        // 通知 RoleContext 刷新角色权限（token 已写入 localStorage）
        window.dispatchEvent(new CustomEvent('user-logged-in'));
        // 从 /next 被踢来登录的，登录后整页回跳新版工作台（否则会落在旧桌面系统）
        const back = consumeLoginRedirect();
        if (back) {
          window.location.href = back;
        }
      } else {
        const msg = data.code === 'SESSION_LIMIT_REACHED' 
          ? '登录失败：账号已达 5 台设备登录上限。请在客户端手动退出后再试。'
          : (data?.message || '登录失败');
        setErrors(prev => ({ ...prev, password: msg }));
      }
    } catch (err: any) {
      setErrors(prev => ({ ...prev, password: err.message || '网络请求失败，请稍后再试' }));
    } finally {
      setIsLoading(false);
    }
  };

  const hourStr = time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const dateStr = time.toLocaleDateString('zh-CN', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="w-full h-full relative overflow-hidden flex flex-col items-center justify-center select-none">
      {/* ── 深色渐变背景 ── */}
      <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, #0a0f1e 0%, #0f172a 40%, #1a0a2e 100%)' }} />

      {/* ── 动态光晕 ── */}
      <div className="absolute" style={{ width: 600, height: 600, top: '5%', left: '10%', background: 'radial-gradient(circle, rgba(99,102,241,0.22) 0%, transparent 65%)', filter: 'blur(40px)', animation: 'pulseOrb1 8s ease-in-out infinite' }} />
      <div className="absolute" style={{ width: 500, height: 500, bottom: '10%', right: '10%', background: 'radial-gradient(circle, rgba(139,92,246,0.2) 0%, transparent 65%)', filter: 'blur(40px)', animation: 'pulseOrb2 10s ease-in-out infinite' }} />
      <div className="absolute" style={{ width: 400, height: 400, top: '30%', right: '20%', background: 'radial-gradient(circle, rgba(59,130,246,0.15) 0%, transparent 65%)', filter: 'blur(50px)', animation: 'pulseOrb1 12s ease-in-out infinite reverse' }} />

      {/* ── 网格纹理 ── */}
      <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.8) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.8) 1px, transparent 1px)', backgroundSize: '48px 48px' }} />

      <style>{`
        @keyframes pulseOrb1 { 0%,100%{transform:scale(1) translate(0,0);opacity:0.8} 50%{transform:scale(1.15) translate(30px,-20px);opacity:1} }
        @keyframes pulseOrb2 { 0%,100%{transform:scale(1) translate(0,0);opacity:0.7} 50%{transform:scale(1.2) translate(-25px,30px);opacity:1} }
        @keyframes slideUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
        .login-anim-1 { animation: slideUp 0.6s cubic-bezier(0.16,1,0.3,1) 0.1s both; }
        .login-anim-2 { animation: slideUp 0.6s cubic-bezier(0.16,1,0.3,1) 0.2s both; }
        .login-anim-3 { animation: slideUp 0.6s cubic-bezier(0.16,1,0.3,1) 0.35s both; }
        .login-input::placeholder { color: rgba(255,255,255,0.3); }
        .login-input:focus { outline: none; border-color: rgba(99,102,241,0.8); box-shadow: 0 0 0 3px rgba(99,102,241,0.2), 0 0 20px rgba(99,102,241,0.15); }
        .login-input:-webkit-autofill { -webkit-box-shadow: 0 0 0 100px rgba(15,23,42,0.9) inset; -webkit-text-fill-color: rgba(255,255,255,0.9); }
      `}</style>

      {/* ── macOS 风格大时钟 ── */}
      <div className={`relative z-10 text-center mb-10 ${mounted ? 'login-anim-1' : 'opacity-0'}`}>
        <div
          className="font-thin text-white tabular-nums leading-none"
          style={{ fontSize: 'clamp(72px, 10vw, 96px)', letterSpacing: '-0.02em', textShadow: '0 0 40px rgba(99,102,241,0.4)' }}
        >
          {hourStr}
        </div>
        <div className="text-base text-white/50 mt-3 font-light tracking-widest">{dateStr}</div>
      </div>

      {/* ── 玻璃态登录卡 ── */}
      <div
        className={`relative z-10 w-full max-w-[360px] mx-4 ${mounted ? 'login-anim-2' : 'opacity-0'}`}
        style={{
          background: 'rgba(255,255,255,0.07)',
          backdropFilter: 'blur(32px) saturate(180%)',
          WebkitBackdropFilter: 'blur(32px) saturate(180%)',
          border: '1px solid rgba(255,255,255,0.13)',
          borderRadius: 24,
          boxShadow: '0 24px 64px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.12)',
          padding: '36px 32px',
        }}
      >
        {/* Logo + 标题 */}
        <div className="text-center mb-8">
          <BrandMark
            size={64}
            className="mx-auto mb-4 drop-shadow-[0_8px_24px_rgba(31,88,232,0.5)]"
          />
          <h1 className="text-lg font-semibold text-white/90 leading-snug">{APP_TITLE}</h1>
          <p className="text-white/40 text-xs mt-1.5">
            {willReturnToNext ? '登录后将自动返回新版工作台' : '输入账号与密码以继续'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 账号 */}
          <div>
            <div className="relative">
              <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
              <input
                type="text"
                className="login-input w-full pl-10 pr-4 py-3 rounded-xl text-sm text-white/90"
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: `1px solid ${errors.username ? 'rgba(239,68,68,0.7)' : 'rgba(255,255,255,0.12)'}`,
                  transition: 'border-color 0.2s, box-shadow 0.2s',
                }}
                placeholder="账号 / 手机号 / 邮箱"
                autoComplete="username"
                value={formData.username}
                onChange={e => {
                  setFormData({ ...formData, username: e.target.value });
                  if (errors.username) setErrors({ ...errors, username: '' });
                }}
              />
            </div>
            {errors.username && (
              <p className="text-red-400 text-[11px] mt-1.5 ml-1 flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-red-400 inline-block" />
                {errors.username}
              </p>
            )}
          </div>

          {/* 密码 */}
          <div>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
              <input
                type={showPassword ? 'text' : 'password'}
                className="login-input w-full pl-10 pr-11 py-3 rounded-xl text-sm text-white/90"
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: `1px solid ${errors.password ? 'rgba(239,68,68,0.7)' : 'rgba(255,255,255,0.12)'}`,
                  transition: 'border-color 0.2s, box-shadow 0.2s',
                }}
                placeholder="密码"
                autoComplete="current-password"
                value={formData.password}
                onChange={e => {
                  setFormData({ ...formData, password: e.target.value });
                  if (errors.password) setErrors({ ...errors, password: '' });
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {errors.password && (
              <p className="text-red-400 text-[11px] mt-1.5 ml-1 flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-red-400 inline-block" />
                {errors.password}
              </p>
            )}
          </div>

          {/* 记住密码 */}
          <div className="flex items-center text-xs">
            <label className="flex items-center gap-2 text-white/40 cursor-pointer hover:text-white/60 transition-colors">
              <input
                type="checkbox"
                checked={rememberPwd}
                onChange={e => setRememberPwd(e.target.checked)}
                className="rounded border-white/20 bg-white/10 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-0"
              />
              记住密码
            </label>
          </div>

          {/* 登录按钮 */}
          <button
            type="submit"
            disabled={isLoading || !formData.username || !formData.password}
            className="w-full py-3 rounded-xl font-semibold text-sm text-white transition-all flex items-center justify-center gap-2 mt-2"
            style={{
              background: isLoading || !formData.username || !formData.password
                ? 'rgba(255,255,255,0.08)'
                : 'linear-gradient(135deg, #3b82f6 0%, #6366f1 50%, #8b5cf6 100%)',
              boxShadow: isLoading || !formData.username || !formData.password
                ? 'none'
                : '0 4px 20px rgba(99,102,241,0.4)',
              color: isLoading || !formData.username || !formData.password ? 'rgba(255,255,255,0.25)' : 'white',
              cursor: isLoading || !formData.username || !formData.password ? 'not-allowed' : 'pointer',
            }}
          >
            {isLoading ? (
              <>
                <Loader2 className="animate-spin w-4 h-4" />
                正在进入系统...
              </>
            ) : '解锁工作空间'}
          </button>
        </form>
      </div>

    </div>
  );
};