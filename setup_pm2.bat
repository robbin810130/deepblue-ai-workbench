@echo off
setlocal
cd /d "%~dp0"

echo ===================================================
echo      My Web OS - Server Persistence Setup (PM2)
echo ===================================================
echo.

:: 1. Check Node.js
node -v >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] Node.js is not installed.
    pause
    exit /b 1
)

:: 2. Install PM2 globally
echo [1/3] Installing PM2 process manager...
call npm install -g pm2
if %errorLevel% neq 0 (
    echo [ERROR] Failed to install PM2. Please run as Administrator or check internet.
    pause
    exit /b 1
)

:: 3. Start the application
echo.
echo [2/3] Starting application with PM2...
call pm2 start ecosystem.config.cjs

:: 4. Setup Startup Hook (Optional)
echo.
echo [3/3] Setting up Windows Startup Hook...
echo.
echo To make this run automatically when the server reboots:
echo 1. We will install 'pm2-windows-startup'
echo 2. You might need to approve UAC prompts.
echo.
set /p SETUP_BOOT="Do you want to setup auto-start on boot? (Y/N): "

if /i "%SETUP_BOOT%"=="Y" (
    call npm install -g pm2-windows-startup
    call pm2-startup install
    call pm2 save
    echo.
    echo [SUCCESS] Auto-start configured!
) else (
    echo [INFO] Skipped auto-start setup.
    echo You can manually start the app using 'pm2 start ecosystem.config.cjs'
    call pm2 save
)

echo.
echo ===================================================
echo               Setup Complete
echo ===================================================
echo.
echo Use the following commands to manage the app:
echo   pm2 status        - Check status
echo   pm2 stop blue-os-server - Stop app
echo   pm2 restart blue-os-server - Restart app
echo   pm2 logs blue-os-server - View logs
echo.
pause
