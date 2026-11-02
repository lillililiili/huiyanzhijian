#!/bin/sh
set -eu
ROOT=${EDGE_ROOT:-/opt/huiyan-edge}
DATA=${EDGE_DATA_DIR:-/var/lib/huiyan-edge}
mkdir -p "$DATA"
set -a
if [ -f "$ROOT/edge.env" ]; then . "$ROOT/edge.env"; fi
set +a
export EDGE_DATA_DIR="$DATA"
umask 077
mkdir -p "$DATA/influxdb"
# Legacy $DATA/tsdb is preserved; never reuse it as an InfluxDB engine path.
# Restart the database independently: temporary TSDB failure must not stop
# raw acquisition or center forwarding in the Go application.
(
 child=''
 trap 'if [ -n "$child" ]; then kill -TERM "$child" 2>/dev/null || true; wait "$child" || true; fi; exit 0' TERM INT
 while true; do
  "$ROOT/bin/influxd" --http-bind-address=127.0.0.1:8086 --bolt-path="$DATA/influxdb/influxd.bolt" --sqlite-path="$DATA/influxdb/influxd.sqlite" --engine-path="$DATA/influxdb/engine" --reporting-disabled >> "$DATA/tsdb.log" 2>&1 &
  child=$!
  wait "$child" || true
  sleep 3
 done
) &
TSDB_PID=$!
"$ROOT/bin/huiyan-edge" >> "$DATA/edge.log" 2>&1 &
APP_PID=$!
trap 'kill -TERM "$APP_PID" "$TSDB_PID" 2>/dev/null || true; wait || true' EXIT
trap 'exit 0' TERM INT
while kill -0 "$APP_PID" 2>/dev/null && kill -0 "$TSDB_PID" 2>/dev/null; do sleep 2; done
exit 1
