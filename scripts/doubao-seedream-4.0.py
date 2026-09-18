import os
import base64
from volcenginesdkarkruntime import Ark
from volcenginesdkarkruntime.types.images.images import SequentialImageGenerationOptions
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

# 辅助函数：将本地图片转换为包含 Data URI 前缀的 Base64 编码
def encode_image_to_base64(image_path):
    """
    读取本地图片并转换为标准的 Data URI 格式 Base64 字符串。
    """
    if not os.path.exists(image_path):
        raise FileNotFoundError(f"找不到本地图片文件: {image_path}")

    # 获取文件后缀名以确定 MIME 类型
    ext = os.path.splitext(image_path)[1].lower().replace('.', '')
    if ext == 'jpg': ext = 'jpeg'
    mime_type = f"image/{ext}" if ext in ['png', 'jpeg', 'jpg', 'webp'] else "image/png"

    with open(image_path, "rb") as image_file:
        # 读取二进制数据并转为 base64 字符串
        encoded_string = base64.b64encode(image_file.read()).decode('utf-8')
        # 拼接标准 Data URI 前缀
        return f"data:{mime_type};base64,{encoded_string}"

# 初始化 Ark 客户端
client = Ark(
    base_url="https://ark.cn-beijing.volces.com/api/v3",
    api_key=os.getenv("ARK_API_KEY"),
)

# 1. 指定本地图片路径列表（支持单张或多张）
# 如果只有一张： [r"C:\path\to\image1.jpg"]
# 如果有多张： [r"C:\path\to\image1.jpg", r"C:\path\to\image2.jpg"]
local_image_paths = [
    r"C:\Users\db\Desktop\衣服.jpg",
    # r"C:\Users\db\Desktop\衣服细节.jpg" # 如果有多张，取消注释并添加路径即可
]

try:
    # 2. 批量调用转换函数，生成 Base64 列表
    base64_images = [encode_image_to_base64(path) for path in local_image_paths]

    # 3. 发起请求
    # 注意：如果 base64_images 只有一个元素，API 也能识别；如果是多个元素，则作为参考图集合
    imagesResponse = client.images.generate(
        model="doubao-seedream-4-0-250828",
        prompt="""
请根据我提供的产品参考图，严格生成 3 张高清实拍质感图片，要求风格统一、光线自然、细节清晰、无水印、无多余文字、真实质感：
1、产品侧面图：纯白背景，侧面平视拍摄，完整展示产品侧面轮廓
2、国内模特上身效果图：简约室内场景，自然光，亚洲模特，自然穿搭，全身展示上身效果
3、国外模特上身效果图：简约室内场景，自然光，欧美模特，自然穿搭，全身展示上身效果

商业摄影，自然光，柔和光影，细节丰富，色彩真实，无畸变，专业电商实拍
        """,
        # 传入 base64 列表或单张字符串
        image=base64_images if len(base64_images) > 1 else base64_images[0],
        sequential_image_generation="auto",
        sequential_image_generation_options=SequentialImageGenerationOptions(max_images=5),
        response_format="url",
        size="2K",
        stream=True,
        watermark=True
    )

    # 4. 处理流式响应
    for event in imagesResponse:
        if event is None:
            continue
        if event.type == "image_generation.partial_failed":
            print(f"生成部分失败: {event.error}")
            if event.error and event.error.code == "InternalServiceError":
                break
        elif event.type == "image_generation.partial_succeeded":
            if event.error is None and event.url:
                print(f"收到图片 - 尺寸: {event.size}, URL: {event.url}")
        elif event.type == "image_generation.completed":
            if event.error is None:
                print("生成任务已完成。")
                print("消耗统计:", event.usage)

except Exception as e:
    print(f"发生错误: {e}")