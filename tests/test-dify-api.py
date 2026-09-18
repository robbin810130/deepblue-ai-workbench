import requests
import json


def call_dify_chatflow(api_key, query_content, user_id="dev_user"):
    """
    针对 Dify Chatflow 的流式调用函数
    """
    url = "http://39.108.221.22/v1/chat-messages"

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    # 构造请求体
    # 注意：根据你的设置，变量路径为 userinput.query
    data = {
        "inputs": {
            "userinput": {
                "query": query_content
            }
        },
        "query": query_content,  # Chatflow 通常仍需传 query 触发对话
        "response_mode": "streaming",
        "user": user_id,
        "conversation_id": ""  # 持续对话时填入返回的 ID
    }

    try:
        response = requests.post(url, headers=headers, json=data, stream=True)

        if response.status_code != 200:
            print(f"Error: {response.status_code}\n{response.text}")
            return

        full_response = ""
        for line in response.iter_lines():
            if line:
                line_str = line.decode('utf-8')
                if line_str.startswith("data: "):
                    payload = json.loads(line_str[6:])
                    event = payload.get("event")

                    # 处理文本流
                    if event in ["message", "agent_message"]:
                        answer = payload.get("answer", "")
                        print(answer, end="", flush=True)
                        full_response += answer

                    # 结束标志
                    elif event == "message_end":
                        print("\n\n[Done]")
                        
                        # 提取JSON
                        import re
                        json_match = re.search(r'```json\s*([\s\S]*?)\s*```', full_response)
                        if json_match:
                            print("\n\n=== 提取的JSON ===")
                            print(json_match.group(1))

    except Exception as e:
        print(f"Request Error: {e}")


# --- 读取完整销售数据 ---
import os
import sys

# 读取sales_analysis_matrix.json
script_dir = os.path.dirname(os.path.abspath(__file__))
data_path = os.path.join(script_dir, 'public', 'sales_analysis_matrix.json')

with open(data_path, 'r', encoding='utf-8') as f:
    sales_data = json.load(f)

API_KEY = "app-qzYDRqRuN5fmoebA0msxuYeq"
USER_QUERY = json.dumps(sales_data, ensure_ascii=False, indent=2)

print(f"📦 总SKU数: {len(sales_data['monthly_matrix'])}\n")
print("=" * 70)
print("📡 调用Dify API进行全量预测...\n")

if __name__ == "__main__":
    call_dify_chatflow(API_KEY, USER_QUERY)
