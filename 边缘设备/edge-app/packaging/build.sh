#!/bin/sh
set -eu
BUILD=${EDGE_BUILD_ROOT:-/config/edge-build}
cd "$BUILD/src"
export PATH="$BUILD/go/bin:$PATH"
go mod verify
if [ "${EDGE_SKIP_TESTS:-0}" != 1 ]; then
 go test -v ./... > "$BUILD/unit-tests.txt"
 go test -race ./... > "$BUILD/race-tests.txt"
 go vet ./...
fi
go mod vendor
OUT="$BUILD/release-1.9.0/package"
mkdir -p "$OUT/bin/amd64" "$OUT/bin/arm64" "$OUT/licenses" "$OUT/source"
for arch in amd64 arm64; do
 CGO_ENABLED=0 GOOS=linux GOARCH="$arch" go build -trimpath -ldflags='-s -w' -o "$OUT/bin/$arch/huiyan-edge" .
 tar -xzf "$BUILD/downloads/influxdb2-2.9.1_linux_$arch.tar.gz" --strip-components=1 -C "$OUT/bin/$arch" influxdb2-2.9.1/influxd
done
cp packaging/*.sh packaging/*.service packaging/*.logrotate packaging/edge.env.example "$OUT/"
cp web/logo.png "$OUT/"
cp README.md CENTER-CONTRACT.md EDGE02.md EDGE03.md EDGE04.md EDGE05.md EDGE06.md EDGE07.md EDGE08.md "$OUT/"
cp web/vendor/*LICENSE* "$OUT/licenses/"
tar -xOzf "$BUILD/downloads/influxdb2-2.9.1_linux_amd64.tar.gz" influxdb2-2.9.1/LICENSE > "$OUT/licenses/InfluxDB-LICENSE"
cp "$BUILD/downloads/influxdb-2.9.1-release.txt" "$OUT/licenses/"
cp *.go go.mod go.sum "$OUT/source/"
cp -r web vendor tests "$OUT/source/"
chmod 755 "$OUT"/*.sh
cd "$OUT"
find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS
cd ..
tar -czf "$BUILD/huiyan-edge-1.9.0-ubuntu-amd64-arm64.tar.gz" package
cd "$BUILD"
sha256sum huiyan-edge-1.9.0-ubuntu-amd64-arm64.tar.gz > huiyan-edge-1.9.0-ubuntu-amd64-arm64.tar.gz.sha256
