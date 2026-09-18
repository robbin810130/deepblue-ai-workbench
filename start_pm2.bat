@echo off
setlocal
cd /d "%~dp0"

echo ===================================================
echo      My Web OS - PM2 Background Startup
echo ===================================================
echo.

:: 1. Check PM2
call pm2 -v >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] PM2 is not installed globally.
    echo Please install PM2 first by running:
    echo     npm install -g pm2
    echo.
    pause
    exit /b 1
)

:: 2. Install missing dependencies
if not exist node_modules (
    echo [INFO] Installing NPM dependencies...
    call npm install
)

echo.
if exist dist.next-release (
    echo [INFO] Publishing newly built frontend files...
    call pm2 stop blue-os-server >nul 2>&1
    if exist dist (
        ren dist dist.backup.%RANDOM%
    )
    ren dist.next-release dist
)

echo [INFO] Starting Web OS through PM2 ecosystem...
call pm2 start ecosystem.config.cjs --env production --update-env
call pm2 restart blue-os-server --update-env

echo.
echo ========================================================
echo  [SUCCESS] System is now running in the BACKGROUND!
echo.
echo  1. You can safely close this terminal window.
echo  2. To monitor logs, run: pm2 logs blue-os-server
echo  3. To stop system, run:  pm2 stop blue-os-server
echo  4. URL: http://localhost:8081
echo ========================================================
echo.
pause
