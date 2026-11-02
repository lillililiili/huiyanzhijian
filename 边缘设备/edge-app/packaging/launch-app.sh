#!/bin/sh
set -eu
for browser in chromium chromium-browser google-chrome; do
 if command -v "$browser" >/dev/null 2>&1; then
  exec "$browser" --app=http://127.0.0.1:4198 --start-maximized --no-first-run --user-data-dir="${XDG_CONFIG_HOME:-$HOME/.config}/huiyan-edge-browser"
 fi
done
printf '%s\n' '需要 Chromium 或 Google Chrome。请先运行安装器 --install-browser。' >&2
exit 1
