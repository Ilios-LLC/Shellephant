# Electron Dev Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable live Electron dev preview inside a `cc` container via Xvfb virtual display + noVNC browser client on port 6080.

**Architecture:** Add display stack packages (xvfb, x11vnc, novnc, websockify) to the `cc` Docker image. A startup script launches Xvfb, x11vnc, noVNC, and `electron-vite dev` on the virtual display. A one-liner in the Electron main process enables `--no-sandbox` when running inside a container.

**Tech Stack:** Bash, Dockerfile (node:24/Debian), electron-vite, xvfb, x11vnc, novnc/websockify

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `files/Dockerfile` | Modify | Add display stack apt packages + COPY script |
| `files/dev-preview.sh` | Create | Startup script: Xvfb + VNC + noVNC + electron-vite dev |
| `window-manager/src/main/index.ts` | Modify | Add `--no-sandbox` when DEVCONTAINER=true |

---

### Task 1: Add display stack packages to Dockerfile

**Files:**
- Modify: `files/Dockerfile`

- [ ] **Step 1: Add apt block after the Playwright deps block**

Open `files/Dockerfile`. After this existing block (around line 77-78):
```dockerfile
# Install Playwright system dependencies for Chromium (needs root for apt)
RUN npx -y playwright-core install-deps chromium && \
  apt-get clean && rm -rf /var/lib/apt/lists/*
```

Add immediately after (before the `# Set up non-root user` comment):
```dockerfile
# Install virtual display stack for in-container Electron dev preview
RUN apt-get update && apt-get install -y --no-install-recommends \
  xvfb \
  x11vnc \
  novnc \
  websockify \
  && apt-get clean && rm -rf /var/lib/apt/lists/*
```

- [ ] **Step 2: Add COPY + chmod for the startup script**

At the bottom of the root section (where other scripts are COPY'd, around line 145-151), add after `COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh`:
```dockerfile
COPY dev-preview.sh /usr/local/bin/dev-preview.sh
```

And extend the `chmod` line to include it:
```dockerfile
RUN chmod +x /usr/local/bin/init-firewall.sh /usr/local/bin/docker-entrypoint.sh /usr/local/bin/claude-summarize.sh /usr/local/bin/dev-preview.sh && \
  echo "node ALL=(root) NOPASSWD: /usr/local/bin/init-firewall.sh" > /etc/sudoers.d/node-firewall && \
  chmod 0440 /etc/sudoers.d/node-firewall
```

- [ ] **Step 3: Commit**

```bash
git add files/Dockerfile
git commit -m "feat(dockerfile): add xvfb/vnc display stack for electron dev preview"
```

---

### Task 2: Create dev-preview.sh startup script

**Files:**
- Create: `files/dev-preview.sh`

- [ ] **Step 1: Create the script**

Create `files/dev-preview.sh` with this exact content:
```bash
#!/usr/bin/env bash
set -e

# Start virtual framebuffer display
Xvfb :99 -screen 0 1920x1080x24 -ac &
sleep 1

# Start VNC server reading from the virtual display (localhost-only, no password)
x11vnc -display :99 -nopw -forever -rfbport 5900 -listen localhost -bg -quiet

# Start noVNC web client + WebSocket-to-VNC proxy on port 6080
websockify --web /usr/share/novnc 6080 localhost:5900 &

echo "Dev preview ready: http://localhost:6080/vnc.html"

# Start electron-vite dev on the virtual display
export DISPLAY=:99
cd /workspace/$(ls /workspace | head -1)/window-manager
npx electron-vite dev -- --no-sandbox
```

- [ ] **Step 2: Verify script is executable locally**

```bash
chmod +x files/dev-preview.sh
head -1 files/dev-preview.sh
```
Expected output: `#!/usr/bin/env bash`

- [ ] **Step 3: Commit**

```bash
git add files/dev-preview.sh
git commit -m "feat: add dev-preview.sh for in-container electron live preview"
```

---

### Task 3: Add --no-sandbox flag to Electron main process

**Files:**
- Modify: `window-manager/src/main/index.ts`

The `cc` image sets `ENV DEVCONTAINER=true`. We use this to enable `--no-sandbox` automatically whenever Electron runs inside a container, so `npm run dev` works without the script too.

- [ ] **Step 1: Add the no-sandbox switch**

In `window-manager/src/main/index.ts`, add after the imports (after line 9, before the `function createWindow()` declaration at line 11):

```ts
if (process.env['DEVCONTAINER']) {
  app.commandLine.appendSwitch('no-sandbox')
}
```

The file top should now look like:
```ts
import { app, BrowserWindow } from 'electron'
import path from 'path'
import { initDb } from './db'
import { registerIpcHandlers } from './ipcHandlers'
import { reconcileWindows } from './windowService'
import { startWaitingPoller } from './waitingPoller'
import { getGitHubPat } from './settingsService'
import { getIdentity } from './githubIdentity'
import { applyGitIdentity } from './gitOps'

if (process.env['DEVCONTAINER']) {
  app.commandLine.appendSwitch('no-sandbox')
}

function createWindow(): BrowserWindow {
```

- [ ] **Step 2: Run existing tests to verify nothing broken**

```bash
cd window-manager && npm test
```
Expected: all tests pass. The `index.ts` change has no test coverage (it's Electron app lifecycle code, not unit-testable), but the existing suite confirms nothing else regressed.

- [ ] **Step 3: Commit**

```bash
git add window-manager/src/main/index.ts
git commit -m "feat(main): enable no-sandbox when running in devcontainer"
```

---

### Task 4: Rebuild image and verify end-to-end

**No file changes — verification only.**

- [ ] **Step 1: Rebuild the cc image**

Run from the repo root on the HOST machine (not inside a container):
```bash
docker build -t cc files/
```
Expected: build completes without errors. The apt block for xvfb/x11vnc/novnc/websockify should appear in the output.

- [ ] **Step 2: Create a dev project in the app**

In the running Electron app on the host:
1. Create a new project pointing to this repo's git URL
2. Add port mapping `6080:6080` in the project's port settings
3. Create a window for that project

- [ ] **Step 3: Run dev-preview.sh inside the window**

In the terminal panel of the newly created window:
```bash
dev-preview.sh
```
Expected output includes:
```
Dev preview ready: http://localhost:6080/vnc.html
```
Followed by electron-vite dev output (Vite server starting, then Electron launch).

- [ ] **Step 4: Open noVNC in browser**

On the host, open: `http://localhost:6080/vnc.html`

Click **Connect**. Expected: full Electron app UI visible in the browser tab.

- [ ] **Step 5: Verify HMR works**

Edit any `.svelte` component (e.g., add a visible text change to `window-manager/src/renderer/src/App.svelte`). Save. Expected: noVNC browser view updates within ~1 second without a full reload.

- [ ] **Step 6: Revert the test edit**

```bash
git checkout window-manager/src/renderer/src/App.svelte
```
