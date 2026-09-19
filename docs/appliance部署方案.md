# 深蓝工作台 · Appliance 一体化部署方案

> **日期**：2026-09-19 ｜ **状态**：v1（准备阶段成果）
> **商业模式**：系统 + 本地化部署硬盘设备（appliance 一体机），部署进客户内网
> **前置定案**：D2 = 单租户强化（`存量表整合方案_XO07.md` §D2）；D5 许可证暂搁置

---

## 一、部署形态与架构边界

```
┌─ 客户内网（一台设备 = 一个完整实例）─────────────────┐
│  硬盘设备                                            │
│  ├─ 深蓝工作台 Node 服务（本仓库构建产物）             │
│  ├─ PostgreSQL 16（库内 48+ 张表，首次启动自建）       │
│  ├─ Dify 实例 + 技能工作流（⚠️ 必须本地化，见 §2）     │
│  └─ 日志/文件存储（logs/ + 暂存文件目录）              │
└──────────────────────────────────────────────────────┘
```

**关键架构决策：Dify 必须随设备本地化。**
当前开发环境的 Dify 在远端（39.108.221.22），生产 appliance 模式下客户内网
大概率完全断网 —— 42 个 AI 绑定全部指向的 Dify 地址必须指向设备内本机实例。
设备内 Dify 需预置全部技能工作流 + 模型凭据（通义/DeepSeek 等，走客户授权
或国产模型 API）。

## 二、交付自洽性（已达成 ✅）

| 能力 | 状态 | 依据 |
|---|---|---|
| 全新库一键建表 | ✅ | `runInitDDL` 54 条语句 `safeDDL` 逐条幂等容错（`4625070`）；实测空库起服自动建出 48 张表 |
| 根基表自洽 | ✅ | `sys_users`/`sys_roles` 补齐建表 DDL（历史手工表断链已修） |
| 存量库平滑升级 | ✅ | 全部 `ADD COLUMN IF NOT EXISTS` 幂等列对齐（P1/P2/P3） |
| 交付自检工具 | ✅ | `scripts/check-appliance-readiness.js`（见 §3） |

## 三、交付自检脚本（出厂/现场必跑）

```bash
node scripts/check-appliance-readiness.js        # 人读报告
node scripts/check-appliance-readiness.js --json # 供产线工具消费
```

检查项：Node 版本、DB 连通、14 张关键表、42+ AI 绑定 env 完整性（不泄露密钥）、
试点开关清单、日志目录可写。退出码：0 就绪 / 1 阻塞 / 2 警告。

**出厂流程**：空库 → 首次启动（自动建全表）→ 跑自检 → 「就绪=true」为出厂条件。

## 四、升级包机制（已实施 ✅，2026-09-19）

### 打包（发布侧）
```bash
node scripts/build-release.mjs [--version 1.2.0] [--skip-build] [--out <dir>]
# 产物: release/deepblue-release-<ver>.tar.gz（+ .sha256 校验文件）
# 内容: server/（排除 test_/check_ 杂物）+ dist/ + node_modules（npm ci --omit=dev，
#       按 package-lock sha 缓存于 .release-cache/）+ migrations/ + 自检脚本
#       + manifest.json + runtime.sh + upgrade.sh + .env.example
```

### 现场安装与升级（交付侧）
```bash
# 首次安装: 解包 → 放 .env（DATABASE_URL/SERVER_PORT/绑定键）→ ./runtime.sh start
./runtime.sh start|stop|status|restart   # .runtime.pid 管理 + node fetch 健康轮询
./upgrade.sh --package /path/to/deepblue-release-<ver>.tar.gz [--yes]
```

### 升级流程（单命令，失败自动回滚）
停服 → 备份（`pg_dump` 整库 + 代码目录，各保留最近 3 份于 `backups/`）→
白名单覆盖（`server/ dist/ node_modules/ migrations/ scripts/ package*.json manifest.json
CHANGELOG.md runtime.sh upgrade.sh .env.example`；**绝不触碰 .env / logs / backups**）→
起服（`runInitDDL` 幂等吃掉全部 schema 变更）→ 健康轮询 → 交付自检 →
任一环节非零退出（EXIT trap）→ 自动回滚：恢复代码备份（含 runtime.sh）+ `psql -f` 整库恢复 +
重启，并记 `upgrades.log FAIL`；成功记 `OK`。

### 迁移纪律（不变）
所有 schema 变更必须幂等（`IF NOT EXISTS` / `ON CONFLICT`），随 `runInitDDL` 或启动期 ensure
执行——不引入独立迁移框架，保持零依赖。

### 实施中定型的防坑设计
1. **upgrade.sh 不得原地覆盖自身**：bash 按字节偏移增量读脚本，apply 中途换内容=行为错乱
   （实测曾致「变量 unbound」等灵异报错）。新版先落 `upgrade.sh.new`，脚本最后一行 `mv`
   原子换入（rename 换 inode，对运行中进程安全）。
2. **runtime.sh 必须进代码备份清单**：否则坏包替换它后回滚无法恢复（升级/回滚的 stop
   均依赖它）；stop 另有 `pkill` 兜底，rollback 的 start 有直接 nohup 拉起兜底。
3. **回滚登记时机**：pg_dump 与代码备份完成后立即登记 `ROLLBACK_DB/CODE`，自此任何失败
   均可整体回滚；`die()` 走 `exit` 不触发 ERR trap，兜底必须用 EXIT trap。
4. **测试环境 Docker 通道**：宿主机无 pg_dump 时，`PG_DUMP_CMD`/`PSQL_CMD` 可指向 shim
   （`docker exec` + URL 端口改写 + `-f` 文件转 stdin）；生产 appliance 本机自带 PG 工具链。

**端到端演练已通过**：打包 v1 → 全新安装起服 → 升级 v2（健康+自检+OK 入账）→
坏包攻击（假 runtime.sh）→ 自动回滚恢复 → 服务健康。

## 五、远程运维通道（方案，待实施）

客户内网设备**默认不出网**，运维通道按优先级：

| 通道 | 用途 | 说明 |
|---|---|---|
| 现场升级包 | 版本升级 | U 盘/客户代拷，`upgrade.sh` 单命令 |
| 受控出网（可选） | 远程诊断 | 客户白名单放行设备 → 我方运维端点；匿名使用统计（可关） |
| 日志导出包 | 售后排查 | 一键打包 logs/ + 自检报告 + 脱敏配置清单，客户发给售后 |

## 六、遗留清单（按优先级）

1. **Dify 本地化打包**：设备内 Dify（含 56 技能工作流导入、模型凭据预置）——最大件，需单独排期
2. ~~upgrade.sh + manifest 打包脚本~~（✅ 已实施，见 §4）
3. **D5 许可证/激活**（已搁置，售卖临近立项）
4. `.env.example` 与 42 绑定 env 清单对齐（自检脚本的 `--json` 已能给缺项清单）
5. 出厂镜像制作（OS + Docker/Node + 本仓库产物，依赖硬件选型）
