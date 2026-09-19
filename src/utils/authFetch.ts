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
        // /next 新版工作台没有 'auth-unauthorized' 的监听者，需自行跳登录页（带回跳）
        handleUnauthorized();
        window.dispatchEvent(new Event('auth-unauthorized'));
        throw new Error('授权已过期，请重新登录。');
    }

    return response;
};
