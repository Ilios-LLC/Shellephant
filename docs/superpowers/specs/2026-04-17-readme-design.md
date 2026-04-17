# README Design — Shellephant

**Date:** 2026-04-17  
**Audience:** Developers (setup + features); end users (features primary)  
**Tone:** Terse, technical, no hand-holding  
**Format:** Task-oriented feature blocks (structure B)

---

## Structure

### 1. Header
- App name + one-line description
- Badges: build status, license

### 2. What is Shellephant?
- 2–3 sentences: Docker container window manager with Claude Code integration, terminal, Monaco editor
- No feature enumeration here — that's what section 5 is for

### 3. Prerequisites
- Docker
- Node 20+
- An Anthropic API key
- Each item links to external install docs — no inline instructions

### 4. Quick Setup
Numbered list, 5 steps:
1. Clone repo
2. `cd window-manager && npm i`
3. Set `ANTHROPIC_API_KEY` env var
4. `npm run dev`
5. Create first project

### 5. Feature Blocks
Each block: one screenshot placeholder + max 3 bullets.

| Block | Key points |
|---|---|
| Windows & Projects | Create container per project (Git URL + ports + env vars); two-click delete safety |
| Panel Layout | Claude / Terminal / Editor split panes; drag to reorder; resize handles; toggle visibility |
| Git Workflow | Live branch + dirty status; stage-and-commit with subject/body; push + PR URL |
| In-Container File Editor | Monaco editor; file tree; polls for external changes; Ctrl+S saves |
| Service Dependencies | Add companion containers (e.g. postgres); auto bridge network; two-click delete |
| Project Groups | Group projects with labeled icon strip; inline group creation |

### 6. Build for Distribution
Three one-liners:
- `npm run build:win`
- `npm run build:mac`
- `npm run build:linux`

### 7. Configuration Reference
Small table:

| Variable | Purpose | Required |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude Code integration | Yes |

---

## Constraints
- Screenshot placeholders use `docs/images/<feature>.png` paths — user replaces with real assets
- No contribution section
- No architecture/internals section
- Total README target: under 150 lines
