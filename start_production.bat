@echo off
setlocal
cd /d "%~dp0"

echo ===================================================
echo      My Web OS - Production Server Startup
echo ===================================================
echo.

:: 1. Check Node.js
node -v >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

:: 2. Check Python (for forecasting)
python --version >nul 2>&1
if %errorLevel% neq 0 (
    echo [WARNING] Python is not installed. Forecasting features may not work.
    echo Please install Python if you need forecast generation.
)

:: 3. Check for PM2 Recommendation
echo [INFO] checking if PM2 is installed...
call pm2 -v >nul 2>&1
if %errorLevel% neq 0 (
    echo.
    echo ========================================================
    echo  [RECOMMENDATION] FOR PRODUCTION USE
    echo  You are currently running in 'Foreground Mode'. 
    echo  If you close this window, the Web OS will STOP.
    echo  Please consider running 'npm install -g pm2' and 
    echo  use 'start_pm2.bat' for background 24/7 reliability.
    echo ========================================================
    echo.
) else (
    echo.
    echo [NOTICE] PM2 detected! You can also use 'start_pm2.bat' 
    echo to run this system steadily in the background.
    echo.
)

:: 4. Set Environment variables
set SERVER_PORT=8081
set NODE_ENV=production

:: 5. Install missing dependencies (Auto fail-safe)
echo [CHECK] Ensuring node_modules...
if not exist node_modules (
    echo Installing dependencies...
    call npm install
)

:: 6. Start Server
echo.
echo Starting server on port %SERVER_PORT%...
echo You can access the site at: http://localhost:%SERVER_PORT%
echo.

node server.js

if %errorLevel% neq 0 (
    echo.
    echo [ERROR] Server crashed or stopped unexpectedly.
    pause
)
pause
