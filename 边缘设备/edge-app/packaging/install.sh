#!/bin/sh
set -eu
cd "$(dirname "$0")"
[ "$(id -u)" = 0 ] || { echo '请使用 sudo ./install.sh'; exit 1; }
. /etc/os-release
[ "$ID" = ubuntu ] || { echo '此安装器仅适用于 Ubuntu。'; exit 1; }
case "$VERSION_ID" in 22.04|24.04|26.04) ;; *) echo "尚未适配 Ubuntu $VERSION_ID；未修改系统。"; exit 1;; esac
case "$(uname -m)" in x86_64) ARCH=amd64;; aarch64) ARCH=arm64;; *) echo '仅支持 amd64/arm64'; exit 1;; esac
MAJOR=$(uname -r | cut -d. -f1)
[ "$MAJOR" -ge 5 ] || { echo '要求 Linux 5.x 或更新内核'; exit 1; }
sha256sum -c SHA256SUMS
if [ "${1:-}" = --install-browser ]; then
 apt-get update
 apt-get install -y chromium-browser fonts-noto-cjk
fi
FOUND=0
for b in chromium chromium-browser google-chrome; do command -v "$b" >/dev/null 2>&1 && FOUND=1; done
[ "$FOUND" = 1 ] || { echo '缺少 Chromium。联网运行 sudo ./install.sh --install-browser，或先安装系统对应架构的 Chromium。核心程序无需Go/Node运行时。'; exit 1; }
command -v systemctl >/dev/null || { echo '需要 systemd；Webtop容器请使用 install-webtop.sh'; exit 1; }
if [ -e /var/lib/huiyan-edge/edge.db ]; then
 echo '检测到现有数据，将停止本应用、备份数据库后升级；数据不会清空。'
 systemctl stop huiyan-edge.service || true
 cp -p /var/lib/huiyan-edge/edge.db "/var/lib/huiyan-edge/edge.db.pre-upgrade-$(date +%Y%m%d%H%M%S)"
fi
id huiyan-edge >/dev/null 2>&1 || useradd --system --home /var/lib/huiyan-edge --shell /usr/sbin/nologin huiyan-edge
usermod -a -G dialout huiyan-edge
install -d /opt/huiyan-edge/bin /var/lib/huiyan-edge
install -m 755 "bin/$ARCH/huiyan-edge" "bin/$ARCH/influxd" /opt/huiyan-edge/bin/
install -m 755 launch-app.sh run-services.sh /opt/huiyan-edge/
install -m 644 logo.png /opt/huiyan-edge/logo.png
if [ ! -f /opt/huiyan-edge/edge.env ]; then install -m 640 -o root -g huiyan-edge edge.env.example /opt/huiyan-edge/edge.env; fi
chown -R huiyan-edge:huiyan-edge /var/lib/huiyan-edge
install -m 644 huiyan-edge.service /etc/systemd/system/
if [ -d /etc/logrotate.d ]; then install -m 644 huiyan-edge.logrotate /etc/logrotate.d/huiyan-edge; fi
cat > /usr/share/applications/huiyan-edge.desktop <<'EOF'
[Desktop Entry]
Type=Application
Name=慧眼智检边缘终端
Comment=圆整度与护套厚度检测
Exec=/opt/huiyan-edge/launch-app.sh
Icon=/opt/huiyan-edge/logo.png
Terminal=false
Categories=Utility;
EOF
systemctl daemon-reload
systemctl enable --now huiyan-edge.service
echo '安装完成。应用菜单打开「慧眼智检边缘终端」。全屏按钮或F11切换全屏。'
echo '配置 /opt/huiyan-edge/edge.env；数据 /var/lib/huiyan-edge；端口仅本机4198。'
