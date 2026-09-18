// 最小化测试脚本 - 只测试API调用
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DIFY_API_KEY = process.env.DIFY_CHATFLOW_API_KEY;
const DIFY_API_URL = process.env.DIFY_CHATFLOW_API_URL;

// 最小测试数据（与Python示例完全一致）
const testData = {
    "monthly_matrix": [
        {
            "sku_id": 11165,
            "product_name": "360g淘吉椰果综合味布丁（蓝莓味+山竹味+芒果味）",
            "25.2": 471928.8,
            "25.3": 608433.6,
            "25.4": 758428.8,
            "25.5": 584743.2,
            "25.6": 451681.6,
            "25.7": 554874.4,
            "25.8": 438640.0,
            "25.9": 603451.2,
            "25.10": 189633.6,
            "25.11": 608138.4,
            "25.12": 418598.4,
            "26.1": 367368.0,
            "26.2": 0
        }
    ],
    "quarterly_matrix": [
        {
            "sku_id": 11165,
            "product_name": "360g淘吉椰果综合味布丁（蓝莓味+山竹味+芒果味）",
            "25-Q1": 1904726.4,
            "25-Q2": 1794853.6,
            "25-Q3": 1596965.6,
            "25-Q4": 1216370.4,
            "26-Q1": 367368.0
        }
    ],
    "meta_info": {
        "query_time": "2026-02-11 15:00:13",
        "sku_filter": "Top 80% Revenue Contributors",
        "value_unit": "Sales Amount (销售额)",
        "monthly_columns": [
            "25.2",
            "25.3",
            "25.4",
            "25.5",
            "25.6",
            "25.7",
            "25.8",
            "25.9",
            "25.10",
            "25.11",
            "25.12",
            "26.1",
            "26.2"
        ],
        "quarterly_columns": [
            "25-Q1",
            "25-Q2",
            "25-Q3",
            "25-Q4",
            "26-Q1"
        ]
    }
};

console.log('🧪 最小化测试 - 使用与Python完全相同的数据\n');

try {
    // 注意：USER_QUERY在Python中是字符串，不是对象
    const queryContent = JSON.stringify(testData, null, 2);

    const requestBody = {
        inputs: {
            userinput: {
                query: queryContent
            }
        },
        query: queryContent,
        response_mode: 'streaming',
        user: 'dev_user',  // Python中用的是dev_user
        conversation_id: ''
    };

    console.log('📡 发送请求...\n');

    const response = await fetch(DIFY_API_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${DIFY_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
    });

    console.log(`状态码: ${response.status}\n`);

    if (!response.ok) {
        const errorText = await response.text();
        console.log('错误响应:');
        console.log(errorText);
        throw new Error(`API请求失败: ${response.status}`);
    }

    console.log('✅ 请求成功！\n');
    console.log('读取流式响应...\n');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullResponse = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(line => line.trim());

        for (const line of lines) {
            if (line.startsWith('data: ')) {
                const data = line.substring(6);
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.event === 'message' || parsed.event === 'agent_message') {
                        process.stdout.write(parsed.answer || '');
                        fullResponse += parsed.answer || '';
                    } else if (parsed.event === 'message_end') {
                        console.log('\n\n[Done]');
                    }
                } catch (e) {
                    // 忽略
                }
            }
        }
    }

    // 尝试提取JSON
    const jsonMatch = fullResponse.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
        console.log('\n\n=== 提取的JSON ===');
        console.log(jsonMatch[1]);
    }

} catch (error) {
    console.error('\n❌ 测试失败:', error.message);
    process.exit(1);
}
