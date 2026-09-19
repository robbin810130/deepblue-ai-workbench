module.exports = {
    apps: [
        {
            name: "blue-os-server",
            script: "./server/server.js",
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: "1G",
            env: {
                NODE_ENV: "production",
            },
            // 支持通过 pm2 start ecosystem.config.cjs --env teamA 启动不同的环境
            env_production: {
                NODE_ENV: "production",
                SERVER_PORT: 8081,
                // 业务看板永久访问地址前缀（拼进 view_url，浏览器可达）
                APP_BASE_URL: "http://stdeepblue.eicp.net:8081",
                // Dify「发布到业务看板」内部令牌（Dify 工作流 HTTP 节点 Header X-Internal-Token 需配同一值）
                DASHBOARD_PUBLISH_TOKEN: "OwSgcKOORZnrYSbOgqulvFGrchxTwbYPiLcQuuOGjil",
                // D4 试点：存量路由 → 任务中心迁移桥（空 = 全走旧直连路径）
                TASK_CENTER_PILOT: "invoice_verify,quote_verify",
                // 订单识别（order_recognition，advanced-chat）：指向生产 Dify 实例的应用 API 密钥
                DIFY_ORDER_RECOGNITION_API_URL: "http://39.108.221.22/v1",
                DIFY_ORDER_RECOGNITION_API_KEY: "REPLACE_WITH_PRODUCTION_DIFY_APP_KEY",
                // 可选：AI 看板 HTML 存储目录（默认 server/storage/business-dashboards，建议移到数据盘）
                // DASHBOARD_STORAGE_DIR: "C:\\webos-data\\business-dashboards",
            },
            env_teamA: {
                NODE_ENV: "production",
                // 可以在这里显式指定使用哪个 .env 文件（需配合 dotenv 使用，或在脚本中读取环境变量）
                // SERVER_PORT: 3001,
            },
            env_teamB: {
                NODE_ENV: "production",
                // SERVER_PORT: 3002,
            },
            error_file: "./logs/pm2-err.log",
            out_file: "./logs/pm2-out.log",
            log_date_format: "YYYY-MM-DD HH:mm Z"
        },
        {
            // 将 WebOS 本机 13080 安全地转发到远端 DSH 的本机 3080。
            name: "dsh-ssh-tunnel",
            script: "C:\\Windows\\System32\\OpenSSH\\ssh.exe",
            args: "-N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o StrictHostKeyChecking=yes -i C:\\Users\\CN\\.ssh\\id_ed25519_dsh_gateway -L 127.0.0.1:13080:127.0.0.1:3080 root@39.108.221.22",
            interpreter: "none",
            instances: 1,
            autorestart: true,
            watch: false,
            max_restarts: 10,
            restart_delay: 5000,
            error_file: "./logs/dsh-tunnel-err.log",
            out_file: "./logs/dsh-tunnel-out.log",
            log_date_format: "YYYY-MM-DD HH:mm Z"
        }
    ]
};
