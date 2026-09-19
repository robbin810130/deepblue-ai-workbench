#!/usr/bin/env bash
# 深蓝工作台 · 启停脚本（随发行包分发，位于安装目录根）
# 用法: ./runtime.sh start|stop|status|restart
# 依赖: node >= 18（健康检查用 node fetch，不依赖 curl）
set -uo pipefail

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$INSTALL_DIR"

PID_FILE="$INSTALL_DIR/.runtime.pid"
LOG_DIR="$INSTALL_DIR/logs"
LOG_FILE="$LOG_DIR/server.log"
HEALTH_PATH="${HEALTH_PATH:-/api/health}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-90}"

# 载入 .env（DATABASE_URL / SERVER_PORT / Dify 绑定键等）
if [ -f "$INSTALL_DIR/.env" ]; then
  set -a; source "$INSTALL_DIR/.env"; set +a
fi
PORT="${SERVER_PORT:-3001}"

running() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

healthy() {
  PORT="$PORT" HP="$HEALTH_PATH" node -e "
    const t = setTimeout(() => process.exit(2), 4000);
    fetch('http://127.0.0.1:' + process.env.PORT + process.env.HP)
      .then(r => process.exit(r.ok ? 0 : 1))
      .catch(() => process.exit(1));
  " 2>/dev/null
}

do_start() {
  if running; then
    echo "[runtime] 已在运行 (pid $(cat "$PID_FILE"))"
    return 0
  fi
  rm -f "$PID_FILE"
  mkdir -p "$LOG_DIR"
  echo "[runtime] 启动 server (port $PORT) ..."
  nohup node server/server.js >> "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  # 健康轮询
  local waited=0
  while [ "$waited" -lt "$HEALTH_TIMEOUT" ]; do
    if healthy; then
      echo "[runtime] ✅ 健康检查通过: http://127.0.0.1:$PORT$HEALTH_PATH (pid $(cat "$PID_FILE"))"
      return 0
    fi
    if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "[runtime] ❌ 进程已退出，最近日志:"; tail -n 30 "$LOG_FILE"; return 1
    fi
    sleep 2; waited=$((waited + 2))
  done
  echo "[runtime] ❌ ${HEALTH_TIMEOUT}s 内健康检查未通过，最近日志:"; tail -n 30 "$LOG_FILE"; return 1
}

do_stop() {
  if ! running; then
    echo "[runtime] 未在运行"
    rm -f "$PID_FILE"
    return 0
  fi
  local pid; pid="$(cat "$PID_FILE")"
  echo "[runtime] 停止 (pid $pid) ..."
  kill "$pid" 2>/dev/null
  local waited=0
  while kill -0 "$pid" 2>/dev/null && [ "$waited" -lt 20 ]; do
    sleep 1; waited=$((waited + 1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    echo "[runtime] 15s 未退出，强制 kill -9"
    kill -9 "$pid" 2>/dev/null
  fi
  rm -f "$PID_FILE"
  echo "[runtime] 已停止"
}

do_status() {
  if running; then
    local pid; pid="$(cat "$PID_FILE")"
    if healthy; then
      echo "[runtime] 运行中 (pid $pid, 健康 ✅)"
      return 0
    fi
    echo "[runtime] 进程存在 (pid $pid) 但健康检查未通过 ⚠️"
    return 2
  fi
  echo "[runtime] 未在运行"
  return 1
}

case "${1:-}" in
  start)   do_start ;;
  stop)    do_stop ;;
  restart) do_stop; do_start ;;
  status)  do_status ;;
  *) echo "用法: $0 start|stop|status|restart"; exit 64 ;;
esac
