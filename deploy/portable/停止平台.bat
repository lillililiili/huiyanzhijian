@echo off
chcp 65001 >nul
setlocal DisableDelayedExpansion
title 慧眼智检 - 停止平台
set "NODE_OPTIONS="
set "NODE_PATH="
if not exist "%~dp0runtime\node.exe" (
  echo 未找到随包运行环境，请完整解压后重试。
  pause
  exit /b 1
)
"%~dp0runtime\node.exe" "%~dp0app\launcher.cjs" stop
if errorlevel 1 (
  echo.
  pause
  exit /b 1
)
endlocal
