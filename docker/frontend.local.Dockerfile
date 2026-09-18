# WebOS frontend（本机开发/测试专用覆盖版）
# ------------------------------------------------------------
# 与官方 docker/frontend.Dockerfile 的差异，仅一处：
#   删除首行 `# syntax=docker/dockerfile:1` —— 本机 BuildKit 无法从
#   Docker Hub 拉取 dockerfile frontend 镜像，会导致构建直接失败。
# 其余（含 dist.next-release → nginx 静态目录的路径）与官方完全一致。
# ------------------------------------------------------------
FROM node:22-bookworm-slim AS build

WORKDIR /app
ARG VITE_APP_TITLE=深智蓝智能体平台软件
ARG VITE_DSH_EMBED_URL=
ENV VITE_APP_TITLE=${VITE_APP_TITLE} \
    VITE_DSH_EMBED_URL=${VITE_DSH_EMBED_URL}
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist.next-release /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
