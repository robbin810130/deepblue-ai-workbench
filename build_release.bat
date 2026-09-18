@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

:: =====================================================
::   深蓝企业智慧中枢 - 一键打包发布脚本
::   用法: 双击运行 build_release.bat
:: =====================================================

:: 版本号（每次发包前修改这里）
set VERSION=v1.0.0
set BUILD_DATE=%DATE:~0,4%%DATE:~5,2%%DATE:~8,2%
set PACKAGE_NAME=deep-blue-os-%VERSION%-%BUILD_DATE%
set OUTPUT_DIR=..\%PACKAGE_NAME%

echo.
echo =====================================================
echo   深蓝企业智慧中枢 打包工具
echo   版本: %VERSION%   日期: %BUILD_DATE%
echo =====================================================
echo.

:: ── 第1步：构建前端 ──────────────────────────────────
echo [1/5] 正在构建前端 (npm run build)...
call npm run build
if %errorLevel% neq 0 (
    echo [ERROR] 前端构建失败，请检查代码后重试！
    pause
    exit /b 1
)
echo [OK] 前端构建完成，产物在 dist.next-release\ 文件夹
echo.

:: ── 第2步：创建输出目录 ──────────────────────────────
echo [2/5] 创建打包目录: %OUTPUT_DIR%
if exist "%OUTPUT_DIR%" rd /s /q "%OUTPUT_DIR%"
mkdir "%OUTPUT_DIR%"
mkdir "%OUTPUT_DIR%\frontend"
mkdir "%OUTPUT_DIR%\backend"
mkdir "%OUTPUT_DIR%\backend\server"
mkdir "%OUTPUT_DIR%\config"
mkdir "%OUTPUT_DIR%\database\init"
mkdir "%OUTPUT_DIR%\database\seed"
mkdir "%OUTPUT_DIR%\docs"
echo [OK] 目录结构创建完成
echo.

:: ── 第3步：复制前端产物 ─────────────────────────────
echo [3/5] 打包前端文件...
xcopy /E /I /Q dist.next-release "%OUTPUT_DIR%\frontend\dist"
echo [OK] 前端文件复制完成
echo.

:: ── 第4步：复制后端文件（排除敏感和无关文件）─────────
echo [4/5] 打包后端文件（排除 node_modules）...

:: 复制 package.json 和配置文件
copy package.json "%OUTPUT_DIR%\backend\"
copy ecosystem.config.cjs "%OUTPUT_DIR%\backend\"
copy start_pm2.bat "%OUTPUT_DIR%\backend\"
copy start_production.bat "%OUTPUT_DIR%\backend\"
if exist setup_firewall.bat copy setup_firewall.bat "%OUTPUT_DIR%\backend\"

:: 复制 server 目录（核心后端代码）
xcopy /E /I /Q server "%OUTPUT_DIR%\backend\server"

:: 复制数据库脚本
xcopy /E /I /Q database\*.sql "%OUTPUT_DIR%\database\init\"
if exist database\seed_data.sql copy database\seed_data.sql "%OUTPUT_DIR%\database\seed\"

:: 复制 server/migrations 下的 SQL
if exist server\migrations xcopy /E /I /Q server\migrations\*.sql "%OUTPUT_DIR%\database\init\"

echo [OK] 后端文件复制完成
echo.

:: ── 第5步：生成 .env 模板（去掉真实密码）────────────
echo [5/5] 生成配置模板 .env.template...
(
echo # ============================================
echo # 深蓝企业智慧中枢 - 环境配置模板
echo # 请将此文件复制为 .env 并填写真实配置
echo # ============================================
echo.
echo # ── 后端服务端口 ──
echo SERVER_PORT=8081
echo.
echo # ── PostgreSQL 数据库配置 ──
echo PG_HOST=
echo PG_PORT=5432
echo PG_DATABASE=
echo PG_USER=
echo PG_PASSWORD=
echo DATABASE_URL=
echo.
echo # ── Dify AI 平台配置（联系供应商获取） ──
echo DIFY_API_BASE_URL=
echo DIFY_MARKET_INSIGHT_API_KEY=
echo DIFY_CHATFLOW_API_KEY=
echo DIFY_ORDER_SUGGESTION_API_KEY=
echo DIFY_CONTRACT_AUDIT_API_KEY=
echo DIFY_MATERIAL_QUOTE_API_KEY=
echo DIFY_QUALIFICATION_API_KEY=
echo DIFY_KNOWLEDGE_API_KEY=
echo DIFY_KNOWLEDGE_DATASET_ID=
echo DIFY_MEETING_MINUTES_API_KEY=
echo DIFY_DOC_DRAFTING_API_KEY=
echo DIFY_DIGITAL_EMPLOYEE_API_KEY=
echo DSH_ACCESS_SECRET=
echo DSH_COOKIE_SECURE=false
echo DSH_COOKIE_DOMAIN=
echo VITE_DSH_EMBED_URL=
echo DIFY_MARKETING_ANALYSIS_API_KEY=
echo DIFY_NEWS_API_KEY=
echo DIFY_LAYOUT_COMPARE_API_KEY=
echo DIFY_BEAUTY_RND_API_KEY=
echo DIFY_SEA_MARKETING_API_KEY=
echo DIFY_ECOM_RISK_API_KEY=
echo DIFY_RND_RISK_API_KEY=
echo DIFY_BRAND_EXTRACT_API_KEY=
echo DIFY_CUSTOMER_FEATURE_EXTRACT_API_KEY=
echo DIFY_VIDEOGEN_API_KEY=
echo DIFY_API_KEY_HAZARD=
echo.
echo # ── 阿里云 DashScope（语音识别） ──
echo DASHSCOPE_API_KEY=
echo PUBLIC_URL=
echo.
echo # ── 百度云（人体识别） ──
echo BAIDU_BODY_APP_ID=
echo BAIDU_BODY_API_KEY=
echo BAIDU_BODY_SECRET_KEY=
echo BAIDU_BODY_API_URL=https://aip.baidubce.com/rest/2.0/image-classify/v1/body_attr
echo BAIDU_BODY_TOKEN_URL=https://aip.baidubce.com/oauth/2.0/token
echo.
echo # ── 豆包 ARK（AI生图） ──
echo ARK_API_KEY=
echo.
echo # ── ERP 数据库配置（SQL Server） ──
echo DB_DRIVER={ODBC Driver 17 for SQL Server}
echo DB_SERVER=
echo DB_DATABASE=
echo DB_UID=
echo DB_PWD=
) > "%OUTPUT_DIR%\config\.env.template"
echo [OK] 配置模板生成完成
echo.

:: ── 完成提示 ────────────────────────────────────────
echo =====================================================
echo   [SUCCESS] 打包完成！
echo.
echo   输出目录: %OUTPUT_DIR%
echo.
echo   目录结构:
echo   ├── frontend\dist\    ← 前端静态文件
echo   ├── backend\          ← 后端代码 (无 node_modules)
echo   ├── config\           ← .env.template 配置模板
echo   ├── database\         ← 数据库初始化脚本
echo   └── docs\             ← 请手动放入部署文档
echo.
echo   下一步: 将整个 %PACKAGE_NAME% 文件夹压缩发给客户
echo =====================================================
echo.
pause
