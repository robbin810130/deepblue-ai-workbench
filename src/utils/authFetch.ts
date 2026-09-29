import { handleUnauthorized } from '../api/client';

export const fetchWithAuth = async (url: string, options: RequestInit = {}) => {
    const token = localStorage.getItem('blue_os_token');

    const headers = {
        ...options.headers,
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };

    const response = await fetch(url, { ...options, headers });

    if (response.status === 401 || response.status === 403) {
        // 捕获到 Token 失效或被拒，抛出特定的错误以便顶层捕获退出登录
        localStorage.removeItem('blue_os_token');
        // 新界面（根路径）没有 'auth-unauthorized' 的监听者，需自行跳登录页（带回跳）；
        // /legacy 下由旧 App.tsx 监听下面这行事件切回登录视图，handleUnauthorized 会按兵不动。
        handleUnauthorized();
        window.dispatchEvent(new Event('auth-unauthorized'));
        throw new Error('授权已过期，请重新登录。');
    }

    return response;
};
