"""
generate_image.py - Doubao 图生图脚本（供 server.js spawn 调用）

用法：
    python generate_image.py
    通过 stdin 传入 JSON：{"prompt": "提示词", "images": ["data:image/jpeg;base64,..."]}

每张图片就绪时向 stdout 输出一行 JSON：
    {"type":"partial","url":"https://...","index":1}
全部完成时输出：
    {"type":"complete","total":3}
出错时输出：
    {"type":"error","message":"..."}
"""

import sys
import os
import json
from dotenv import load_dotenv

# 加载 .env（与 server.js 同目录）
load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

def main():
    # 从 stdin 读取所有数据（prompt + 图片 base64）
    try:
        stdin_data = sys.stdin.buffer.read()
        payload = json.loads(stdin_data.decode('utf-8'))
        prompt = payload.get('prompt', '')
        images = payload.get('images', [])
        size = payload.get('size', '2K')
        if size not in ('2K', '4K'):
            size = '2K'
    except Exception as e:
        print(json.dumps({"type": "error", "message": f"读取stdin失败: {e}"}, ensure_ascii=False))
        sys.stdout.flush()
        sys.exit(1)

    if not prompt:
        print(json.dumps({"type": "error", "message": "未收到提示词"}, ensure_ascii=False))
        sys.stdout.flush()
        sys.exit(1)

    if not images:
        print(json.dumps({"type": "error", "message": "未收到图片数据"}, ensure_ascii=False))
        sys.stdout.flush()
        sys.exit(1)

    api_key = os.getenv('ARK_API_KEY')
    if not api_key or api_key == '请填入你的ARK_API_KEY':
        print(json.dumps({"type": "error", "message": "ARK_API_KEY 未配置，请在 .env 文件中填写"}, ensure_ascii=False))
        sys.stdout.flush()
        sys.exit(1)

    try:
        from volcenginesdkarkruntime import Ark
        from volcenginesdkarkruntime.types.images.images import SequentialImageGenerationOptions
    except ImportError:
        print(json.dumps({"type": "error", "message": "缺少依赖：请执行 pip install volcengine-python-sdk[ark]"}, ensure_ascii=False))
        sys.stdout.flush()
        sys.exit(1)

    try:
        client = Ark(
            base_url="https://ark.cn-beijing.volces.com/api/v3",
            api_key=api_key,
        )

        image_param = images if len(images) > 1 else images[0]

        response = client.images.generate(
            model="doubao-seedream-4-0-250828",
            prompt=prompt,
            image=image_param,
            sequential_image_generation="auto",
            sequential_image_generation_options=SequentialImageGenerationOptions(max_images=10),
            response_format="url",
            size=size,
            stream=True,
            watermark=False
        )

        count = 0
        for event in response:
            if event is None:
                continue
            if event.type == "image_generation.partial_succeeded":
                if event.error is None and event.url:
                    count += 1
                    print(json.dumps({
                        "type": "partial",
                        "url": event.url,
                        "index": count
                    }, ensure_ascii=False))
                    sys.stdout.flush()
            elif event.type == "image_generation.partial_failed":
                err_msg = str(event.error) if event.error else "未知错误"
                print(json.dumps({"type": "partial_failed", "message": err_msg}, ensure_ascii=False))
                sys.stdout.flush()
                if event.error and getattr(event.error, 'code', '') == 'InternalServiceError':
                    break
            elif event.type == "image_generation.completed":
                print(json.dumps({"type": "complete", "total": count}, ensure_ascii=False))
                sys.stdout.flush()

    except Exception as e:
        print(json.dumps({"type": "error", "message": str(e)}, ensure_ascii=False))
        sys.stdout.flush()
        sys.exit(1)


if __name__ == "__main__":
    main()
