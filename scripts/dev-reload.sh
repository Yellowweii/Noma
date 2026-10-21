#!/bin/sh
# Poll Go sources and restart the gateway. Bind mounts on Docker Desktop
# do not deliver filesystem events into the container.
cd /src || exit 1
bin=/tmp/noma-local
next_bin=/tmp/noma-local.next
pidfile=/tmp/noma-local.pid

snapshot() {
	find cmd noma-backend go.mod go.sum -type f \( -name '*.go' -o -name 'go.mod' -o -name 'go.sum' \) ! -name '*_test.go' 2>/dev/null | sort | while read -r file; do
		sha256sum "$file"
	done | sha256sum
}

stop_server() {
	pid=$(cat "$pidfile" 2>/dev/null || true)
	if [ -z "$pid" ]; then
		return
	fi
	kill "$pid" 2>/dev/null || true
	i=0
	while kill -0 "$pid" 2>/dev/null; do
		if [ "$i" -ge 50 ]; then
			kill -9 "$pid" 2>/dev/null || true
			break
		fi
		sleep 0.1
		i=$((i + 1))
	done
	wait "$pid" 2>/dev/null || true
	rm -f "$pidfile"
}

start_server() {
	"$bin" --config=/data/local.json &
	echo $! >"$pidfile"
}

build_server() {
	if go build -o "$next_bin" ./cmd/noma-local; then return 0; fi
	echo "go build failed; keeping the current gateway running" >&2
	return 1
}

trap 'stop_server; exit 0' INT TERM

echo "watching cmd, noma-backend, go.mod, and go.sum"
if build_server; then
	mv "$next_bin" "$bin"
	start_server
fi
last=$(snapshot)
while true; do
	sleep 1 || true
	now=$(snapshot)
	if [ "$now" != "$last" ]; then
		sleep 0.4 || true
		now=$(snapshot)
		last=$now
		echo "Go source changed; rebuilding"
		if build_server; then
			stop_server
			mv "$next_bin" "$bin"
			start_server
		fi
	fi
done
