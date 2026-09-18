# WebOS backend（本机开发/测试专用覆盖版）
# ------------------------------------------------------------
# 与官方 docker/backend.Dockerfile 的差异，仅两处：
#   1. 删除首行 `# syntax=docker/dockerfile:1` —— 本机 BuildKit 无法从
#      Docker Hub 拉取 dockerfile frontend 镜像，会导致构建直接失败。
#   2. apt / pip 换用国内镜像源（阿里云）—— 加速 chromium 与 Python 依赖安装。
# 其余构建步骤与官方文件逐行一致，保证产物行为相同。
# ------------------------------------------------------------
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONIOENCODING=utf-8 \
    PATH="/opt/venv/bin:${PATH}"

WORKDIR /app

# Chromium + DrissionPage support the video-generation RPA feature. unixODBC
# supports the existing SQL Server customer-analysis script.
RUN set -eux; \
    sed -i 's|deb.debian.org|mirrors.aliyun.com|g; s|security.debian.org|mirrors.aliyun.com|g' \
        /etc/apt/sources.list.d/debian.sources 2>/dev/null || \
    sed -i 's|deb.debian.org|mirrors.aliyun.com|g; s|security.debian.org|mirrors.aliyun.com|g' \
        /etc/apt/sources.list 2>/dev/null || true; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        chromium \
        python3 \
        python3-pip \
        python3-venv \
        postgresql-client \
        unixodbc \
        unixodbc-dev; \
    python3 -m venv /opt/venv; \
    rm -rf /var/lib/apt/lists/*

COPY docker/python-requirements.txt /tmp/python-requirements.txt
RUN pip install --no-cache-dir \
        -i https://mirrors.aliyun.com/pypi/simple/ \
        --trusted-host mirrors.aliyun.com \
        -r /tmp/python-requirements.txt

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# These directories are bind-mounted by Compose in production. Creating them
# here also makes the image usable without Compose for diagnostics.
RUN mkdir -p \
    /app/logs \
    /app/tmp/uploads \
    /app/public/uploads \
    /app/uploads/enterprise-qualification \
    /app/server/storage/business-dashboards

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=5 \
    CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server/server.js"]
