#!/usr/bin/env bash
# 深蓝工作台 · 单命令升级脚本（随发行包分发，位于安装目录根）
#
# 用法:
#   ./upgrade.sh --package /path/to/deepblue-release-<ver>.tar.gz [--yes]
#
# 流程（部署方案 §四）:
#   预检 → 停服 → 备份（pg_dump + 代码，各保留 3 份）→ 白名单覆盖
#   → 起服 → 健康轮询 → 交付自检 → 任一环节失败自动回滚（代码 + 库）
#
# 覆盖白名单（绝不触碰 .env / logs/ / backups/ / .runtime.pid 等运行态资产）:
#   server/ dist/ node_modules/ migrations/ scripts/
#   package.json package-lock.json manifest.json CHANGELOG.md
#   runtime.sh upgrade.sh .env.example
#
# 可覆盖配置（环境变量）:
#   PG_DUMP_CMD   默认 "pg_dump"；Docker 部署可设为 "docker exec <容器> pg_dump"
#   PSQL_CMD      默认 "psql"；同上
#   HEALTH_TIMEOUT 健康轮询秒数，默认 90
set -euo pipefail

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$INSTALL_DIR"

PKG_PATH=""
ASSUME_YES=0
while [ $# -gt 0 ]; do
  case "$1" in
    --package) PKG_PATH="${2:-}"; shift 2 ;;
    --yes)     ASSUME_YES=1; shift ;;
    *) echo "[upgrade] 未知参数: $1"; exit 64 ;;
  esac
done

log()  { echo "[upgrade] $*"; }
die()  { echo "[upgrade] ❌ FATAL: $*" >&2; exit 1; }

# ---------- 0. 预检 ----------
[ -n "$PKG_PATH" ] || die "缺少 --package 参数"
[ -f "$PKG_PATH" ] || die "升级包不存在: $PKG_PATH"
command -v node >/dev/null || die "未找到 node（需 >= 18）"
[ -f "$INSTALL_DIR/.env" ] || die "缺少 .env（升级不覆盖 .env，首次安装请先放置）"
set -a; source "$INSTALL_DIR/.env"; set +a
[ -n "${DATABASE_URL:-}" ] || die ".env 缺少 DATABASE_URL"

PG_DUMP_CMD="${PG_DUMP_CMD:-pg_dump}"
PSQL_CMD="${PSQL_CMD:-psql}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-90}"
BACKUP_DIR="$INSTALL_DIR/backups"
WHITELIST=(server dist node_modules migrations scripts package.json package-lock.json manifest.json CHANGELOG.md runtime.sh upgrade.sh .env.example)

# 包内 manifest 预读
NEW_MANIFEST="$(tar -xzOf "$PKG_PATH" deepblue-workbench/manifest.json 2>/dev/null)" \
  || die "包内 manifest.json 读取失败（不是合法的发行包？）"
NEW_VER="$(echo "$NEW_MANIFEST" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).version))")"
OLD_VER="unknown"
[ -f "$INSTALL_DIR/manifest.json" ] && OLD_VER="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$INSTALL_DIR/manifest.json','utf8')).version)")"

log "════════════════════════════════════════"
log "升级: $OLD_VER → $NEW_VER"
log "安装目录: $INSTALL_DIR"
log "升级包: $PKG_PATH"
log "════════════════════════════════════════"
if [ "$ASSUME_YES" -ne 1 ]; then
  read -r -p "[upgrade] 确认执行升级? [y/N] " ans
  [ "$ans" = "y" ] || { log "已取消"; exit 0; }
fi

# DB 连通性预检（用安装目录自带 pg 驱动）
node -e "
  const { Client } = require('$INSTALL_DIR/node_modules/pg');
  const c = new Client({ connectionString: process.env.DATABASE_URL.replace(/[\"']/g, '') });
  c.connect().then(() => c.query('SELECT 1')).then(() => { console.log('[upgrade] DB 预检 OK'); return c.end(); })
   .catch(e => { console.error('[upgrade] DB 预检失败:', e.message); process.exit(1); });
" || die "DB 预检未通过"

TS="$(date +%Y%m%d-%H%M%S)"
PHASE="pre"
ROLLBACK_DB=""
ROLLBACK_CODE=""
ROLLING=0

rollback() {
  [ "$ROLLING" -eq 1 ] && return 0
  ROLLING=1
  echo ""
  log "升级失败（阶段: ${PHASE}），开始回滚 ..."
  rm -f "$INSTALL_DIR/upgrade.sh.new" 2>/dev/null || true
  bash "$INSTALL_DIR/runtime.sh" stop >/dev/null 2>&1 || { pkill -f "node server/server.js" 2>/dev/null || true; sleep 1; }
  if [ -n "$ROLLBACK_CODE" ] && [ -d "$ROLLBACK_CODE" ]; then
    log "回滚代码 ← $ROLLBACK_CODE"
    for item in server dist node_modules migrations scripts runtime.sh package.json package-lock.json manifest.json; do
      if [ -e "$ROLLBACK_CODE/$item" ]; then
        rm -rf "$INSTALL_DIR/$item"
        cp -R "$ROLLBACK_CODE/$item" "$INSTALL_DIR/$item"
      else
        rm -rf "$INSTALL_DIR/$item"   # 升级前不存在的目录，随回滚移除
      fi
    done
  fi
  if [ -n "$ROLLBACK_DB" ] && [ -f "$ROLLBACK_DB" ]; then
    log "回滚数据库 ← $ROLLBACK_DB"
    $PSQL_CMD "$DATABASE_URL" -q -f "$ROLLBACK_DB" || log "库回滚执行出错，请人工核查！"
  fi
  if bash "$INSTALL_DIR/runtime.sh" start >/dev/null 2>&1; then
    log "已回滚并恢复旧版服务"
  else
    # runtime.sh 本身可能已损坏——直接拉起兜底
    ( set -a; source "$INSTALL_DIR/.env"; set +a; nohup node server/server.js >> "$INSTALL_DIR/logs/server.log" 2>&1 & echo $! > "$INSTALL_DIR/.runtime.pid" )
    log "runtime.sh 异常，已直接拉起 node 进程兜底"
  fi
  echo "$TS FAIL phase=$PHASE pkg=$PKG_PATH" >> "$INSTALL_DIR/upgrades.log"
}

# EXIT 兜底：非零退出且已进入升级流程（非 pre/done）→ 自动回滚
# （die() 走 exit 不触发 ERR trap，必须用 EXIT trap；rollback 内部已防重入）
trap 'rc=$?; if [ "$rc" -ne 0 ] && [ "$ROLLING" -eq 0 ] && [ "$PHASE" != "pre" ] && [ "$PHASE" != "done" ]; then rollback; fi; exit $rc' EXIT

# ---------- 1. 停服 ----------
PHASE="stop"
log "停服 ..."
if [ -f "$INSTALL_DIR/runtime.sh" ]; then
  bash "$INSTALL_DIR/runtime.sh" stop || { pkill -f "node server/server.js" 2>/dev/null || true; sleep 1; }
else
  pkill -f "node server/server.js" 2>/dev/null && sleep 2 || true
fi

# ---------- 2. 备份 ----------
PHASE="backup"
mkdir -p "$BACKUP_DIR"

log "备份数据库 ..."
DB_BAK="$BACKUP_DIR/db-$TS.sql"
$PG_DUMP_CMD "$DATABASE_URL" --no-owner --no-privileges > "$DB_BAK" \
  || { ROLLBACK_DB="$DB_BAK"; die "pg_dump 失败"; }
grep -q "PostgreSQL database dump" "$DB_BAK" || { ROLLBACK_DB="$DB_BAK"; die "pg_dump 产物异常（无 dump 头）"; }
log "  → $DB_BAK ($(du -h "$DB_BAK" | cut -f1))"

log "备份代码 ..."
CODE_BAK="$BACKUP_DIR/code-$TS"
mkdir -p "$CODE_BAK"
for item in server dist node_modules migrations scripts runtime.sh package.json package-lock.json manifest.json; do
  [ -e "$INSTALL_DIR/$item" ] && cp -R "$INSTALL_DIR/$item" "$CODE_BAK/$item"
done
log "  → $CODE_BAK"
ROLLBACK_DB="$DB_BAK"      # 自此任何失败都可整库回滚
ROLLBACK_CODE="$CODE_BAK"  # 自此任何失败都可整代码回滚

# 各保留最近 3 份
ls -1dt "$BACKUP_DIR"/db-*.sql   2>/dev/null | tail -n +4 | xargs rm -f  2>/dev/null || true
ls -1dt "$BACKUP_DIR"/code-*     2>/dev/null | tail -n +4 | xargs rm -rf 2>/dev/null || true

# ---------- 3. 解包覆盖（白名单） ----------
PHASE="apply"
log "解包并覆盖 ..."
TMP="$INSTALL_DIR/.upgrade-tmp"
rm -rf "$TMP"; mkdir -p "$TMP"
tar -xzf "$PKG_PATH" -C "$TMP"
SRC="$TMP/deepblue-workbench"
[ -f "$SRC/manifest.json" ] || die "包结构异常（缺 deepblue-workbench/manifest.json）"
for item in "${WHITELIST[@]}"; do
  if [ "$item" = "upgrade.sh" ]; then continue; fi   # 自身延迟替换，见下
  if [ -e "$SRC/$item" ]; then
    rm -rf "$INSTALL_DIR/$item"
    cp -R "$SRC/$item" "$INSTALL_DIR/$item"
  fi
done
# ⚠️ 运行中的脚本不能被原地覆盖（bash 按偏移增量读文件，中途换内容=行为错乱）
#    先落 .new，脚本最后一行 mv 原子换入（rename 换 inode，对运行进程安全）
[ -f "$SRC/upgrade.sh" ] && cp "$SRC/upgrade.sh" "$INSTALL_DIR/upgrade.sh.new"
chmod +x "$INSTALL_DIR/runtime.sh" "$INSTALL_DIR/upgrade.sh" 2>/dev/null || true
rm -rf "$TMP"
log "覆盖完成（.env / logs / backups 未触碰）"

# ---------- 4. 起服 + 健康轮询 ----------
PHASE="start"
log "起服（runInitDDL 幂等吃掉本版全部 schema 变更）..."
bash "$INSTALL_DIR/runtime.sh" start

# ---------- 5. 交付自检 ----------
PHASE="verify"
log "交付自检 check-appliance-readiness ..."
set +e
node "$INSTALL_DIR/scripts/check-appliance-readiness.js"
RC=$?
set -e
if [ "$RC" -eq 0 ]; then
  log "自检: 就绪"
elif [ "$RC" -eq 2 ]; then
  log "自检: 有警告（不阻塞），请人工过目"
else
  log "自检阻塞（exit $RC），开始回滚 ..."
  exit 1   # EXIT trap 接管回滚
fi

# ---------- 完成 ----------
PHASE="done"
echo "$TS OK $OLD_VER -> $NEW_VER pkg=$(basename "$PKG_PATH")" >> "$INSTALL_DIR/upgrades.log"
log "════════════════════════════════════════"
log "升级完成: $OLD_VER → $NEW_VER"
log "备份: $DB_BAK | ${CODE_BAK}（保留最近 3 份）"
log "回滚方式: 停服后用 backups/ 内最近一份 code-* 覆盖 + psql -f 恢复 db-*.sql"
log "════════════════════════════════════════"

# 最后一步：换入新版 upgrade.sh（若有）。mv=rename 换 inode，对运行中进程安全
if [ -f "$INSTALL_DIR/upgrade.sh.new" ]; then
  mv -f "$INSTALL_DIR/upgrade.sh.new" "$INSTALL_DIR/upgrade.sh"
  chmod +x "$INSTALL_DIR/upgrade.sh"
fi
