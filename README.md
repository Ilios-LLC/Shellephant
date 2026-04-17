# Shellephant

Containerized development environment manager with Claude Code, terminal, and file editor — one window per project.

![Shellephant overview](docs/images/overview.png)

---

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (running)
- [Node.js 20+](https://nodejs.org/)
- [Anthropic API key](https://console.anthropic.com/)

---

## Quick Setup

```bash
# 1. Clone and install
git clone <repo-url>
cd claude-window/window-manager
npm install

# 2. Set your API key
export ANTHROPIC_API_KEY=your_key_here

# 3. Run
npm run dev
```

On first launch, create a project with a Git SSH URL to get started.

---

## Features

### Windows & Projects

![Windows and Projects](docs/images/windows-projects.png)

- Each project maps to a Git repo (SSH URL), port bindings, and environment variables
- Create isolated Docker containers per project with one click
- Two-click delete pattern prevents accidental removal

---

### Panel Layout

![Panel Layout](docs/images/panel-layout.png)

- Three panels: **Claude** (AI coding assistant), **Terminal** (shell in container), **Editor** (Monaco)
- Toggle any panel on/off; drag headers to reorder; drag resize handles to adjust widths
- Layout persists across sessions

---

### Git Workflow

![Git Workflow](docs/images/git-workflow.png)

- Live branch name and dirty-file status in the footer
- Stage and commit with subject + body from the commit modal
- Push and get a PR URL back automatically

---

### In-Container File Editor

![File Editor](docs/images/file-editor.png)

- Monaco editor with syntax highlighting for files inside the container
- File tree browser with lazy-loaded directory expansion
- `Ctrl+S` saves; editor polls every 2s for external changes without losing cursor position

---

### Service Dependencies

![Dependencies](docs/images/dependencies.png)

- Attach companion containers (e.g. `postgres:16`, `redis:latest`) to any project
- Dependency containers join an auto-created bridge network with the main container
- Two-click delete to remove a dependency

---

### Project Groups

![Project Groups](docs/images/groups.png)

- Assign projects to named groups via the group strip
- Create a new group inline — type a name, press Enter
- Switch groups with one click to filter the project list

---

## Build for Distribution

```bash
npm run build:win    # Windows
npm run build:mac    # macOS
npm run build:linux  # Linux
```

---

## Configuration

| Variable | Purpose | Required |
|---|---|---|
| `ANTHROPIC_API_KEY` | Powers Claude Code inside containers | Yes |
