# Electron Dev Preview via Xvfb + noVNC

**Date:** 2026-04-17  
**Status:** Approved

## Problem

The app manages Docker containers (`cc` image). Development happens inside one of those containers. Electron cannot run in the container due to missing display server and GTK/Chromium system libraries. No live preview = full rebuild + restart cycle for every UI change.

## Solution

Run `electron-vite dev` inside the container on a virtual display (Xvfb), expose it via VNC, and serve a noVNC web client on a mapped port. Developer browses to `http://localhost:6080/vnc.html` on the host to see and interact with the live Electron app.

## Architecture

```
Container
├── Xvfb :99          (virtual framebuffer display)
├── x11vnc :5900      (VNC server reading from Xvfb, localhost-only)
├── websockify :6080  (WebSocket→VNC bridge + noVNC web client)
└── electron-vite dev (DISPLAY=:99, --no-sandbox)
        ├── Vite dev server (renderer HMR)
        └── Electron main process (real Docker/IPC/SQLite)

Host
└── Browser → http://localhost:6080/vnc.html
```

## Components

### 1. Dockerfile changes (`files/Dockerfile`)

Add after the existing Playwright deps block:

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
  xvfb x11vnc novnc websockify \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

COPY dev-preview.sh /usr/local/bin/dev-preview.sh
RUN chmod +x /usr/local/bin/dev-preview.sh
```

`libgtk-3-0` is expected to be covered by `playwright-core install-deps chromium`. If the error persists after rebuild, add it explicitly to this block.

### 2. Startup script (`files/dev-preview.sh`)

```bash
#!/usr/bin/env bash
set -e

Xvfb :99 -screen 0 1920x1080x24 -ac &
sleep 1

x11vnc -display :99 -nopw -forever -rfbport 5900 -listen localhost -bg -quiet

websockify --web /usr/share/novnc 6080 localhost:5900 &

echo "Open: http://localhost:6080/vnc.html"

export DISPLAY=:99
cd /workspace/$(ls /workspace | head -1)/window-manager
npx electron-vite dev -- --no-sandbox
```

- VNC bound to localhost only; noVNC is the sole external entry point
- `--no-sandbox` required for Chromium/Electron in containers
- `cd` resolves repo name dynamically so script is repo-agnostic

### 3. Main process change (`window-manager/src/main/index.ts`)

Add before `app.whenReady()`:

```ts
if (process.env.DEVCONTAINER) {
  app.commandLine.appendSwitch('no-sandbox')
}
```

`DEVCONTAINER=true` is already set in the `cc` image. This makes `npm run dev` work in-container without needing to use the script.

### 4. Port mapping

When creating the self-development project in the app, add port mapping `6080:6080`. Port 5900 (VNC) does not need to be mapped — only noVNC on 6080 is exposed to the host.

## Developer Workflow

1. `docker build -t cc files/` — rebuild image with display stack
2. Create project in app with port mapping `6080:6080`
3. Create window, open terminal
4. Run `dev-preview.sh`
5. Browse to `http://localhost:6080/vnc.html`, click Connect
6. Full live Electron app visible in browser
   - Renderer edits: Vite HMR updates instantly
   - Main process edits: electron-vite auto-restarts Electron

## Security Notes

- `--no-sandbox` reduces Chromium renderer sandbox. Acceptable: dev-only, already inside a container.
- VNC has no password (`-nopw`), bound to `localhost` only. noVNC on 6080 is accessible to anyone on the host machine — acceptable for local dev.
- For shared/remote dev machines, add a noVNC password via `--password` flag to `websockify`.

## Out of Scope

- Production builds (this is dev-only tooling)
- Multi-user VNC sessions
- Persisting display across container restarts
