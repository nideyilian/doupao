@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================
echo    DOUPAO V2 - Electron 开发版
echo ========================================
echo.

where node.exe >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到 Node.js。
    echo 请先安装 Node.js：https://nodejs.org/
    goto :failed
)

where npm.cmd >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到 npm，请检查 Node.js 安装。
    goto :failed
)

for /f "tokens=*" %%a in ('node --version') do echo [就绪] Node.js %%a

if not exist "node_modules\electron\package.json" (
    echo [准备] 正在安装项目依赖，请稍候...
    call npm.cmd install
    if errorlevel 1 (
        echo [错误] 项目依赖安装失败。
        goto :failed
    )
)

echo [启动] 正在启动 DOUPAO V2...
echo.
call npm.cmd run electron:dev
set "DOUPAO_EXIT_CODE=%ERRORLEVEL%"

if not "%DOUPAO_EXIT_CODE%"=="0" (
    echo.
    echo [错误] 程序启动失败，退出代码：%DOUPAO_EXIT_CODE%
    goto :failed
)

goto :done

:failed
if not defined DOUPAO_NO_PAUSE pause
exit /b 1

:done
if not defined DOUPAO_NO_PAUSE pause
exit /b 0
