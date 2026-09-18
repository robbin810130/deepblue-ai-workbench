@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0.."

:: =====================================================
::  DeepBlue Workbench - Release by Tag
::  Usage:  deploy\pull_release.bat <tag>
::  Example:  deploy\pull_release.bat v3.1.0
::
::  Deploys an exact git tag, rebuilds the frontend,
::  and reloads PM2 with zero downtime.
::  Rollback = run again with the previous tag.
::
::  NOTE: ASCII-only on purpose, to avoid codepage issues.
:: =====================================================

set TAG=%~1

if "%TAG%"=="" (
    echo.
    echo [ERROR] Missing version tag.
    echo.
    echo   Usage:  deploy\pull_release.bat ^<tag^>
    echo   Example: deploy\pull_release.bat v3.1.0
    echo.
    echo   Available tags:
    git tag --sort=-v:refname | more
    exit /b 1
)

echo =====================================================
echo   DeepBlue Workbench - Deploy Release
echo   Target tag: %TAG%
echo =====================================================
echo.

:: -- 1. Fetch tags -------------------------------------
echo [1/6] Fetching from origin...
git fetch --tags --prune
if %errorLevel% neq 0 (
    echo [ERROR] git fetch failed. Check network / credentials.
    exit /b 1
)
echo.

:: -- 2. Verify tag exists ------------------------------
echo [2/6] Verifying tag "%TAG%"...
git rev-parse "%TAG%" >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] Tag "%TAG%" does not exist on remote.
    echo.
    echo   Available tags:
    git tag --sort=-v:refname | more
    exit /b 1
)
echo [OK] Tag found.
echo.

:: -- 3. Check working tree is clean --------------------
echo [3/6] Checking working tree...
for /f %%i in ('git status --porcelain') do (
    echo [ERROR] Working tree is dirty. Commit or stash your changes first.
    echo         This script only deploys committed code.
    exit /b 1
)
echo [OK] Working tree clean.
echo.

:: -- 4. Checkout the tag -------------------------------
echo [4/6] Checking out %TAG%...
git checkout "%TAG%"
if %errorLevel% neq 0 (
    echo [ERROR] git checkout failed.
    exit /b 1
)
echo.

:: -- 5. Install deps and build -------------------------
echo [5/6] Installing dependencies (npm ci)...
call npm ci
if %errorLevel% neq 0 (
    echo [ERROR] npm ci failed.
    exit /b 1
)

echo.
echo [5/6] Building frontend...
call npm run build
if %errorLevel% neq 0 (
    echo [ERROR] Frontend build failed. NOT deploying.
    exit /b 1
)
echo [OK] Build succeeded.
echo.

:: -- 6. Reload PM2 -------------------------------------
echo [6/6] Reloading service (zero downtime)...
call pm2 reload blue-os-server --update-env
if %errorLevel% neq 0 (
    echo [WARN] pm2 reload failed. Trying start...
    call pm2 start ecosystem.config.cjs --env production --update-env
)
call pm2 save
echo.

:: -- Done ----------------------------------------------
echo =====================================================
echo   [SUCCESS] Deployed %TAG%
echo =====================================================
echo.
echo   Running version:
git describe --tags
echo.
echo   Rollback command:
echo     deploy\pull_release.bat ^<previous-tag^>
echo.
echo   PM2 status:
call pm2 status blue-os-server
echo.
pause
