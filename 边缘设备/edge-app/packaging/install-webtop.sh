#!/bin/sh
set -eu
cd "$(dirname "$0")"
sha256sum -c SHA256SUMS
case "$(uname -m)" in x86_64) ARCH=amd64;; aarch64) ARCH=arm64;; *) exit 1;; esac
ROOT=/config/huiyan-edge
mkdir -p "$ROOT/bin" "$ROOT/data" /config/.config/autostart /config/.local/share/applications /config/Desktop
if [ -f "$ROOT/data/supervisor.pid" ] && kill -0 "$(cat "$ROOT/data/supervisor.pid")" 2>/dev/null; then
 echo '请先停止本应用：kill -TERM $(cat /config/huiyan-edge/data/supervisor.pid)，再运行安装器。'; exit 1
fi
install -m 755 "bin/$ARCH/huiyan-edge" "bin/$ARCH/influxd" "$ROOT/bin/"
install -m 755 launch-app.sh run-services.sh "$ROOT/"
cat > "$ROOT/launch-webtop.sh" <<'EOF'
#!/bin/sh
# Webtop's Docker namespace restrictions prevent Chromium's nested sandbox.
# This launcher is for this trusted local container only; normal Ubuntu stays sandboxed.
exec chromium --no-sandbox --disable-extensions --disable-sync --disable-background-networking --no-first-run --app=http://127.0.0.1:4198 --start-maximized --user-data-dir=/config/.config/huiyan-edge-browser
EOF
chmod 755 "$ROOT/launch-webtop.sh"
install -m 644 logo.png "$ROOT/"
if [ ! -f "$ROOT/edge.env" ]; then cp edge.env.example "$ROOT/edge.env"; sed -i 's/EDGE_LISTEN=127.0.0.1/EDGE_LISTEN=0.0.0.0/' "$ROOT/edge.env"; fi
cat > "$ROOT/start-desktop.sh" <<'EOF'
#!/bin/sh
export EDGE_ROOT=/config/huiyan-edge
export EDGE_DATA_DIR=/config/huiyan-edge/data
exec 9>/config/huiyan-edge/data/supervisor.lock
flock -n 9 || exit 0
echo $$ > /config/huiyan-edge/data/supervisor.pid
child=''
trap 'if [ -n "$child" ]; then kill -TERM "$child" 2>/dev/null || true; wait "$child" || true; fi; exit 0' TERM INT
while true; do
 /config/huiyan-edge/run-services.sh &
 child=$!
 wait "$child" || true
 sleep 3
done
EOF
chmod 755 "$ROOT/start-desktop.sh"
cat > /config/.config/autostart/huiyan-edge-services.desktop <<'EOF'
[Desktop Entry]
Type=Application
Name=Huiyan Edge Services
Exec=/config/huiyan-edge/start-desktop.sh
X-MATE-Autostart-enabled=true
Terminal=false
EOF
cat > /config/.local/share/applications/huiyan-edge.desktop <<'EOF'
[Desktop Entry]
Type=Application
Name=慧眼智检边缘终端
Exec=/config/huiyan-edge/launch-webtop.sh
Icon=/config/huiyan-edge/logo.png
Terminal=false
Categories=Utility;
EOF
cp /config/.local/share/applications/huiyan-edge.desktop /config/Desktop/
chmod 755 /config/Desktop/huiyan-edge.desktop
chown -R abc:abc "$ROOT" /config/.config/autostart/huiyan-edge-services.desktop /config/.local/share/applications/huiyan-edge.desktop /config/Desktop/huiyan-edge.desktop
echo 'Installed. Start services as abc with /config/huiyan-edge/start-desktop.sh'
