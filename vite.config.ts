import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// [https://vitejs.dev/config/](https://vitejs.dev/config/)
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(), // 必须添加这个插件，样式才会生效
  ],
  server: {
    port: 8090,
    host: "0.0.0.0", // 强制监听 IPv4 所有地址，解决 IPv6 优先级问题
    allowedHosts: ["stdeepblue.eicp.net"],
    strictPort: true, // 如果端口被占用，直接报错而不是尝试下一个
    proxy: {
      "/api": {
        target: process.env.VITE_BACKEND_URL || "http://localhost:3001",
        changeOrigin: true,
        secure: false,
        timeout: 1800000,
        proxyTimeout: 1800000,
      },
      "/uploads": {
        target: process.env.VITE_BACKEND_URL || "http://localhost:3001",
        changeOrigin: true,
      },
    },
    watch: {
      ignored: [
        "**/logs/**",
        "**/tmp/**",
        "**/public/uploads/**",
        "**/public/*.json",
        "**/*.log"
      ],
    },
  },
  // 预览产物（用于重构期间「构建前后像素级比对」，运行环境与生产构建一致）
  preview: {
    port: 8091,
    host: "0.0.0.0",
    strictPort: true,
    proxy: {
      "/api": {
        target: process.env.VITE_BACKEND_URL || "http://localhost:3001",
        changeOrigin: true,
        secure: false,
      },
      "/uploads": {
        target: process.env.VITE_BACKEND_URL || "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  // 构建写入临时目录；启动脚本会在服务停止后整体切换为 dist，避免 Windows 文件锁。
  build: {
    outDir: 'dist.next-release',
    emptyOutDir: true,
  },
});
