# DSH 工作台部署说明

## 架构

DSH 保持在 `39.108.221.22`，仅监听其本机 `127.0.0.1:3080`。WebOS 所在电脑通过 SSH 隧道连接它，并在本机 Nginx 的 `8082` 端口提供受登录保护的访问入口：

`stdeepblue.eicp.net:8082` → 花生壳/eicp → WebOS 本机 Nginx → SSH 隧道 → DSH `127.0.0.1:3080`

这样 DSH 和 WebOS 对浏览器来说均位于 `stdeepblue.eicp.net`，可以安全复用 WebOS 登录 Cookie；端口不同不会影响 Cookie。

## 本机环境变量

WebOS 的 `.env` 需包含：

```env
DSH_ACCESS_SECRET=<使用高强度随机字符串>
DSH_COOKIE_SECURE=false
# 保持为空或不设置。当前 WebOS 和 DSH 使用相同主机名、不同端口。
DSH_COOKIE_DOMAIN=
VITE_DSH_EMBED_URL=http://stdeepblue.eicp.net:8082
```

未来 WebOS 与 DSH 均改为 HTTPS 后，再把 `DSH_COOKIE_SECURE` 改为 `true`，并将两个地址更新为 `https`。

## DSH 服务器配置

DSH 服务启动参数须信任 WebOS 嵌入来源：

```bash
dsh web --host 127.0.0.1 --port 3080 --trusted-host stdeepblue.eicp.net:8082 --no-open
```

不要开放服务器的 `3080` 或 `8082` 端口。

## WebOS 本机配置

1. 安装并启动 Windows Nginx，将 `deploy/nginx/dsh-workbench.conf` 作为 Nginx 主配置文件。
2. 使用 PM2 守护 SSH 隧道进程（`dsh-ssh-tunnel`），将本机 `127.0.0.1:13080` 转发到 DSH 服务器的 `127.0.0.1:3080`。
3. 在花生壳/eicp 中创建映射：外网 `stdeepblue.eicp.net:8082` → 本机 `127.0.0.1:8082`。

## 验证顺序

1. 本机访问 `http://127.0.0.1:8082`，未登录时应返回 401。
2. 登录 `http://stdeepblue.eicp.net:8081` 后，从桌面打开“DSH 工作台”。
3. 确认对话、会话和流式输出正常。
4. 确认公网无法连接 `39.108.221.22:3080`。

## 上线限制

DSH 原生 Web UI 不是用户级多租户隔离系统：本方案仅实现 WebOS 登录访问门禁与受限的独立工作目录；如果需要每位用户完全隔离会话、工作区和模型凭据，需要后续部署独立 DSH 实例或专门的多租户网关。
