#!/usr/bin/env bash
# 深蓝工作台 · 本地开发一键启动（macOS / Linux）
#
# 为什么需要它：
#   1) 本机有两份**同源代码**（dify / deepblue-workbench），vite 都配 8090 且 strictPort，
#      8090 常被另一半占用；3001 又被 Docker 旧镜像容器占着。
#   2) 那个旧镜像**不含 /api/v1 路由**（场景/技能/任务/文件/通知/权限），
#      前端走它只会拿到 {"error":"API not found"} → 页面显示为空。
#
# 做法：用**当前源码**跑后端（3901，连真实业务库 dify_memory）+ 前端 dev server（8092，
#      /api 代理指向 3901）。这样 /next 新界面才有真实数据。
#
# 用法:
#   ./scripts/dev-local.sh                 # 前端 8092 + 后端 3901
#   FRONTEND_PORT=3002 ./scripts/dev-local.sh
#   Ctrl+C 一起停
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BACKEND_PORT="${BACKEND_PORT:-3901}"
FRONTEND_PORT="${FRONTEND_PORT:-8092}"
CRED_CONTAINER="${CRED_CONTAINER:-dify-agent-webos-backend}"
PG_HOST_PORT="${PG_HOST_PORT:-9800}"
DB_NAME="${DB_NAME:-dify_memory}"

# ── 1. 取凭据 ────────────────────────────────────────────────────────
# 优先复用已运行后端容器的 DATABASE_URL 密码与 JWT_SECRET。
# JWT_SECRET 必须与旧后端一致，否则既有登录态/已签发 token 全部 401。
PG_PW=""
JWT_SECRET=""
if docker inspect "$CRED_CONTAINER" >/dev/null 2>&1; then
    ENVS="$(docker inspect "$CRED_CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null)"
    PG_PW="$(printf '%s\n' "$ENVS" | sed -n 's|^DATABASE_URL=postgresql://[^:]*:\([^@]*\)@.*|\1|p' | head -1)"
    JWT_SECRET="$(printf '%s\n' "$ENVS" | sed -n 's|^JWT_SECRET=||p' | head -1)"
fi
# 回退：仓库 .env / 已导出环境变量
if [ -f "$ROOT/.env" ]; then
    set -a; source "$ROOT/.env"; set +a
fi

PG_PW="${PG_PW:-${PG_PASSWORD:-}}"
JWT_SECRET="${JWT_SECRET:-}"
DB_NAME="${DB_NAME:-${PG_DATABASE:-dify_memory}}"

if [ -z "$PG_PW" ]; then
    echo "❌ 拿不到数据库密码。" >&2
    echo "   请确认容器 ${CRED_CONTAINER} 在运行，或手动导出 PG_PASSWORD。" >&2
    exit 1
fi

# ── 2. 端口占用自检（避免误连到别的实例）────────────────────────────
for P in "$BACKEND_PORT" "$FRONTEND_PORT"; do
    if lsof -nP -iTCP:"$P" -sTCP:LISTEN >/dev/null 2>&1; then
        echo "❌ 端口 ${P} 已被占用，请先停掉或换端口（BACKEND_PORT= / FRONTEND_PORT=）。" >&2
        lsof -nP -iTCP:"$P" -sTCP:LISTEN | tail -2 >&2
        exit 1
    fi
done

export DATABASE_URL="postgresql://postgres:${PG_PW}@127.0.0.1:${PG_HOST_PORT}/${DB_NAME}"
export JWT_SECRET

echo "🔧 深蓝工作台 · 本地开发环境"
echo "   后端  http://127.0.0.1:${BACKEND_PORT}   （库 ${DB_NAME} @ ${PG_HOST_PORT}）"
echo "   前端  http://localhost:${FRONTEND_PORT}/next/"
echo
echo "   首次打开请先访问 http://localhost:${FRONTEND_PORT}/ 登录，"
echo "   再进入 /next/（新界面复用旧登录态，跨端口不会共享）。"
echo "   Ctrl+C 停止全部。"
echo

# ── 3. 启动 ──────────────────────────────────────────────────────────
SERVER_PORT="$BACKEND_PORT" node server/server.js &
BE_PID=$!

VITE_BACKEND_URL="http://127.0.0.1:${BACKEND_PORT}" npx vite --port "$FRONTEND_PORT" &
FE_PID=$!

cleanup() {
    echo
    echo "⏹  正在停止…"
    kill "$BE_PID" "$FE_PID" 2>/dev/null
    wait 2>/dev/null
}
trap cleanup EXIT INT TERM

wait
