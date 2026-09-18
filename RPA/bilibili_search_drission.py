from DrissionPage import ChromiumPage
import time
import json
import os
import random
import subprocess

# @flow_node
def launch_and_search(keyword):
    """
    title: 启动浏览器并搜索
    description: 启动浏览器，访问B站并搜索关键词 %keyword%，最后切换到搜索结果页面并按最多播放排序。
    inputs:
        - keyword(str): 搜索关键词
    outputs:
        - search_page(ChromiumTab): 搜索结果页面对象
    """
    page = ChromiumPage()
    
    print(f"正在启动浏览器并搜索关键词: {keyword}")
    # @step 访问B站主页
    page.get("https://www.bilibili.com")
    time.sleep(random.uniform(1, 2))
    
    # @step 在搜索框输入关键词并按下回车
    search_input = page.ele('.nav-search-input')
    if search_input:
        search_input.input(keyword)
        search_input.input('\n') # 按回车
        time.sleep(random.uniform(2, 3))
    
    # @step 切换到搜索结果标签页
    # B站搜索通常会打开新标签页
    search_page = page.get_tab(url='search.bilibili.com')
    
    # @step 点击最多播放进行排序
    print("正在按最多播放排序...")
    sort_btn = search_page.ele('text:最多播放')
    if sort_btn:
        sort_btn.click()
        time.sleep(random.uniform(2, 3))
    
    return search_page

# @flow_node
def scrape_bilibili_data(search_page, max_pages, limit=None):
    """
    title: 循环抓取视频数据
    description: 在 %search_page% 中循环抓取最多 %max_pages% 页的视频数据，支持设置最大条数限制 %limit%。
    inputs:
        - search_page(ChromiumTab): 搜索结果页面对象
        - max_pages(int): 最大抓取页数
        - limit(int): 最大抓取条数
    outputs:
        - all_data(list): 抓取到的视频数据列表
    """
    all_data = []
    
    for current_page in range(1, max_pages + 1):
        print(f"正在抓取第 {current_page} / {max_pages} 页数据...")
        
        # @step 等待页面列表加载并获取数据
        # 初始等待页面加载已经在外部处理，此处减少不必要的循环内等待
        cards = search_page.eles('.bili-video-card__wrap')
        
        for card in cards:
            try:
                # 使用更精准的 CSS 选择器或相对路径
                title_ele = card.ele('tag:h3', timeout=1)
                link_ele = card.ele('.bili-video-card__info--right').ele('tag:a', timeout=1)
                
                # 使用更精准且更快的 XPath 相对路径
                # 尝试匹配多种可能的结构，包括用户提供的 span[1]/span[2]
                author_ele = card.ele('xpath:.//span[contains(@class, "author")] | .//a/span[1]', timeout=0.5)
                date_ele = card.ele('xpath:.//span[contains(@class, "date")] | .//a/span[2]', timeout=0.5)

                title = title_ele.text if title_ele else "未知标题"
                
                video_url = ""
                if link_ele:
                    href = link_ele.attr('href')
                    if href:
                        video_url = href if href.startswith("http") else f"https:{href}"
                
                author = author_ele.text if author_ele else "未知作者"
                pub_date = date_ele.text if date_ele else "未知时间"
                
                item = {
                    "标题": title.strip(),
                    "链接": video_url,
                    "作者": author.strip(),
                    "发布时间": pub_date.strip()
                }
                all_data.append(item)
                print(f"已抓取: {item['标题'][:20]}... 链接: {item['链接']}")
                
                if limit and len(all_data) >= limit:
                    print(f"已达到抓取上限 {limit} 条，停止抓取。")
                    return all_data
            except Exception as e:
                print(f"抓取卡片数据时出错: {e}")
            
        # @step 判断是否需要翻页抓取
        if current_page < max_pages:
            next_btn = search_page.ele('text:下一页')
            if next_btn and next_btn.is_enabled():
                next_btn.click()
                time.sleep(3)
            else:
                print("未发现下一页按钮或已禁用，停止抓取。")
                break
                
# @flow_node
def save_to_json(data, filename="bilibili_results.json"):
    """
    title: 保存数据为 JSON
    description: 将抓取到的数据保存为 JSON 文件 %filename%，如果文件已存在则更新。
    inputs:
        - data(list): 视频数据列表
        - filename(str): 保存的文件路径
    """
    # 确保保存路径正确（相对于脚本所在目录）
    script_dir = os.path.dirname(os.path.abspath(__file__))
    file_path = os.path.join(script_dir, filename)
    
    try:
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=4)
        print(f"数据已成功保存至: {file_path}")
    except Exception as e:
        print(f"保存 JSON 文件时出错: {e}")

def run_extract_skill(url):
    """调用外部 skill 提取详细数据"""
    # 获取 pipeline.py 的绝对路径
    script_dir = os.path.dirname(os.path.abspath(__file__))
    pipeline_path = os.path.join(script_dir, "..", "skills", "bilibili-episode-extract", "pipeline.py")
    pipeline_path = os.path.normpath(pipeline_path)
    
    print(f"正在分析视频: {url}")
    
    # 构造命令
    cmd = [
        "python",
        pipeline_path,
        "--args",
        json.dumps({"url": url})
    ]
    
    try:
        # 核心：使用二进制捕获，避免 Windows 编码崩溃
        result = subprocess.run(cmd, capture_output=True, check=False)
        
        def safe_decode(b):
            if not b: return ""
            # 尝试 GBK (Windows) 和 UTF-8 (通用)
            for enc in ['gbk', 'utf-8', 'utf-16']:
                try:
                    return b.decode(enc)
                except: continue
            return b.decode('utf-8', errors='ignore')

        stdout = safe_decode(result.stdout)
        if result.returncode == 0:
            try:
                # 提取输出中的最后一行 JSON（防止混入其他打印信息）
                lines = [l.strip() for l in stdout.splitlines() if l.strip().startswith('{')]
                if lines:
                    return json.loads(lines[-1])
                return {"status": "error", "message": "未找到 JSON 格式输出"}
            except Exception as e:
                return {"status": "error", "message": f"解析失败: {e}, 输出内容: {stdout}"}
        else:
            return {"status": "error", "message": safe_decode(result.stderr)}
    except Exception as e:
        return {"status": "error", "message": str(e)}

def process_video_batch(video_list, search_page):
    """循环处理视频列表，带风控和模拟操作"""
    detailed_results = []
    
    for i, video in enumerate(video_list):
        # 1. 模拟人工操作：在搜索页滚动一下
        print(f"正在模拟人工操作（滚动页面）...")
        search_page.scroll.down(random.randint(300, 600))
        time.sleep(random.uniform(1, 3))
        
        # 2. 调用 Skill 提取数据
        res = run_extract_skill(video['链接'])
        
        # 3. 监控返回码和风控
        if res.get('status') == 'error' or res.get('subtitle', {}).get('status') == 'error':
            msg = res.get('message', '') or res.get('subtitle', {}).get('message', '')
            if '请求过于频繁' in msg or '-412' in msg:
                print("\n[！！！严重警告！！！]")
                print(f"触发 B 站风控 (代码 -412 或频繁)。已停止所有脚本。")
                print("请务必等待至少 1 小时后再试。")
                return detailed_results, True
        
        # 4. 整理并存储数据
        # 提取 BVID 用于定位文件夹
        bvid = res.get('bvid')
        if not bvid and '/' in video['链接']:
            bvid = video['链接'].strip('/').split('/')[-1]
            
        work_dir = res.get('work_dir', '')
        if work_dir and work_dir.startswith('\\'):
            work_dir = 'D:' + work_dir
        
        # 强制兜底路径：如果路径不存在，根据 BVID 拼接
        if not work_dir or not os.path.exists(os.path.normpath(work_dir)):
            if bvid:
                work_dir = os.path.join("D:\\workspace\\.bilibili-work", bvid)
            
        if work_dir:
            work_dir = os.path.normpath(work_dir)
            summary_file = os.path.join(work_dir, "summary.json")
            content_file = os.path.join(work_dir, "content.txt")
            
            # 读取分析结果
            if os.path.exists(summary_file):
                try:
                    with open(summary_file, 'r', encoding='utf-8') as sf:
                        summary_data = json.load(sf)
                        video['AI总结'] = summary_data.get('summary', '')
                        video['视频大纲'] = summary_data.get('outline', [])
                    print(f"  [成功] 已合并分析数据 ({bvid})")
                except Exception as e:
                    print(f"  [错误] 读取总结失败: {e}")
            
            # 读取文案/字幕
            if os.path.exists(content_file):
                content = ""
                for enc in ['utf-8', 'gbk', 'utf-16']:
                    try:
                        with open(content_file, 'r', encoding=enc) as cf:
                            content = cf.read()
                            if content: break
                    except: continue
                if content:
                    video['文案/字幕'] = content
                    print(f"  [成功] 已合并字幕文案")
        else:
            print(f"  [警告] 无法定位视频数据目录，跳过内容合并")
        
        detailed_results.append(video)
        print(f"视频 {i+1}/{len(video_list)} 处理完成。")
        
        # 5. 休息与等待逻辑
        if i < len(video_list) - 1:
            if (i + 1) % 5 == 0:
                rest_time = random.uniform(120, 300)
                print(f"\n已完成一批 (5个)，休息 {rest_time:.1f} 秒...")
                time.sleep(rest_time)
            else:
                wait_time = random.uniform(20, 30)
                print(f"等待下一条 ({wait_time:.1f} 秒)...")
                time.sleep(wait_time)
                
    return detailed_results, False

if __name__ == "__main__":
    keyword = "美妆出海"  # AI 自动化
    
    # 1. 启动并搜索
    results_tab = launch_and_search(keyword)
    # 获取浏览器对象以便最终关闭
    browser = results_tab.browser
    
    try:
        # 2. 抓取第一页的前 10 个视频链接
        print(f"正在抓取搜索结果列表...")
        video_list = scrape_bilibili_data(results_tab, max_pages=1, limit=3)
        
        if not video_list:
            print("未抓取到视频列表，请检查关键词或网络。")
        else:
            # 3. 循环处理并提取详细信息 (带风控逻辑)
            print(f"\n开始循环提取详细信息（共 {len(video_list)} 个视频）...")
            final_data, is_risk = process_video_batch(video_list, results_tab)
            
            # 4. 保存最终结果
            save_to_json(final_data, "bilibili_detailed_results.json")
            
            if is_risk:
                print("\n任务因风控强制终止。")
            else:
                print(f"\n所有任务完成，共获取并分析了 {len(final_data)} 条数据。")
    finally:
        # 5. 无论成功还是异常，都关闭浏览器
        try:
            browser.quit()
            print("\n浏览器已关闭。")
        except Exception as e:
            print(f"\n关闭浏览器时出现异常（可忽略）：{e}")

