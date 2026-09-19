# 深蓝工作台 · Dify 本地化打包方案

> **日期**：2026-09-19 ｜ **状态**：v1（盘点完成 + 导出工具就绪，实测待凭据）
> **定位**：appliance 一体机最大件——设备内置 Dify 实例（客户内网默认断网），
> 预置全部技能工作流 + 知识库 + 模型凭据，随出厂镜像烧录。
> 上游文档：`appliance部署方案.md` §六 遗留清单 #1。

---

## 一、现状盘点结论（2026-09-19 实测）

| 项 | 数值 | 来源 |
|---|---|---|
| 本地 Dify 实例 | Dify 1.14.2 @ http://localhost:8088（OrbStack `dify-agent` 项目） | dify-stack |
| 应用总数 | **56**（advanced-chat 37 / workflow 17 / agent-chat 1 / completion 1） | dify 库 `apps` |
| 带 workflow 的应用 | 54 | `workflows` 表 |
| 已发放 API token | 36 app token + 1 dataset token | `api_tokens` 表 |
| deepblue 侧 AI 绑定 | 42 个（含子绑定） | `server/modules/providers/bindings.js` |

**盘点产物**：`dify-bundle/app-inventory.json`（56 应用全量：id/name/mode/tokens/has_workflow）。
⚠️ 该文件含真实 token，仅存本地/出厂镜像，**不进 git**（已 gitignore）。

## 二、绑定 ↔ 应用 映射链路（已验证）

```
deepblue 绑定 env 值(如 app-0319...) = Dify api_tokens.token → app_id → apps.name
```

已验证样本：`DIFY_ORDER_RECOGNITION_API_KEY` = `api_tokens` 中「订单识别」应用的 token，完全吻合
（本地 dify 库即源服务器 39.108.221.22 的还原数据，token 表即源发放记录全集）。

**精确映射的取得方式**：需要源服务器上 deepblue 部署的 `.env`（42 个 `DIFY_*_API_KEY` 值），
与本地 `api_tokens` 做 join 即得逐绑定 → 应用映射。→ **待老大提供**（见 §七）。

## 三、打包物构成（dify-bundle/）

```
dify-bundle/
├── app-inventory.json        # 应用全量清单（含 token，敏感，不进 git）
├── dsls/                     # 逐应用 DSL 导出（include_secret=false）
│   ├── 01-深蓝AI_市场洞察.yml
│   └── ...
├── dsl-manifest.json         # 导出清单（app_id ↔ 文件名，无密钥，可进 git）
├── datasets/                 # 知识库导出（pipeline 待 §五）
├── model-credentials.md      # 模型供应商清单（仅列供应商/模型名，密钥现场注入）
└── binding-map.json          # 42 绑定 → 应用映射（待源 env join 后生成）
```

**随设备交付形态**：dify-bundle 不并入 deepblue 发行包（体积与敏感度原因），
由出厂镜像直接烧录到设备盘内 Dify 数据卷。

## 四、DSL 导出（工具已就绪，实测待凭据）

```bash
DIFY_CONSOLE_EMAIL=... DIFY_CONSOLE_PASSWORD=... \
  node scripts/export-dify-dsls.mjs            # 默认导出全部非 completion 应用
# 可选: --all 全量 / --only 关键词 / --base http://...
```

- 通道：Dify Console API（`POST /console/api/login` → `GET /console/api/apps/{id}/export/download?include_secret=false`）
- 凭据仅经环境变量传入，不落盘；DSL 本身 `include_secret=false` 不含模型密钥
- 登录失败分支已用假凭据实测（401 正确报错）；**真实导出待 console 凭据**（§七）

## 五、现场导入与凭据预置（设计）

1. **应用导入**：Dify 控制台 DSL 导入 API 逐个导入 `dsls/*.yml`（导入后 app_id 会变，
   依靠 `dsl-manifest.json` 的名称映射重建 `api_tokens` 并回填设备版 deepblue `.env`）。
2. **知识库**：`datasets/` 导入（知识库 API / 控制台导入，含分段与 Embedding 重建，
   需设备端模型就绪后执行）。⚠️ 工作流节点内的 `dataset_ids` 引用在导入后需按映射重写——
   复用 `generate_dsl.cjs` 的 DSL 改写经验做成批量步骤。
3. **模型凭据**：设备端「设置→模型供应商」预置通义/DeepSeek/火山方舟等凭据（客户授权
   或国产模型 API）；`.env` 内 `ARK_API_KEY` 等由现场填写，出厂镜像不含任何密钥。
4. **对齐纪律**：设备内 Dify 版本锁定 1.14.2（与开发环境同版），DSL schema 版本随导出文件
   自带；导入失败的应用按 manifest 逐一排查，不静默跳过。

## 六、与整体交付的衔接

```
出厂镜像 = OS + Docker/Node + Dify 1.14.2(容器+数据卷) + dify-bundle(烧录)
         + deepblue 发行包(deepblue-release-<ver>.tar.gz，见 appliance部署方案 §四)
首启流程 = Dify 起服 → 导入 DSL/知识库 → 预置模型凭据 → 生成 api_tokens 回填 .env
         → deepblue upgrade.sh 首装 → check-appliance-readiness 全绿
```

`check-appliance-readiness.js` 的「42 绑定 env 完整性」检查即现场导入完成度的验收关卡。

## 七、待办输入（需要老大）

| # | 需要什么 | 用途 | 阻塞点 |
|---|---|---|---|
| 1 | 本地 Dify console 账号密码（任一可登账号） | DSL 批量导出实测（§四脚本已就绪） | 导出未跑 |
| 2 | 源服务器 39.108.221.22 上 deepblue 的 `.env`（或仅 42 个 `DIFY_*_API_KEY` 值） | 与 api_tokens join → `binding-map.json` 精确映射 | 绑定映射未定 |
| 3 | 确认知识库清单（哪些 dataset 随设备走） | datasets/ 导出范围 | §五.2 未启动 |

## 八、后续工具排期

1. `scripts/import-dify-dsls.mjs`（现场批量导入 + token 重建 + dataset_ids 重写）
2. `scripts/export-dify-datasets.mjs`（知识库导出）
3. 出厂镜像构建（依赖硬件选型，§六 首启流程固化为一键脚本）

---

## 附：v2 实施结果（2026-09-19）

### ① DSL 全量导出 ✅
- `scripts/export-dify-dsls.mjs` 实测 **55/55 成功**（排除 completion 模式 1 个）→ `dify-bundle/dsls/`
- Dify 1.14 鉴权坑：登录密码字段需 **base64**（`FieldEncryption` 仅 base64 解码），token 走 httpOnly Cookie + `X-CSRF-Token` 头（不是 Bearer，头名带连字符）；导出端点为 `GET /apps/<id>/export?include_secret=false` 返回 JSON `{data: <yaml>}`（不是 /export/download）。

### ② 绑定 ↔ 应用映射（`scripts/gen-binding-map.mjs` → `dify-bundle/binding-map.json`）
| 置信度 | 数量 | 说明 |
|---|---|---|
| verified | 32 | env 真实值与 api_tokens/dataset-token 精确吻合（源：deepblue .env + 旧 webos 时代 `Dify智能体/dify/.env`） |
| draft-high | 3 | 语义别名推定（product_entry←BRAND_EXTRACT、internal←WORKFLOW），待确认 |
| non-dify | 2 | ai_image（火山方舟）、video_gen |
| 未映射 | 10 | review_partner×4、bid_assistant、enterprise_qualification、product_selection、product_library、invoice_verify、logistics_fee —— 老服务器上 env 值为空/PLACEHOLDER，真实 key **只在 Windows 生产 .env**（webos 生产跑在 Windows pm2，见 ecosystem.config.cjs），需老大提供 |

- 对账结论：9 个未认领 token 全部是 test/copy/停用应用，无泄漏风险；知识检索类绑定共用**唯一租户级 dataset token**（`dataset-ugmr...`），dataset 以 ID 引用（`DIFY_*_DATASET_ID`），现场导入后需重写。

### ③ 知识库清单（15 个，待圈定随设备范围）
| 知识库 | 文档数 | 字数 | 备注 |
|---|---|---|---|
| 深蓝智能公司制度 | 21 | 3.7万 | 正式 |
| 看板业务示例库 | 9 | 976万 | 正式（最大） |
| 物料编码.xlsx | 1/12 | 15.6万 | 正式 + 作废版 |
| 物料纠错记忆库 | 6 | 515 | 正式 |
| 法规test | 6 | 10.2万 | 测试 |
| 智能研发演示test | 4×2 | 2千 | 测试+作废 |
| 平台格式规范test | 1×2 | 339 | 测试+作废 |
| 东南亚美妆本地化词典test | 1×2 | 1073 | 测试+作废 |
| 东南亚文化营销规则test | 1×2 | 330 | 测试+作废 |
| 知识库导入自动分段test | 0 | 0 | 空库 |

全部 high_quality + 通义 multimodal-embedding-v1 → 打包必须含 tongyi 插件与 embedding 凭据。

### ④ 缺失 10 个 key 的影响评估（2026-09-19 定论：无阻塞）

老大确认 Windows 生产 .env 无法获取。**证据链**（api_tokens.last_used_at 活指纹 + 老服务器 env 现状）：
- 老服务器 env 里这 10 个绑定的值本来就是**空/PLACEHOLDER**（产品录入/选品/发票校验等 = 空，EQ 识别 = PLACEHOLDER）
- 对应候选应用（选品工作流、小程序/交易/点餐聚合页数据整理、财务侧发票×2、中标结果查询等）**在源 Dify 上没有 api_token 或 token 从未被调用**
- 结论：这 10 个绑定在源生产环境**本来就没启用**，Windows env 即使有值也不会有活跃调用痕迹

**处置**：binding-map 里标为 `inactive`（含证据字段）。新设备 .env 对这些绑定留空——与源现状完全一致，交付功能零损失；后续要用时在设备 Dify 上现发 token 填入即可。

**意外升级 2 个**：video_gen（DIFY_VIDEOGEN）、doc_copywriting（←DOC_DRAFTING 别名）在老 env 有真值，升级为 verified。最终：verified 32 / draft-high 3 / non-dify 1（ai_image）/ inactive 10 / 未知 0。

### ⑤ 知识库随设备范围（老大已拍板：作废与空库不带）

`dify-bundle/dataset-plan.json`：**9 带 6 排除**。
- ✅ 随设备（9）：深蓝智能公司制度(21)、看板业务示例库(9)、法规test(6)、物料纠错记忆库(6)、智能研发演示test(4)、平台格式规范test(1)、物料编码(1)、东南亚美妆本地化词典test(1)、东南亚文化营销规则test(1)
- ❌ 排除（6）：5 个「（作废）」+ 1 个空库（知识库导入自动分段test）
