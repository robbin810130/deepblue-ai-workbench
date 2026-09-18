# SME 铜平均价脚本

从 [SME 信息网](https://info.smechina.com.cn/)公开首页读取“铜”行的当日平均价，并以 JSON 输出，供其他程序调用。

## 环境与安装

需要 Windows 和 Python 3.14.2：

```powershell
python -m pip install -r requirements.txt
```

## 运行

```powershell
python sme_copper_price.py
```

成功时退出码为 `0`，标准输出示例：

```json
{"price": 109490, "unit": "元/吨", "product": "铜", "price_date": "2026-08-26", "source": "SME信息网", "fetched_at": "2026-08-26T12:00:00+08:00"}
```

`price` 是页面中铜行的“平均价”，不会由最高价和最低价自行计算。`price_date` 优先使用页面可识别的完整报价日期；当前首页仅显示更新时间时，使用上海时区的抓取日期。`fetched_at` 是实际抓取成功的时间。

失败时退出码为 `2`，标准错误会输出 JSON：

```json
{"error": {"code": "SOURCE_CHANGED", "message": "未找到铜报价行或平均价字段"}}
```

错误码包括：

- `NETWORK_ERROR`：连接或读取失败。
- `HTTP_ERROR`：网站返回非 2xx HTTP 状态。
- `SOURCE_CHANGED`：页面结构、铜行或平均价格式不符合预期。
- `UNEXPECTED_ERROR`：未预期的运行时异常。

## 使用边界

- 不需要、也不接受账号、密码、Cookie 或其他登录凭据。
- 脚本不负责定时运行、存储历史行情或批量采集；建议外部调用频率不高于每 5 分钟一次。
- 页面结构或站点规则变化后，脚本会失败而不会猜测价格；调用方应检查退出码和错误 JSON。

## 测试

```powershell
python -m pytest -v
```

测试使用本地 HTML 样本和模拟 HTTP 响应，不访问真实网站。
