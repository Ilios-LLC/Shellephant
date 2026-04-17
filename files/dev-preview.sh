#!/usr/bin/env bash
set -euo pipefail
trap 'kill $(jobs -p) 2>/dev/null' EXIT

# Start virtual framebuffer display
export DISPLAY=:99
Xvfb :99 -screen 0 1920x1080x24 -ac &
sleep 1

# Start VNC server reading from the virtual display (localhost-only, no password)
x11vnc -display :99 -nopw -forever -rfbport 5900 -listen localhost -bg -quiet

# Start noVNC web client + WebSocket-to-VNC proxy on port 6080
websockify --web /usr/share/novnc 6080 localhost:5900 &

echo "Dev preview ready: http://localhost:6080/vnc.html"

# Start electron-vite dev on the virtual display
cd /workspace/$(ls /workspace | head -1)/window-manager
npx electron-vite dev -- --no-sandbox
