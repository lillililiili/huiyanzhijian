@echo off
chcp 65001 >nul
setlocal DisableDelayedExpansion
title 慧眼智检 - 启动平台
set "NODE_OPTIONS="
set "NODE_PATH="
if not exist "%~dp0runtime\node.exe" (
  echo 未找到随包运行环境。请先完整解压整个压缩包，再双击此文件。
  pause
  exit /b 1
)
echo 正在启动慧眼智检，请稍候...
"%~dp0runtime\node.exe" "%~dp0app\launcher.cjs" start
if errorlevel 1 (
  echo.
  echo 启动失败。请查看上方原因，以及包内 logs 文件夹。
  pause
  exit /b 1
)
endlocal
