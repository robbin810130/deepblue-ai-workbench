// 调试版本：保存完整响应用于分析
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DIFY_API_KEY = process.env.DIFY_CHATFLOW_API_KEY;
const DIFY_API_URL = process.env.DIFY_CHATFLOW_API_URL;

const salesData = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'public', 'sales_analysis_matrix.json'), 'utf-8')
);

console.log('🔍 调试模式：将保存完整响应到文件\n');

try {
    const queryContent = JSON.stringify(salesData, null, 2);

    const response = await fetch(DIFY_API_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${DIFY_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            inputs: {
                userinput: {
                    query: queryContent
                }
            },
            query: queryContent,
            response_mode: 'streaming',
            conversation_id: '',
            user: 'system_forecast'
        })
    });

    if (!response.ok) {
        throw new Error(`API失败: ${response.status}`);
    }

    console.log('✅ API调用成功，读取响应...\n');

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
                        fullResponse += parsed.answer || '';
                    }
                } catch (e) {
                    // 忽略
                }
            }
        }
    }

    console.log(`✅ 响应接收完成，长度: ${fullResponse.length}字符\n`);

    // 保存完整响应
    const responsePath = path.join(__dirname, 'dify_response_debug.txt');
    fs.writeFileSync(responsePath, fullResponse, 'utf-8');
    console.log(`💾 完整响应已保存到: ${responsePath}\n`);

    // 尝试查找JSON
    console.log('🔍 分析JSON位置...\n');

    // 查找所有"forecast_results"出现的位置
    const regex = /"forecast_results"/g;
    let match;
    let occurrences = 0;
    while ((match = regex.exec(fullResponse)) !== null) {
        occurrences++;
        console.log(`  找到第${occurrences}个"forecast_results"，位置: ${match.index}`);
        console.log(`  前后文: ...${fullResponse.substring(Math.max(0, match.index - 50), match.index + 100)}...\n`);
    }

    console.log(`共找到 ${occurrences} 个"forecast_results"字段\n`);

    // 尝试提取JSON
    if (occurrences > 0) {
        console.log('尝试提取JSON对象...\n');

        const firstIndex = fullResponse.indexOf('"forecast_results"');
        let jsonStart = -1;

        // 向前找最近的{
        for (let i = firstIndex; i >= 0; i--) {
            if (fullResponse[i] === '{') {
                jsonStart = i;
                break;
            }
        }

        if (jsonStart !== -1) {
            console.log(`  找到JSON起始位置: ${jsonStart}`);
            console.log(`  起始字符: ${fullResponse.substring(jsonStart, jsonStart + 50)}...\n`);

            // 匹配对应的}
            let bracketCount = 0;
            let jsonEnd = -1;
            for (let i = jsonStart; i < fullResponse.length; i++) {
                if (fullResponse[i] === '{') bracketCount++;
                if (fullResponse[i] === '}') {
                    bracketCount--;
                    if (bracketCount === 0) {
                        jsonEnd = i;
                        break;
                    }
                }
            }

            if (jsonEnd !== -1) {
                const jsonText = fullResponse.substring(jsonStart, jsonEnd + 1);
                console.log(`  JSON结束位置: ${jsonEnd}`);
                console.log(`  JSON长度: ${jsonText.length}字符\n`);

                // 保存JSON
                const jsonPath = path.join(__dirname, 'extracted_json_debug.json');
                fs.writeFileSync(jsonPath, jsonText, 'utf-8');
                console.log(`💾 提取的JSON已保存到: ${jsonPath}\n`);

                try {
                    const jsonContent = JSON.parse(jsonText);
                    console.log('✅ JSON解析成功！\n');
                    console.log(`  顶层字段: ${JSON.stringify(Object.keys(jsonContent))}\n`);

                    if (jsonContent.forecast_results) {
                        console.log(`  forecast_results类型: ${Array.isArray(jsonContent.forecast_results) ? 'Array' : typeof jsonContent.forecast_results}`);
                        console.log(`  forecast_results长度: ${jsonContent.forecast_results.length}\n`);

                        if (jsonContent.forecast_results.length > 0) {
                            console.log(`  第一个元素: ${JSON.stringify(jsonContent.forecast_results[0], null, 2)}\n`);
                        }
                    }
                } catch (parseError) {
                    console.error(`❌ JSON解析失败: ${parseError.message}\n`);
                    console.log(`  JSON前100字符: ${jsonText.substring(0, 100)}`);
                }
            } else {
                console.log('  ⚠️ 未找到JSON结束位置');
            }
        } else {
            console.log('  ⚠️ 未找到JSON起始位置');
        }
    }

    console.log('\n🎉 调试完成！请检查保存的文件进行分析。');

} catch (error) {
    console.error('\n❌ 调试失败:', error.message);
    process.exit(1);
}
