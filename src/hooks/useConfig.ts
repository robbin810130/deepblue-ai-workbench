// src/hooks/useConfig.ts
// 统一从 /api/config/:type 加载基础资料选项的 React Hook
import { useState, useEffect } from 'react';
import { fetchWithAuth } from '../utils/authFetch';

interface UseConfigResult<T> {
    data: T[];
    loading: boolean;
    error: string | null;
}

export function useConfig<T = Record<string, any>>(
    type: string,
    moduleFilter?: string
): UseConfigResult<T> {
    const [data, setData] = useState<T[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        const url = moduleFilter
            ? `/api/config/${type}?module=${moduleFilter}`
            : `/api/config/${type}`;

        fetchWithAuth(url)
            .then(res => {
                if (!res.ok) {
                    throw new Error(`网络或接口错误: ${res.status}`);
                }
                return res.json();
            })
            .then(json => {
                if (!cancelled) {
                    if (json.success) {
                        setData(json.data);
                        setError(null);
                    } else {
                        throw new Error(json.message || '加载配置失败');
                    }
                }
            })
            .catch(err => {
                if (!cancelled) {
                    console.error("加载配置失败:", url, err);
                    setError(err.message);
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => { cancelled = true; };
    }, [type, moduleFilter]);

    return { data, loading, error };
}

/** 便捷：加载新闻关键词分组 */
export function useNewsKeywords() {
    const { data, loading, error } = useConfig<{
        id: number;
        group_name: string;
        keyword: string;
        sort_order: number;
        creator?: string;
    }>('news_keywords');

    // 将平铺数组聚合为分组结构: { [group_name]: string[] }
    const grouped = data.reduce<Record<string, string[]>>((acc, row) => {
        if (!row.keyword) return acc;
        const group = row.group_name || '其他';
        if (!acc[group]) acc[group] = [];
        
        const keywordStr = String(row.keyword || '');
        const splitWords = keywordStr.split(/[\/、,，]+/).map(k => k.trim()).filter(k => k !== '');
        
        for (const word of splitWords) {
            if (!acc[group].includes(word)) {
                acc[group].push(word);
            }
        }
        return acc;
    }, {});

    return { data, grouped, loading, error };
}
