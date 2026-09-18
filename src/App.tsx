import { useState, useEffect } from 'react';
import type { AppState } from './types';
import { LoginScreen } from './components/LoginScreen';
import { SystemInterface } from './components/SystemInterface';
import { SystemConfigCenter } from './components/SystemConfigCenter';
import { RoleProvider } from './context/RoleContext';

export default function WebOSApp() {
  const [appState, setAppState] = useState<AppState>(() => {
    return localStorage.getItem('blue_os_token') ? 'system' : 'login';
  });
  const [username, setUsername] = useState(() => {
    const token = localStorage.getItem('blue_os_token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        return payload.username || '';
      } catch (e) {
        return '';
      }
    }
    return '';
  });

  const handleLoginSuccess = (user: string) => {
    sessionStorage.removeItem('desktop_windows');
    sessionStorage.removeItem('desktop_focused_win');
    setUsername(user);
    setAppState('system');
  };

  const handleLogout = async () => {
    try {
      // 携带 Token 调用后端登出，吊销 JTI
      await fetch('/api/auth/logout', { 
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('blue_os_token')}` }
      });
    } catch (e) {
      console.warn('Logout API call failed', e);
    }
    setAppState('login');
    setUsername('');
    localStorage.removeItem('blue_os_token');
    sessionStorage.removeItem('desktop_windows');
    sessionStorage.removeItem('desktop_focused_win');
  };

  // 全局侦听 Token 失效
  useEffect(() => {
    const handleUnauthorized = () => {
      handleLogout();
    };
    window.addEventListener('auth-unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth-unauthorized', handleUnauthorized);
  }, []);

    // 已移除：此处原本存在的 beforeunload 登出信标会导致在多标签页下关闭一个标签页时，或者刷新页面时，误杀所有处于同一会话的登录状态。

  return (
    <div className="w-full h-screen bg-slate-50 overflow-hidden font-sans text-slate-800">
      {appState === 'login' ? (
        <LoginScreen onLogin={handleLoginSuccess} />
      ) : appState === 'system' ? (
        <RoleProvider>
          <SystemInterface username={username} onLogout={handleLogout} onEnterAdmin={() => setAppState('sysadmin')} />
        </RoleProvider>
      ) : (
        <SystemConfigCenter username={username} onExit={() => setAppState('system')} onLogout={handleLogout} />
      )}
    </div>
  );
}