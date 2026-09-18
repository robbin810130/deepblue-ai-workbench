# syntax=docker/dockerfile:1
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
